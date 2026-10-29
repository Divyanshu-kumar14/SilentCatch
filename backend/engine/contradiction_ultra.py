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


FINDING_SPEC_SCHEMA = (
    " EXACT NESTED SHAPES (every key required unless marked ?): "
    'FollowUpOrder={"specialty":str,"timeframe":str,"reason":str,"cpt_code":str}; '
    'Prescription={"drug_name":str,"dose":str,"days":int,"class":str (literal key "class")}; '
    'DischargePatch={"remove_drug_name"?:str|null,"add_prescription"?:Prescription|null,'
    '"add_follow_up_order"?:FollowUpOrder|null,"note":str REQUIRED}; '
    'FindingSpec={"kind","severity","explanation","source_quote",'
    '"source" ("radiology_report"|"lab_note"),"guideline_url"?:str|null,'
    '"discharge_patch":DischargePatch}; top level {"candidates":[FindingSpec]}. '
    "NEVER emit objects as strings — add_follow_up_order and add_prescription "
    "are OBJECTS or null, never prose. NEVER guess keys (no drug/description/order). "
    'COMPLETE VALID EXAMPLE: {"candidates":[{"kind":"INCIDENTAL_FINDING_DROP",'
    '"severity":"CRITICAL","explanation":"7.2 mm RUL nodule with no follow-up order",'
    '"source_quote":"Incidental 7.2 mm spiculated solid noncalcified nodule '
    'in the right upper lobe","source":"radiology_report","guideline_url":null,'
    '"discharge_patch":{"remove_drug_name":null,"add_prescription":null,'
    '"add_follow_up_order":{"specialty":"Radiology","timeframe":"6 months",'
    '"reason":"nodule follow-up","cpt_code":"71250"},'
    '"note":"add nodule surveillance order"}}]} '
    "Propose a candidate for EVERY contradiction present — imaging findings AND "
    "medication collisions; never stop after the first. SECOND EXAMPLE (drug): "
    '{"kind":"KINETIC_MED_COLLISION","severity":"CRITICAL",'
    '"explanation":"NSAID vs AKI velocity",'
    '"source_quote":"creatinine rising 0.62 → 0.88 → 1.16 mg/dL over 36 hours",'
    '"source":"lab_note","guideline_url":null,'
    '"discharge_patch":{"remove_drug_name":"Ketorolac tromethamine (Toradol)",'
    '"add_prescription":{"drug_name":"Acetaminophen with codeine substitution note",'
    '"dose":"650 mg PO q6h PRN (renal-safe)","days":5,"class":"ANALGESIC"},'
    '"add_follow_up_order":null,"note":"swap to renal-safe analgesia"}}'
)


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
    "will reject unprovable candidates, so prefer exactness over volume. "
    "Copy source_quote character-for-character from RADIOLOGY REPORT or LAB NOTE "
    "in the context and set source to match; use DRAFT PACKET drug/order names exactly."
    + FINDING_SPEC_SCHEMA
)


def _context_messages(
    findings: list[ScanFinding],
    slopes: list[KinematicSlope],
    flags: list[str],
    bundle: GuidelineResult,
    radiology_report: str,
    lab_note: str | None,
    packet: DischargePacket,
) -> list[dict]:
    context = {
        "scan_findings": [f.model_dump() for f in findings],
        "kinematic_slopes": [s.model_dump() for s in slopes],
        "kinematic_flags": flags,
        "guideline_evidence": [g.model_dump() for g in bundle.guidelines[:4]],
        # Quotable sources: the rig demands verbatim quotes, so the model must
        # see the exact texts (previously withheld — unquotable by construction).
        "radiology_report": radiology_report,
        "lab_note": lab_note or "",
        "draft_packet_prescriptions": [
            {"drug_name": rx.drug_name, "dose": rx.dose}
            for rx in packet.prescriptions
        ],
        "draft_packet_orders": [
            {"specialty": o.specialty, "cpt_code": o.cpt_code}
            for o in packet.follow_up_orders
        ],
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
    allow_seed_fallback: bool = True,
) -> tuple[list[InterceptionVerdict], StageTrace]:
    """Stage-4 runner: propose -> guard -> verdicts. Guards run at every layer.

    `allow_seed_fallback=False` is the predictive-evaluation mode: expected-label
    fixtures may NEVER become a prediction. If every live tier fails, the function
    returns no verdicts with an explicit failure source instead of a seed answer.
    """
    started = time.perf_counter()
    used_model: str | None = None
    last_attempt_model: str | None = None
    attempted_models: list[str] = []
    replayed = transport is None
    prompt_tokens = completion_tokens = 0
    candidates: list[FindingSpec] | None = None
    live_outcome: str | None = None  # live | empty | failed
    parsed_empty = False
    raised_any = False
    failsafe_tier = False
    seed_fell_back = False
    rescued = False

    if transport is not None:
        messages = _context_messages(
            findings, slopes, flags, bundle,
            radiology_report, lab_note, packet,
        )
        attempts: list[tuple[str, str]] = (
            [(model_id, "reasoning"), (failsafe_model_id, "failsafe_super")]
            if failsafe_model_id
            else [(model_id, "reasoning")]
        )
        for attempt_model, attempt_note in attempts:
            attempted_models.append(attempt_model)
            last_attempt_model = attempt_model
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
                            + FINDING_SPEC_SCHEMA
                        ),
                    }
                    raw2, usage2 = transport(_model, retry_messages, timeout_s=timeout_s)
                    prompt_tokens += int(usage2.get("prompt_tokens", 0))
                    completion_tokens += int(usage2.get("completion_tokens", 0))
                    return raw2

                batch = parse_llm_json(raw, CandidateBatch, retry_call=repair)
                used_model = attempt_model
                if not batch.candidates:
                    parsed_empty = True
                    logger.warning(
                        "Stage-4 %s proposed zero candidates — advancing ladder",
                        attempt_note,
                    )
                    continue
                candidates = batch.candidates
                failsafe_tier = attempt_note == "failsafe_super"
                live_outcome = "live"
                break
            except Exception as exc:  # noqa: BLE001 — each tier is a fallback rung
                raised_any = True
                logger.warning(
                    "Stage-4 attempt %s failed (%s) — advancing fallback ladder",
                    attempt_note,
                    exc,
                )

        if candidates is None:
            # A valid empty response is a real (negative) model prediction;
            # a timeout/schema failure is not. Keep them distinct.
            live_outcome = "empty" if parsed_empty and not raised_any else "failed"

    if candidates is None:
        if allow_seed_fallback:
            candidates = list(seed_candidates or [])
            seed_fell_back = bool(candidates)
        else:
            candidates = []

    def _rig(specs: list[FindingSpec]) -> list[InterceptionVerdict]:
        rig_run = run_deterministic_pipeline(
            encounter_id=encounter_id,
            radiology_report=radiology_report,
            lab_note=lab_note,
            serial_labs=serial_labs,
            packet=packet,
            candidates=specs,
            slopes=slopes,
            kinetic_flags=flags,
        )
        return [
            _to_verdict(verified, _match_spec(verified, specs), bundle)
            for verified in rig_run.sent_findings
        ]

    verdicts = _rig(candidates)

    if (
        allow_seed_fallback
        and candidates
        and live_outcome == "live"
        and not verdicts
        and seed_candidates
    ):
        # R-2: live proposals existed but the guards rejected ALL of them —
        # rescue via the seed candidates through the same rig, honest re-badge.
        # Never enabled in predictive evaluation (allow_seed_fallback=False).
        verdicts = _rig(list(seed_candidates))
        rescued = bool(verdicts)

    # ---------------------------------------------------------------- provenance
    if rescued:
        source = "seed_rescue"
        replayed = True
        model_note = "rig_rejected_seed_rescue"
    elif transport is None:
        source = "seed_replay" if candidates else "replay_no_prediction"
        replayed = True
        model_note = "deterministic_seed_rig" if candidates else "replay_no_prediction"
    elif seed_fell_back:
        source = "seed_fallback"
        replayed = True
        if live_outcome == "empty":
            model_note = "empty_proposal_seed_fallback"
        elif raised_any:
            model_note = f"failure_fallback:{last_attempt_model}"
        else:
            model_note = f"seed_fallback:{last_attempt_model}"
    elif live_outcome == "live":
        source = "failsafe_live" if failsafe_tier else "live"
        replayed = False
        model_note = (used_model or "") + ("|failsafe_tier" if failsafe_tier else "")
        if candidates and not verdicts:
            source = "live_rejected"
            model_note = f"live_candidates_rejected:{used_model}"
    elif live_outcome == "empty":
        source = "live_empty"
        replayed = False
        model_note = f"live_empty_proposal:{used_model}"
    else:
        source = "failure_no_prediction"
        replayed = True
        model_note = f"failure_no_prediction:{last_attempt_model}"

    trace = StageTrace(
        stage="reasoning",
        model_id=(used_model or last_attempt_model) if transport is not None else None,
        replayed=replayed,
        latency_ms=round((time.perf_counter() - started) * 1000.0, 3),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        note=model_note,
        source=source,
        payload={
            "attempted_models": attempted_models,
            "proposal_status": live_outcome or "not_called",
            "candidate_count": len(candidates or []),
            "verified_count": len(verdicts),
            "seed_fallback_allowed": allow_seed_fallback,
        },
    )
    return verdicts, trace
