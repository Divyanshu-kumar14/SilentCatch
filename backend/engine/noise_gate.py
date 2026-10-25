"""Stage 2 — Sub-second SILENT_PASS triage gate via Nemotron 3 Nano (FR-2.1).

Contract:
- Decide SILENT_PASS vs ESCALATE from vision findings + packet + kinematics.
- Deterministic fail-safe overrides fire REGARDLESS of the model's opinion
  (PRD FR-2.1 edge — Nano may say "safe" and still lose, which is the point):
    * any UNADDRESSED incidental finding >= 4mm
    * any kinematic flag whose abs pct-delta >= 25%
  (the border confidence 0.35–0.65 edge resolves through these same forces)
- An incidental finding whose recommended CPT is already in the packet counts
  as ADDRESSED (ED-102 fast path — PRD §11: never nag on a closed loop).

In replay/no-key mode the deterministic triage IS the decision — badge
`deterministic_triage`.
"""

from __future__ import annotations

import json
import time

from backend.engine.llm_client import LlmUnverifiableError, parse_llm_json
from backend.engine.span_guard import assert_absent
from backend.engine.vision_extractor import LlmTransport
from backend.schemas import DischargePacket, GateDecision, KinematicSlope, ScanFinding, StageTrace

GATE_SYSTEM_PROMPT = (
    "You are an ER discharge triage gate. Decide whether the draft discharge "
    "packet is safe to clear silently. Return STRICT JSON only: "
    '{"action":"SILENT_PASS"|"ESCALATE","confidence":float,"reasons":[str]}. '
    "ESCALATE only for real clinical contradictions: dropped follow-up for an "
    "incidental finding, nephrotoxic drug against declining renal velocity, or "
    "an untreated acute lab trend."
)

BORDERLINE_CONFIDENCE_MIN = 0.35
BORDERLINE_CONFIDENCE_MAX = 0.65
FORCE_ESCALATE_MM = 4.0
FORCE_ESCALATE_PCT = 25.0


def unaddressed_findings(
    findings: list[ScanFinding], packet: DischargePacket
) -> list[ScanFinding]:
    unaddressed: list[ScanFinding] = []
    for finding in findings:
        # Incidental candidates count as addressed when their follow-up CPT exists
        if finding.recommended_cpt and not assert_absent(
            packet, cpt_code=finding.recommended_cpt
        ):
            continue
        unaddressed.append(finding)
    return unaddressed


def deterministic_forces(
    findings: list[ScanFinding],
    packet: DischargePacket,
    slopes: list[KinematicSlope],
) -> list[str]:
    """Evidence bullets that MUST force escalation (fail-safe, model-proof)."""
    forces: list[str] = []
    for finding in unaddressed_findings(findings, packet):
        mm = finding.measurement_mm or 0.0
        if mm >= FORCE_ESCALATE_MM:
            forces.append(
                f"deterministic override: unaddressed {mm}mm finding needs follow-up"
            )
    for slope in slopes:
        pct = abs(slope.pct_delta_from_baseline or 0.0)
        if slope.flags and (pct >= FORCE_ESCALATE_PCT or "OCCULT_HEMORRHAGE_SLOPE" in slope.flags):
            forces.append(
                f"deterministic override: {slope.analyte} moved {pct:.1f}% "
                f"with {slope.flags}"
            )
    return forces


def decide(
    findings: list[ScanFinding],
    packet: DischargePacket,
    slopes: list[KinematicSlope],
    flags: list[str],
    *,
    transport: LlmTransport | None = None,
    model_id: str = "",
    timeout_s: float = 2.0,
) -> tuple[GateDecision, StageTrace]:
    """Run the gate. `transport=None` -> pure deterministic triage (replay)."""
    started = time.perf_counter()
    forces = deterministic_forces(findings, packet, slopes)
    prompt_tokens = completion_tokens = 0

    if transport is None:
        decision = GateDecision(
            action="ESCALATE" if forces else "SILENT_PASS",
            reasons=list(forces) or ["deterministic triage: no contradiction evidence"],
            confidence=1.0,
            source="deterministic_triage",
        )
    else:
        payload = {
            "findings": [finding.model_dump() for finding in findings],
            "kinetic_flags": flags,
            "packet_orders": [order.cpt_code for order in packet.follow_up_orders],
            "prescriptions": [rx.drug_name for rx in packet.prescriptions],
        }
        try:
            raw, usage = transport(
                model_id,
                [
                    {"role": "system", "content": GATE_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": "DISCHARGE TRIAGE INPUT:\n"
                        + json.dumps(payload, indent=2),
                    },
                ],
                timeout_s=timeout_s,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
            prompt_tokens = int(usage.get("prompt_tokens", 0))
            completion_tokens = int(usage.get("completion_tokens", 0))
            decision = parse_llm_json(raw, GateDecision)
            decision.source = "nano_live"
        except (LlmUnverifiableError, TimeoutError) as exc:
            # Nano unreadable/late: rely on deterministic facts (fail-safe, loud note)
            decision = GateDecision(
                action="ESCALATE" if forces else "SILENT_PASS",
                reasons=list(forces) or [f"nano_failed: {exc}"],
                confidence=0.0,
                source="deterministic_override" if forces else "deterministic_triage",
            )

        # Fail-safe overrides: the model cannot silence provable contradictions.
        if decision.action == "SILENT_PASS" and forces:
            decision.action = "ESCALATE"
        if forces:
            merged = list(decision.reasons)
            for force in forces:
                if force not in merged:
                    merged.append(force)
            decision.reasons = merged

    trace = StageTrace(
        stage="gate",
        model_id=model_id or None,
        replayed=transport is None or decision.source != "nano_live",
        latency_ms=int((time.perf_counter() - started) * 1000),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        note=decision.source,
    )
    return decision, trace
