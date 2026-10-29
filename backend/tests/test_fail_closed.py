"""Fail-closed clearance tests: a degraded live audit must never clear green.

The demo/replay path intentionally returns SILENT_PASS for a clean fixture.
These tests cover the other case: live inference was requested and available,
but a required stage fell back or produced no prediction. The result must be
INCOMPLETE (discharge blocked), never SILENT_PASS.
"""

from __future__ import annotations

import json

from backend.engine import pipeline
from backend.engine.replay import ReplayStore
from backend.fixtures.loader import load_encounter


def _text(messages: list[dict]) -> str:
    user = messages[-1]["content"]
    return user if isinstance(user, str) else " ".join(
        part.get("text", "") for part in user
    )


def _usage() -> dict[str, int]:
    return {"prompt_tokens": 10, "completion_tokens": 5}


def test_vision_failure_cannot_clear_silently(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(pipeline, "NEBIUS_API_KEY", "stub-live-for-test")

    def transport(model_id, messages, *, timeout_s, extra_body=None):
        text = _text(messages)
        if "RADIOLOGY REPORT" in text:
            raise TimeoutError("vision provider down")
        if "DISCHARGE TRIAGE INPUT" in text:
            return json.dumps(
                {"action": "SILENT_PASS", "confidence": 0.99, "reasons": ["ok"]}
            ), _usage()
        raise AssertionError(f"unexpected prompt: {text[:80]}")

    events: list[dict] = []
    result = pipeline.run_audit(
        load_encounter("ED-101"),
        transport_factory=lambda: (transport, lambda: None),
        replay=ReplayStore(path=tmp_path / "replay.json"),
        emit=events.append,
    )

    assert result.status == "INCOMPLETE"
    assert result.error and "vision=fallback" in result.error
    assert result.execution_mode == "MIXED"
    assert result.fallback_used is True

    verdict = next(e for e in events if e["event"] == "verdict")["data"]
    assert verdict["status"] == "INCOMPLETE"
    assert "discharge blocked" in verdict["error"].lower()


def test_gate_fallback_uses_deterministic_triage(monkeypatch, tmp_path) -> None:
    """A gate model failure is covered by the deterministic triage rules.

    Vision is live and no deterministic force fires, so this is a complete
    deterministic pass. It stays SILENT_PASS but reports MIXED, never LIVE.
    """
    monkeypatch.setattr(pipeline, "NEBIUS_API_KEY", "stub-live-for-test")

    def transport(model_id, messages, *, timeout_s, extra_body=None):
        text = _text(messages)
        if "RADIOLOGY REPORT" in text:
            return json.dumps(
                {"findings": [], "vision_confidence": "HIGH"}
            ), _usage()
        if "DISCHARGE TRIAGE INPUT" in text:
            raise TimeoutError("gate provider down")
        raise AssertionError(f"unexpected prompt: {text[:80]}")

    result = pipeline.run_audit(
        load_encounter("ED-101"),
        transport_factory=lambda: (transport, lambda: None),
        replay=ReplayStore(path=tmp_path / "replay.json"),
    )

    assert result.status == "SILENT_PASS"
    assert result.execution_mode == "MIXED"
    assert result.fallback_used is True
    assert result.error is None
    gate = next(trace for trace in result.traces if trace.stage == "gate")
    assert gate.source == "deterministic_fallback"


def test_reasoning_failure_without_seed_cannot_clear(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(pipeline, "NEBIUS_API_KEY", "stub-live-for-test")

    def transport(model_id, messages, *, timeout_s, extra_body=None):
        text = _text(messages)
        if "RADIOLOGY REPORT" in text:
            return json.dumps(
                {"findings": [], "vision_confidence": "HIGH"}
            ), _usage()
        if "DISCHARGE TRIAGE INPUT" in text:
            return json.dumps(
                {"action": "ESCALATE", "confidence": 0.9, "reasons": ["kinetic flag"]}
            ), _usage()
        if "Contradiction kinds" in text:
            return json.dumps({"queries": ["aki nsaid contraindication"]}), _usage()
        if "CLINICAL CONTEXT" in text:
            raise TimeoutError("reasoning provider down")
        raise AssertionError(f"unexpected prompt: {text[:80]}")

    result = pipeline.run_audit(
        load_encounter("ED-104"),
        transport_factory=lambda: (transport, lambda: None),
        replay=ReplayStore(path=tmp_path / "replay.json"),
        allow_seed_fallback=False,
    )

    assert result.verdicts == []
    assert result.status == "INCOMPLETE"
    assert result.error and "reasoning=failure_no_prediction" in result.error
    assert result.execution_mode == "FAILED"


def test_deliberate_replay_still_clears_clean_fixture() -> None:
    """No key = honest REPLAYED mode; ED-101 remains a deterministic pass."""
    result = pipeline.run_audit(
        load_encounter("ED-101"),
        transport_factory=lambda: (None, lambda: None),
    )
    assert result.status == "SILENT_PASS"
    assert result.execution_mode == "REPLAYED"
    assert result.error is None


def test_summary_never_labels_fallback_only_run_as_live() -> None:
    """Cache + deterministic fallback means no live success: REPLAYED, not LIVE."""
    from backend.schemas import StageTrace

    traces = [
        StageTrace(stage="vision", source="cache_hit", replayed=True),
        StageTrace(stage="gate", source="deterministic_fallback", replayed=True),
    ]
    mode, sources, fallback = pipeline.audit_execution_summary(
        traces, ["vision", "gate"]
    )
    assert mode == "REPLAYED"
    assert fallback is True
    assert sources == {"vision": "cache_hit", "gate": "deterministic_fallback"}


def test_seed_fallback_reaudit_can_clear_patched_packet(monkeypatch, tmp_path) -> None:
    """The 1-click patch loop must still close when reasoning times out.

    Both expected findings are resolved in the patched packet, so the seed rig
    rejects them and returns zero verdicts. That is deterministic verification,
    not a missing prediction: the clearance stays, but provenance is MIXED.
    """
    from backend.schemas import FollowUpOrder, Prescription

    monkeypatch.setattr(pipeline, "NEBIUS_API_KEY", "stub-live-for-test")
    encounter = load_encounter("ED-104")
    packet = encounter.draft_discharge_packet
    packet.follow_up_orders.append(
        FollowUpOrder(
            specialty="Radiology",
            timeframe="6 months",
            reason="Fleischner follow-up chest CT",
            cpt_code="71250",
        )
    )
    packet.prescriptions = [
        rx for rx in packet.prescriptions if "ketorolac" not in rx.drug_name.lower()
    ]
    packet.prescriptions.append(
        Prescription(
            drug_name="Acetaminophen",
            dose="650 mg PO q6h PRN",
            days=5,
            drug_class="ANALGESIC",
        )
    )

    def transport(model_id, messages, *, timeout_s, extra_body=None):
        text = _text(messages)
        if "RADIOLOGY REPORT" in text:
            return json.dumps(
                {"findings": [], "vision_confidence": "HIGH"}
            ), _usage()
        if "DISCHARGE TRIAGE INPUT" in text:
            return json.dumps(
                {"action": "ESCALATE", "confidence": 0.9, "reasons": ["kinetic flag"]}
            ), _usage()
        if "Contradiction kinds" in text:
            return json.dumps({"queries": ["aki nsaid contraindication"]}), _usage()
        if "CLINICAL CONTEXT" in text:
            raise TimeoutError("reasoning provider down")
        raise AssertionError(f"unexpected prompt: {text[:80]}")

    result = pipeline.run_audit(
        encounter,
        transport_factory=lambda: (transport, lambda: None),
        replay=ReplayStore(path=tmp_path / "replay.json"),
    )

    assert result.verdicts == []
    assert result.status == "SILENT_PASS"
    assert result.execution_mode == "MIXED"
    assert result.fallback_used is True
    assert result.error is None
    reasoning = next(t for t in result.traces if t.stage == "reasoning")
    assert reasoning.source == "seed_fallback"
