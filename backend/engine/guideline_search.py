"""Stage 3 — Live clinical guideline grounding via Tavily (PRD FR-3.1).

Contract:
- Outbound queries are PHI-scrubbed (names/MRN/DOB regex — NFR §7).
- Params per verified API contract: search_depth="advanced", max_results=3,
  include_domains restricted to medical authorities, include_raw_content=false.
- Hard timeout (config.TAVILY_TIMEOUT_S = 3.5s): timeout/API error degrades to
  the local verified snapshot `fixtures/guideline_cache.json` — demo never
  hangs; badge records `tavily_live` vs `cache_snapshot`.
- Queries: Nano live (FR-3.1) with a transport; deterministic precision
  templates otherwise (same intent as the PRD example queries).
"""

from __future__ import annotations

import functools
import json
import logging
import re
import time
from pathlib import Path
from typing import Callable

import httpx
from pydantic import BaseModel

from backend.config import TAVILY_API_KEY, TAVILY_TIMEOUT_S
from backend.engine.llm_client import LlmUnverifiableError, parse_llm_json
from backend.engine.vision_extractor import LlmTransport
from backend.schemas import FindingKind, StageTrace

logger = logging.getLogger(__name__)

TAVILY_URL = "https://api.tavily.com/search"
AUTHORIZED_DOMAINS = [
    "ncbi.nlm.nih.gov",
    "acr.org",
    "fda.gov",
    "kdigo.org",
    "pubs.rsna.org",
    "radiopaedia.org",
    "uptodate.com",
    "medscape.com",
]
_GUIDELINE_CACHE_PATH = (
    Path(__file__).resolve().parent.parent / "fixtures" / "guideline_cache.json"
)

# NFR §7 scrubber — deterministic patterns, fail-closed
_PATIENT_NAME_RE = re.compile(
    r"\b(?:patient|mrs?\.?|ms\.?|dr\.?)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?", re.IGNORECASE
)
_MRN_RE = re.compile(r"\bMRN[:\s#]*\w+", re.IGNORECASE)
_DOB_RE = re.compile(r"\b(?:DOB|date of birth)[:\s]*[\w/\-,]+\b", re.IGNORECASE)
_MULTI_SPACE_RE = re.compile(r"\s{2,}")


def scrub_phi(query: str) -> str:
    cleaned = _PATIENT_NAME_RE.sub(" ", query)
    cleaned = _MRN_RE.sub(" ", cleaned)
    cleaned = _DOB_RE.sub(" ", cleaned)
    return _MULTI_SPACE_RE.sub(" ", cleaned).strip()


def template_queries(kind: FindingKind) -> list[str]:
    """PRD §6 FR-3.1 example intents, as deterministic templates."""
    if kind == FindingKind.INCIDENTAL_FINDING_DROP:
        return [
            "ACR Fleischner Society guidelines solid pulmonary nodule 6-8 mm follow-up CT interval",
        ]
    if kind == FindingKind.KINETIC_MED_COLLISION:
        return [
            "FDA ketorolac tromethamine contraindication renal impairment label",
            "KDIGO acute kidney injury staging creatinine 0.3 mg/dL 48 hours",
        ]
    return ["clinical contraindication discharge guideline checklist"]


class GuidelineBundle(BaseModel):
    title: str
    url: str
    snippet: str = ""
    source: str  # tavily_live | cache_snapshot


class GuidelineResult(BaseModel):
    queries: list[str]
    guidelines: list[GuidelineBundle] = []
    degraded: bool = False


QUERY_SYSTEM_PROMPT = (
    "You generate precision medical guideline search queries for a clinical "
    "safety system. Return STRICT JSON only: {\"queries\":[str, str]} with at "
    "most 2 queries. Only entity terms (condition, measurement, guideline "
    "name, drug) — NO patient names, MRNs, or dates of birth."
)


def generate_queries(
    kinds: list[FindingKind],
    *,
    transport: LlmTransport | None = None,
    model_id: str = "",
    timeout_s: float = 2.0,
) -> tuple[list[str], StageTrace]:
    """Stage-3a: Nano query generation (FR-3.1), template fallback."""
    started = time.perf_counter()
    fallback = [q for kind in dict.fromkeys(kinds) for q in template_queries(kind)] or [
        template_queries(FindingKind.INCIDENTAL_FINDING_DROP)[0]
    ]

    if transport is None:
        return fallback, StageTrace(
            stage="guideline", model_id=None, replayed=True,
            latency_ms=int((time.perf_counter() - started) * 1000),
            note="template_queries",
        )

    template_list = json.dumps(fallback, indent=2)
    try:
        raw, usage = validate_transport_kind(
            transport,
            model_id,
            [
                {"role": "system", "content": QUERY_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        "Contradiction kinds to ground: "
                        f"{[k.value for k in kinds]}. Reference templates:\n"
                        f"{template_list}\nReturn 1–2 sharper queries referencing "
                        "the governing bodies (ACR/Fleischner/KDIGO/FDA)."
                    ),
                },
            ],
            timeout_s,
        )
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))

        def repair(error: str) -> str:
            raw2, usage2 = validate_transport_kind(
                transport,
                model_id,
                [
                    {"role": "system", "content": QUERY_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Validation failed: {error}. Return ONLY corrected JSON."},
                ],
                timeout_s,
            )
            return raw2

        plan = parse_llm_json(raw, QueryPlan, retry_call=repair)
        queries = [scrub_phi(q) for q in plan.queries if q.strip()][:2]
        if not queries:  # LLM thought it could send zero — templates win
            queries = fallback
            logger.warning("Nano produced zero queries — template fallback")
        source_note = "nano_live"
    except (LlmUnverifiableError, TimeoutError) as exc:
        logger.warning("Nano query gen failed (%s) — templates", exc)
        prompt_tokens = completion_tokens = 0
        queries = fallback
        source_note = "deterministic_query_fallback"

    return (
        queries,
        StageTrace(
            stage="guideline",
            model_id=model_id or None,
            replayed=source_note != "nano_live",
            latency_ms=int((time.perf_counter() - started) * 1000),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            note=source_note,
        ),
    )


def validate_transport_kind(
    transport: LlmTransport, model_id: str, messages: list[dict], timeout_s: float
) -> tuple[str, dict]:
    """Stopgap type discriminator so query-gen + fetch share validation."""
    return transport(model_id, messages, timeout_s=timeout_s)


class QueryPlan(BaseModel):
    queries: list[str]


@functools.lru_cache(maxsize=1)
def _load_cache_snapshot() -> list[dict]:
    try:
        data = json.loads(_GUIDELINE_CACHE_PATH.read_text())
    except FileNotFoundError:
        logger.warning("guideline_cache.json missing — cache fallback empty")
        return []
    except json.JSONDecodeError as exc:
        logger.warning("guideline_cache.json malformed (%s)", exc)
        return []
    rows = data.get("snapshots") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        return []
    for row in rows:
        if isinstance(row, dict):
            needle = row.get("match_terms") or ""
            row["_terms"] = tuple(term.lower() for term in needle.split("|") if term)
    return rows


def _snapshot_matches(query: str, row: dict) -> bool:
    terms = row.get("_terms")
    if terms is None:
        needle = row.get("match_terms") or ""
        terms = tuple(term.lower() for term in needle.split("|") if term)
    lowered = query.lower()
    return any(term in lowered for term in terms)


HttpPostFn = Callable[[str], tuple[list[dict], dict]]


def search(
    queries: list[str],
    *,
    http_post: HttpPostFn | None = None,
    kind_hint: FindingKind | None = None,
) -> tuple[GuidelineResult, StageTrace]:
    """Stage-3b: fetch guideline evidence. `http_post=None` -> snapshot only."""
    started = time.perf_counter()
    prompt_tokens = completion_tokens = 0  # Tavily bills credits, not tokens (est. 0)
    degraded = False
    bundles: list[GuidelineBundle] = []

    if http_post is None and TAVILY_API_KEY is not None:
        def http_post(query: str) -> tuple[list[dict], dict]:  # type: ignore[misc]
            with httpx.Client(timeout=TAVILY_TIMEOUT_S) as client:
                response = client.post(
                    TAVILY_URL,
                    json={
                        "api_key": TAVILY_API_KEY,
                        "query": scrub_phi(query),
                        "search_depth": "advanced",
                        "max_results": 3,
                        "include_domains": AUTHORIZED_DOMAINS,
                        "include_raw_content": False,
                    },
                )
                response.raise_for_status()
                body = response.json()
            return body.get("results", []), {}

    if http_post is not None:
        try:
            for query in queries:
                rows, _meta = http_post(query)
                for row in rows[:3]:
                    bundles.append(
                        GuidelineBundle(
                            title=row.get("title", ""),
                            url=row.get("url", ""),
                            snippet=row.get("content", "")[:280],
                            source="tavily_live",
                        )
                    )
            if bundles:
                validated = [b for b in bundles if b.url]
                return (
                    GuidelineResult(queries=queries, guidelines=validated[:6]),
                    StageTrace(
                        stage="guideline", model_id=None,
                        latency_ms=int((time.perf_counter() - started) * 1000),
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        note="tavily_live",
                    ),
                )
            degraded = True  # live call succeeded but returned nothing usable
            logger.warning("Tavily returned no usable rows — snapshot fallback")
        except (httpx.HTTPError, TimeoutError, KeyError, json.JSONDecodeError) as exc:
            degraded = True
            logger.warning("Tavily failed (%s) — snapshot fallback", exc)

    snapshot = _load_cache_snapshot()
    matched = [
        row
        for row in snapshot
        if any(_snapshot_matches(q, row) for q in queries)
    ] or snapshot[:3]
    bundles = [
        GuidelineBundle(
            title=row.get("title", ""),
            url=row.get("url", ""),
            snippet=row.get("snippet", ""),
            source="cache_snapshot",
        )
        for row in matched
        if row.get("url")
    ]
    return (
        GuidelineResult(queries=queries, guidelines=bundles, degraded=True),
        StageTrace(
            stage="guideline",
            model_id=None,
            replayed=True,
            latency_ms=int((time.perf_counter() - started) * 1000),
            note="cache_snapshot" if degraded else "snapshot_only",
        ),
    )
