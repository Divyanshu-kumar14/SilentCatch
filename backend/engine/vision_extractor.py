"""Stage 1 — Visual scan extraction via Nemotron 3.5 Super VL (PRD FR-1.1).

Sources (same output schema, honestly badged):
- vl_live:    real Token Factory call (image b64 + report), thinking OFF
- vl_capture: recorded live response via ReplayStore
- vl_seed:    no transport (no key) or unusable image -> deterministic regex
              extraction over the report text; vision_confidence set LOW so
              telemetry never claims vision it did not perform

Fallback A (PRD §10): decode with Pillow, resize to max-edge 768, re-encode
PNG before base64. D-1 (PRD §9): cache by SHA-256 of ORIGINAL bytes.
"""

from __future__ import annotations

import base64
import functools
import hashlib
import io
import logging
import re
import time
from typing import Callable, Protocol

from PIL import Image

from backend.engine.llm_client import parse_llm_json
from backend.schemas import ScanFinding, StageTrace, VisionResult

logger = logging.getLogger(__name__)


class LlmTransport(Protocol):
    """Seam for live/replay tests. Returns (content_text, usage_dict)."""

    def __call__(
        self,
        model_id: str,
        messages: list[dict],
        *,
        timeout_s: float,
        extra_body: dict | None = None,
    ) -> tuple[str, dict]: ...


VISION_IMAGE_MAX_EDGE_PX = 768  # PRD Fallback A

_MM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(mm|cm)", re.IGNORECASE)
_LESION_WORDS = ("nodule", "mass", "lesion", "aneurysm", "calcification", "adrenal")
_ACUTE_WORDS = ("fracture", "consolidation", "pneumothorax", "stone", "hematoma")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.;])\s+")
_FOLLOWUP_CPT_HINTS: dict[str, str] = {
    "nodule": "71250",  # CT thorax, follow-up
    "mass": "74170",
    "adrenal": "74170",
    "aneurysm": "74150",
}


def image_sha256(image_bytes: bytes) -> str:
    return hashlib.sha256(image_bytes).hexdigest()


def normalize_image_png(image_bytes: bytes) -> bytes:
    """Fallback A: decode -> long-edge 768 -> PNG encode (alpha-safe grayscale-ish)."""
    with Image.open(io.BytesIO(image_bytes)) as img:
        img = img.convert("RGB")
        wide, tall = img.size
        scale = VISION_IMAGE_MAX_EDGE_PX / max(wide, tall)
        if scale < 1.0:
            img = img.resize(
                (max(1, int(wide * scale)), max(1, int(tall * scale))),
                Image.LANCZOS,
            )
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        return buffer.getvalue()


@functools.lru_cache(maxsize=64)
def _parse_report_sentences_cached(report_text: str) -> tuple[ScanFinding, ...]:
    findings: list[ScanFinding] = []
    for sentence in _SENTENCE_SPLIT_RE.split(report_text or ""):
        lowered = sentence.lower()
        mm = _MM_RE.search(sentence)
        incidental = any(word in lowered for word in _LESION_WORDS)
        acute = any(word in lowered for word in _ACUTE_WORDS)
        if not (mm and (incidental or acute)):
            continue
        word = next((word for word in _LESION_WORDS if word in lowered), None)
        unit = (mm.group(2) or "mm").lower()
        val = float(mm.group(1)) * (10.0 if unit == "cm" else 1.0)
        cpt = "74170" if "adrenal" in lowered else (_FOLLOWUP_CPT_HINTS.get(word) if incidental else None)
        findings.append(
            ScanFinding(
                description=sentence.strip(),
                measurement_mm=round(val, 1),
                acute=acute,
                verbatim_quote=sentence.strip(),
                recommended_cpt=cpt,
            )
        )
    return tuple(findings)


def parse_report_sentences(report_text: str) -> list[ScanFinding]:
    """Deterministic mm-sentence extractor powering the seed path."""
    return [f.model_copy() for f in _parse_report_sentences_cached(report_text)]


VISION_SYSTEM_PROMPT = (
    "You are a hospital CT image + report parser. Given a key annotated slice "
    "and the radiology report, extract findings as STRICT JSON with keys "
    '"findings":[{"description":str,"location":str|null,"measurement_mm":'
    'float|null,"acute":bool,"verbatim_quote":str,"recommended_cpt":str|null}] '
    'and "vision_confidence":"HIGH"|"LOW". verbatim_quote MUST be copied '
    "character-for-character from the report text."
)


def _vl_messages(image_png: bytes | None, report_text: str) -> list[dict]:
    if image_png is None:
        user_content: str | list[dict] = f"RADIOLOGY REPORT:\n{report_text}"
    else:
        b64 = base64.b64encode(image_png).decode()
        user_content = [
            {"type": "text", "text": f"RADIOLOGY REPORT:\n{report_text}"},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ]
    return [
        {"role": "system", "content": VISION_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def extract_findings(
    report_text: str,
    *,
    image_png: bytes | None = None,
    transport: LlmTransport | None = None,
    model_id: str = "",
    vision_cache: dict[str, VisionResult] | None = None,
    timeout_s: float = 5.0,
) -> tuple[VisionResult, StageTrace]:
    """Stage 1 runner. Returns (result, trace) — trace feeds SSE + cost ledger."""
    started = time.perf_counter()
    prompt_tokens = completion_tokens = 0
    model_attempted = False
    trace_source = "replay_seed"

    # D-1: identical image bytes are never re-inferred
    if image_png is not None and vision_cache is not None:
        cached = vision_cache.get(image_sha256(image_png))
        if cached is not None:
            trace = StageTrace(
                stage="vision",
                model_id=None,
                replayed=True,  # no live call was made in THIS audit (D-1)
                latency_ms=round((time.perf_counter() - started) * 1000.0, 3),
                note="cache_hit",
                source="cache_hit",
            )
            return cached.model_copy(deep=True), trace

    if transport is None or image_png is None:
        # Seed / degraded path (FR-1.1 edge: missing or corrupt image)
        trace_source = "replay_seed" if transport is None else "text_only_seed"
        result = VisionResult(
            findings=parse_report_sentences(report_text),
            vision_confidence="LOW" if image_png is None else "MEDIUM",
            source="vl_seed",
            note="text_only_fallback" if image_png is None else "no_transport",
        )
    else:
        model_attempted = True
        normalized = normalize_image_png(image_png)
        try:
            raw, usage = transport(
                model_id,
                _vl_messages(normalized, report_text),
                timeout_s=timeout_s,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
            prompt_tokens = int(usage.get("prompt_tokens", 0))
            completion_tokens = int(usage.get("completion_tokens", 0))

            def repair(error: str) -> str:
                nonlocal prompt_tokens, completion_tokens
                messages = [
                    {"role": "system", "content": VISION_SYSTEM_PROMPT},
                    {"role": "user", "content": f"RADIOLOGY REPORT:\n{report_text}"},
                    {"role": "assistant", "content": raw},
                    {
                        "role": "user",
                        "content": (
                            "Validation failed. Return ONLY corrected JSON. "
                            f"Error: {error}"
                        ),
                    },
                ]
                raw2, usage2 = transport(
                    model_id, messages, timeout_s=timeout_s,
                    extra_body={"chat_template_kwargs": {"enable_thinking": False}},
                )
                # Honest ledger: repair-call tokens count against the same stage.
                prompt_tokens += int(usage2.get("prompt_tokens", 0))
                completion_tokens += int(usage2.get("completion_tokens", 0))
                return raw2

            result = parse_llm_json(raw, VisionResult, retry_call=repair)
            result.source = "vl_live"
            trace_source = "live"
        except Exception as exc:  # noqa: BLE001 — provider failure degrades loudly
            logger.warning("VL stage failed (%s) — seed fallback", exc)
            trace_source = "fallback"
            result = VisionResult(
                findings=parse_report_sentences(report_text),
                vision_confidence="LOW",
                source="vl_seed",
                note=f"vl_fallback: {type(exc).__name__}",
            )

    if image_png is not None and vision_cache is not None:
        vision_cache[image_sha256(image_png)] = result

    trace = StageTrace(
        stage="vision",
        # Only claim a model when a provider call was actually attempted.
        model_id=(model_id or None) if model_attempted else None,
        replayed=trace_source != "live",
        latency_ms=round((time.perf_counter() - started) * 1000.0, 3),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        note=result.note or result.source,
        source=trace_source,
    )
    return result, trace
