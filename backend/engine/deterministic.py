"""Deterministic contradiction-verification rig (PRD §1 contract, Phase-1 scope).

Finds NOTHING on its own — it is the *verifier* half of
"the model proposes; deterministic code verifies" (PRD Phase 0).

For each candidate FindingSpec (in production these come from Stage 4 Nemotron
Ultra; in Phase-1 tests they come from fixture metadata) it runs the full
deterministic gate stack:
  1. verify_quote()   -> exact span into radiology report or lab note (FR-4.2a)
  2. assert_absent()  -> required CPT/drug missing from packet (FR-4.2b)
  3. kinetic check    -> for KINETIC_MED_COLLISION, a real kinematic flag exists

A candidate that fails ANY gate is rejected (never surfaced). The runner returns
per-encounter evidence + slopes for the SSE endpoint (Phase 2) and eval suite.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from backend.engine import kinematic_labs
from backend.engine.span_guard import assert_absent, verify_quote
from backend.schemas import (
    DischargePacket,
    FindingKind,
    FindingSpec,
    KinematicSlope,
)


class DeterministicFinding(BaseModel):
    kind: FindingKind
    severity: str
    explanation: str
    guideline_url: str | None = None
    quote_source: str  # "radiology_report" | "lab_note"
    verified_span: dict  # VerifiedSpan.model_dump() — offsets into source_text
    source_text: str
    rejected: bool = False
    rejection_reason: str = ""


class DeterministicResult(BaseModel):
    encounter_id: str
    slopes: list[KinematicSlope] = Field(default_factory=list)
    kinetic_flags: list[str] = Field(default_factory=list)
    findings: list[DeterministicFinding] = Field(default_factory=list)
    sent_findings: list[DeterministicFinding] = Field(default_factory=list)
    ok: bool = True


def _source_text(
    spec: FindingSpec, radiology_report: str, lab_note: str | None
) -> str | None:
    if spec.source == "radiology_report":
        return radiology_report
    if spec.source == "lab_note":
        return lab_note
    return None


def run_deterministic_pipeline(
    encounter_id: str,
    radiology_report: str,
    lab_note: str | None,
    serial_labs: dict[str, list],
    packet: DischargePacket,
    candidates: list[FindingSpec] | None = None,
    slopes: list[KinematicSlope] | None = None,
    kinetic_flags: list[str] | None = None,
) -> DeterministicResult:
    """Verify all candidate contradictions against input chart evidence only."""
    if slopes is None:
        slopes = kinematic_labs.analyze_serial_labs(serial_labs)
    if kinetic_flags is None:
        kinetic_flags = kinematic_labs.all_flags(slopes)
    result = DeterministicResult(
        encounter_id=encounter_id, slopes=slopes, kinetic_flags=kinetic_flags
    )

    for spec in candidates or []:
        source_text = _source_text(spec, radiology_report, lab_note)
        verified_span: dict = {}
        reject = ""

        if source_text is None:
            reject = f"INPUT_FAIL: missing {spec.source}"
        else:
            span = verify_quote(source_text, spec.source_quote)
            if span is None:
                reject = "SPAN_GUARD_FAIL: quote not provably in source"
            elif spec.kind == FindingKind.INCIDENTAL_FINDING_DROP:
                add_order = spec.discharge_patch.add_follow_up_order
                cpt = add_order.cpt_code if add_order else None
                if not assert_absent(packet, cpt_code=cpt):
                    reject = "ABSENCE_FAIL: follow-up CPT already present in packet"
            elif spec.kind == FindingKind.KINETIC_MED_COLLISION:
                if not _packet_has_drug(packet, spec.discharge_patch.remove_drug_name or ""):
                    reject = "ABSENCE_FAIL: collision drug not actually prescribed"
                elif not any(
                    f.startswith(("KINETIC_", "OCCULT_")) for f in kinetic_flags
                ):
                    reject = "KINETIC_FAIL: no deterministic lab-velocity flag"
            else:  # unknown kind -> never surface
                reject = f"KIND_FAIL: unsupported kind {spec.kind}"
            if span is not None:
                verified_span = span.model_dump()

        result.findings.append(
            DeterministicFinding(
                kind=spec.kind,
                severity=spec.severity,
                explanation=spec.explanation,
                guideline_url=spec.guideline_url,
                quote_source=spec.source,
                verified_span=verified_span,
                source_text=source_text or "",
                rejected=bool(reject),
                rejection_reason=reject,
            )
        )
    result.sent_findings = [f for f in result.findings if not f.rejected]
    return result


def _packet_has_drug(packet: DischargePacket, drug_name: str) -> bool:
    needle = (drug_name or "").strip().lower()
    if not needle:
        return False
    return any(needle in rx.drug_name.strip().lower() for rx in packet.prescriptions)
