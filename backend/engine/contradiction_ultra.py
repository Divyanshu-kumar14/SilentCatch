"""Stage 4 — Deep contradiction synthesis via Nemotron 3 Ultra (PRD FR-4.1).

Contract:
- Ultra receives scan findings + kinematic slopes + Stage-3 guideline bundle +
  discharge JSON and PROPOSES contradiction candidates (FindingSpec schema).
- Proposals are NEVER trusted: they run through the full deterministic rig
  (span-guard + absence + kinetic check, Phase-1 `run_deterministic_pipeline`)
  before becoming InterceptionVerdicts.
- Failure ladder (Fallback B + demo reliability R-2):
      Ultra (6s) -> failsafe Super (6s) -> deterministic seed candidates
  every layer honestly badged in the trace; guards run on ALL of them.
- Markdown-fenced/malformed output: 1 automatic repair retry carrying the
  exact validation error (FR-4.1), via the shared llm_client parser.
"""

from __future__ import annotations

import json
import logging
import time

from pydantic import BaseModel

from backend.config import REASONING_TIMEOUT_S
from backend.engine.deterministic import DeterministicFinding, run_deterministic_pipeline
from backend.engine.guideline_search import GuidelineResult
from backend.engine.llm_client import parse_llm_json
from backend.engine.vision_extractor import LlmTransport
from backend.schemas import (
    DischargePacket,
    FindingKind,
    FindingSpec,
    InterceptionVerdict,
    KinematicSlope,
    ScanFinding,
    StageTrace,
    VerifiedSpan,
)

logger = logging.getLogger(__name__)

GUIDE_URL_BY_KIND: dict[FindingKind, tuple[str, ...]] = {
    FindingKind.INCIDENTAL_FINDING_DROP: ("fleischner", "acr",),
    FindingKind.KINETIC_MED_COLLISION: ("ketorolac", "kdigo", "fda", "kidney",),
}


class CandidateBatch(BaseModel):
    """Strict Phase-4 output schema — a list of candidate FindingSpecs."""

    candidates: list[FindingSpec]


ULTRA_SYSTEM_PROMPT = (
    "You are a cross-modal clinical contradiction synthesizer. Given radiology "
    "findings, kinematic lab slopes, live guideline evidence and the draft "
    "discharge packet, propose contradictions as STRICT JSON only: "
    '{"candidates":[<FindingSpec>]} with keys: kind ("INCIDENTAL_FINDING_DROP"|'
    '"KINETIC_MED_COLLISION"), severity ("CRITICAL"|"WARNING"), explanation, '
    'source_quote (verbatim from the provided radiology report or lab note), '
    'source ("radiology_report"|"lab_note"), guideline_url|null, discharge_patch '
    "{remove_drug_name|null, add_prescription|null, add_follow_up_order|null, note}. "
    "NEVER fabricate quotes, measurements, or CPT codes — a deterministic guard "
    "will reject unprovable candidates, so prefer exactness over volume."
)


def _context_messages(
    findings: list[ScanFinding],
    slopes: list[KinematicSlope],
    flags: list[str],
    bundle: GuidelineResult,
) -> list[dict]:
    context = {
        "scan_findings": [f.model_dump() for f in findings],
        "kinematic_slopes": [s.model_dump() for s in slopes],
        "kinematic_flags": flags,
        "guideline_evidence": [g.model_dump() for g in bundle.guidelines[:4]],
        "discharge_packet_summary_refs": "packet JSON supplied at runtime",
    }
    return [{"role": "system", "content": ULTRA_SYSTEM_PROMPT},
            {"role": "user", "content": "CLINICAL CONTEXT:\n" + json.dumps(context, indent=2, default=str)}]


def _pick_guideline(bundle: GuidelineResult, kind: FindingKind) -> str | None:
    keywords = GUIDE_URL_BY_KIND.get(kind, ())
    for guide in bundle.guidelines:
        if any(keyword in guide.url.lower() or keyword in guide.title.lower() for keyword in keywords):
            return guide.url
    return bundle.guidelines[0].url if bundle.guidelines else None


def _to_verdict(
    finding: DeterministicFinding,
    spec: FindingSpec,
    bundle: GuidelineResult,
) -> InterceptionVerdict:
    guideline_url = spec.guideline_url or _pick_guideline(bundle, spec.kind)
    return InterceptionVerdict(
        kind=spec.kind,
        severity=spec.severity,
        explanation=spec.explanation,
        source_quote=spec.source_quote,
        verified_span=VerifiedSpan.model_validate(finding.verified_span),
        guideline_url=guideline_url,
        discharge_patch=spec.discharge_patch,
    )


def _match_spec(candidate: DeterministicFinding, specs: list[FindingSpec]) -> FindingSpec:
    """Pair a rig-verified candidate with its originating spec.

    The rig preserves explanation/severity/quote from the spec it verified, so
    an exact explanation match is canonical; kind-equality is the safe fallback.
    """
    same_kind = [spec for spec in specs if spec.kind == candidate.kind]
    if not same_kind:
        raise ValueError(f"No spec for verified candidate {candidate.kind}")
    for spec in same_kind:
        if spec.explanation == candidate.explanation:
            return spec
    return same_kind[0]


def synthesize_verdicts(
    encounter_id: str,
    radiology_report: str,
    lab_note: str | None,
    serial_labs: dict[str, list],
    packet: DischargePacket,
    *,
    findings: list[ScanFinding],
    slopes: list[KinematicSlope],
    flags: list[str],
    bundle: GuidelineResult,
    seed_candidates: list[FindingSpec] | None,
    transport: LlmTransport | None = None,
    model_id: str = "",
    failsafe_model_id: str = "",
    timeout_s: float = REASONING_TIMEOUT_S,
) -> tuple[list[InterceptionVerdict], StageTrace]:
    """Stage-4 runner: propose -> guard -> verdicts. Guards run at every layer."""
    started = time.perf_counter()
    used_model = model_id
    replayed = transport is None
    prompt_tokens = completion_tokens = 0
    candidates: list[FindingSpec] | None = None

    parsed_empty = False
    raised_any = False
    failsafe_tier = False
    if transport is not None:
        messages = _context_messages(findings, slopes, flags, bundle)
        attempts: list[tuple[str, str]] = (
            [(model_id, "reasoning"), (failsafe_model_id, "failsafe_super")]
            if failsafe_model_id
            else [(model_id, "reasoning")]
        )
        for attempt_model, attempt_note in attempts:
            try:
                raw, usage = transport(attempt_model, messages, timeout_s=timeout_s)
                prompt_tokens += int(usage.get("prompt_tokens", 0))
                completion_tokens += int(usage.get("completion_tokens", 0))

                def repair(error: str, _model: str = attempt_model) -> str:
                    """FR-4.1 one-shot repair — re-ask with the exact error text."""
                    nonlocal prompt_tokens, completion_tokens
                    retry_messages = list(messages)
                    retry_messages[-1] = {
                        "role": "user",
                        "content": (
                            retry_messages[-1]["content"]
                            + "\n\nYour previous reply failed schema validation "
                            f"({error}). Return ONLY corrected strict JSON."
                        ),
                    }
                    raw2, usage2 = transport(_model, retry_messages, timeout_s=timeout_s)
                    prompt_tokens += int(usage2.get("prompt_tokens", 0))
                    completion_tokens += int(usage2.get("completion_tokens", 0))
                    return raw2

                batch = parse_llm_json(raw, CandidateBatch, retry_call=repair)
                if not batch.candidates:
                    parsed_empty = True
                    logger.warning(
                        "Stage-4 %s proposed zero candidates — advancing ladder",
                        attempt_note,
                    )
                    continue
                candidates = batch.candidates
                used_model, replayed = attempt_model, False
                failsafe_tier = attempt_note == "failsafe_super"
                break
            except Exception as exc:  # noqa: BLE001 — each tier is a fallback rung
                raised_any = True
                logger.warning(
                    "Stage-4 attempt %s failed (%s) — advancing fallback ladder",
                    attempt_note,
                    exc,
                )

    if candidates is None and transport is not None:
        # Ladder exhausted: what follows comes from the seed rig, not the model
        replayed = True

    seed_fell_back = candidates is None
    if seed_fell_back:
        candidates = list(seed_candidates or [])

    def _rig(specs: list[FindingSpec]) -> list[InterceptionVerdict]:
        rig_run = run_deterministic_pipeline(
            encounter_id=encounter_id,
            radiology_report=radiology_report,
            lab_note=lab_note,
            serial_labs=serial_labs,
            packet=packet,
            candidates=specs,
        )
        return [
            _to_verdict(verified, _match_spec(verified, specs), bundle)
            for verified in rig_run.sent_findings
        ]

    verdicts = _rig(candidates)

    rescued = False
    if candidates and not seed_fell_back and not verdicts and seed_candidates:
        # R-2: live proposals existed but the guards rejected ALL of them —
        # rescue via the seed candidates through the same rig, honest re-badge.
        verdicts = _rig(list(seed_candidates))
        rescued = bool(verdicts)
        if rescued:
            replayed = True  # finals did not come from the live model

    if transport is None:
        model_note = "deterministic_seed_rig"
    elif rescued:
        model_note = "rig_rejected_seed_rescue"
    elif replayed:
        # Honest badge: every verdict below came from the seed rig, not the
        # live model (ladder failed, or every tier proposed nothing usable).
        if raised_any and parsed_empty:
            model_note = f"failure_fallback+empty_proposal:{used_model}"
        elif raised_any:
            model_note = f"failure_fallback:{used_model}"
        elif parsed_empty:
            model_note = "empty_proposal_seed_fallback"
        else:
            model_note = f"seed_fallback:{used_model}"
    else:
        model_note = used_model + ("|failsafe_tier" if failsafe_tier else "")

    trace = StageTrace(
        stage="reasoning",
        model_id=used_model or None,
        replayed=replayed,
        latency_ms=int((time.perf_counter() - started) * 1000),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        note=model_note,
    )
    return verdicts, trace
