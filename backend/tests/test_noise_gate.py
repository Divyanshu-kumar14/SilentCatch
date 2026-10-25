"""Stage-2 gates (plan 2.2): Nano decision + deterministic fail-safe overrides."""

from __future__ import annotations

import json

from backend.engine import kinematic_labs, noise_gate
from backend.fixtures.loader import load_encounter
from backend.schemas import ScanFinding


def _scan(description: str, mm: float | None, cpt: str | None, *, acute: bool = False) -> ScanFinding:
    return ScanFinding(
        description=description,
        measurement_mm=mm,
        acute=acute,
        verbatim_quote=description,
        recommended_cpt=cpt,
    )


def _nano_transport(payload: dict):
    def transport(model_id, messages, *, timeout_s, extra_body=None):
        return json.dumps(payload), {"prompt_tokens": 88, "completion_tokens": 12}

    return transport


def _ed104_inputs():
    encounter = load_encounter("ED-104")
    slopes = kinematic_labs.analyze_serial_labs(encounter.serial_labs)
    flags = kinematic_labs.all_flags(slopes)
    findings = [
        _scan("Incidental 7.2 mm spiculated nodule", 7.2, "71250", acute=False),
        _scan("Right 7th rib fracture", None, None, acute=True),
    ]
    return encounter, findings, slopes, flags


def test_ed104_escalates_even_when_nano_says_safe() -> None:
    """PRD FR-2.1: fail-safe forces win over ANY Nano opinion."""
    encounter, findings, slopes, flags = _ed104_inputs()
    decision, trace = noise_gate.decide(
        findings,
        encounter.draft_discharge_packet,
        slopes,
        flags,
        transport=_nano_transport(
            {"action": "SILENT_PASS", "confidence": 0.99, "reasons": ["all clear"]}
        ),
        model_id="nano",
    )
    assert decision.action == "ESCALATE"
    assert any("deterministic override" in reason for reason in decision.reasons)
    assert decision.source == "nano_live"
    assert trace.stage == "gate"


def test_ed101_deterministic_silent_pass() -> None:
    encounter = load_encounter("ED-101")
    slopes = kinematic_labs.analyze_serial_labs(encounter.serial_labs)
    decision, trace = noise_gate.decide(
        [], encounter.draft_discharge_packet, slopes, [], transport=None
    )
    assert decision.action == "SILENT_PASS"
    assert decision.source == "deterministic_triage"
    assert trace.replayed is True


def test_ed102_addressed_finding_allows_nano_silence() -> None:
    """PRD §11 ED-102: 6mm nodule + CPT 71250 already ordered -> Nano silence wins."""
    encounter = load_encounter("ED-102")
    findings = [_scan("Incidental 6 mm nodule — follow-up scheduled", 6.0, "71250")]
    slopes = kinematic_labs.analyze_serial_labs(encounter.serial_labs)
    decision, _ = noise_gate.decide(
        findings,
        encounter.draft_discharge_packet,
        slopes,
        [],
        transport=_nano_transport(
            {"action": "SILENT_PASS", "confidence": 0.8, "reasons": ["ok"]}
        ),
        model_id="nano",
    )
    assert decision.action == "SILENT_PASS"


def test_ed102_missing_order_would_force_escalate() -> None:
    """Same finding but WITHOUT the order in packet -> override fires at 6mm."""
    from backend.schemas import DischargePacket

    encounter = load_encounter("ED-102")
    packet: DischargePacket = encounter.draft_discharge_packet.model_copy(deep=True)
    packet.follow_up_orders = [
        order for order in packet.follow_up_orders if order.cpt_code != "71250"
    ]
    findings = [_scan("Incidental 6 mm nodule", 6.0, "71250")]
    slopes = kinematic_labs.analyze_serial_labs(encounter.serial_labs)
    decision, _ = noise_gate.decide(findings, packet, slopes, [], transport=None)
    assert decision.action == "ESCALATE"
    assert any("6.0mm" in reason for reason in decision.reasons)


def test_unparseable_nano_falls_back_deterministically() -> None:
    """Nano failure/timeout must NEVER crash the audit — facts decide instead."""
    encounter, findings, slopes, flags = _ed104_inputs()

    def broken_transport(model_id, messages, *, timeout_s, extra_body=None):
        raise TimeoutError("nano slow")

    decision, _ = noise_gate.decide(
        findings, encounter.draft_discharge_packet, slopes, flags,
        transport=broken_transport, model_id="nano",
    )
    assert decision.action == "ESCALATE"
    assert decision.source == "deterministic_override"


def test_unaddressed_findings_respects_absence_check() -> None:
    packet = load_encounter("ED-102").draft_discharge_packet
    addressed = _scan("nodule", 6.0, "71250")
    dropped = _scan("mass", 9.0, "71271")
    unaddressed = noise_gate.unaddressed_findings([addressed, dropped], packet)
    assert addressed not in unaddressed
    assert dropped in unaddressed
