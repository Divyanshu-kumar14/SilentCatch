"""Phase-2 integration (plan 2.5): ordered SSE stream, gate latency, endpoint."""

from __future__ import annotations

import json
import time

from fastapi.testclient import TestClient

from backend.engine import pipeline
from backend.engine.replay import ReplayStore
from backend.fixtures.loader import load_encounter
from backend.main import app

_SILENT_BUDGET_S = 1.2  # PRD FR-5 gate-path budget


def _run(eid: str, **kwargs):
    events: list[dict] = []
    result = pipeline.run_audit(
        load_encounter(eid),
        transport_factory=lambda: (None, lambda: None),
        emit=events.append,
        **kwargs,
    )
    return result, events


def test_ed104_streams_ordered_stages_and_two_verdicts() -> None:
    result, events = _run("ED-104")
    names = [e["event"] for e in events]
    assert names[0] == "run_start"
    assert names[-1] == "done"
    starts = [e["data"]["stage"] for e in events if e["event"] == "stage_start"]
    assert starts == ["vision", "gate", "guideline", "reasoning"]
    done_payload = {
        e["data"]["stage"]: e["data"] for e in events if e["event"] == "stage_done"
    }
    assert done_payload["gate"]["decision"]["action"] == "ESCALATE"
    verdict_event = next(e for e in events if e["event"] == "verdict")
    assert verdict_event["data"]["status"] == "CRITICAL_INTERCEPT"
    assert len(verdict_event["data"]["verdicts"]) == 2
    kinds = {v["kind"] for v in verdict_event["data"]["verdicts"]}
    assert kinds == {"INCIDENTAL_FINDING_DROP", "KINETIC_MED_COLLISION"}
    # verdict and done carry the same final payload
    assert verdict_event["data"] == events[-1]["data"]
    reasoning_note = done_payload["reasoning"]["trace"]["note"]
    assert reasoning_note.startswith("deterministic_seed_rig")
    # honest replay economics: zero live calls on the no-key path
    assert result.total_cost_usd == 0.0
    assert all(trace.replayed for trace in result.traces)


def test_silent_encounters_under_gate_latency_budget() -> None:
    for eid in ("ED-101", "ED-102"):
        started = time.perf_counter()
        result, events = _run(eid)
        elapsed = time.perf_counter() - started
        assert result.status == "SILENT_PASS", eid
        assert elapsed < _SILENT_BUDGET_S, f"{eid} gate budget blown: {elapsed:.3f}s"
        starts = [e["data"]["stage"] for e in events if e["event"] == "stage_start"]
        assert starts == ["vision", "gate"], "gate path must skip stages 3+4"


def test_event_stream_is_progressive_and_terminates() -> None:
    stream = list(pipeline.event_stream(load_encounter("ED-101")))
    assert stream[0]["event"] == "run_start"
    assert stream[-1]["event"] == "done"
    vision_done_idx = next(
        i for i, e in enumerate(stream) if e["event"] == "stage_done"
    )
    assert vision_done_idx < len(stream) - 1  # frames arrive before the end


def test_serialize_sse_event_frames() -> None:
    events: list[dict] = []
    pipeline.run_audit(load_encounter("ED-101"), emit=events.append)
    frames = list(pipeline.serialize_sse(iter(events)))
    assert frames[0].startswith("event: run_start\ndata: ")
    assert all(frame.endswith("\n\n") for frame in frames)
    payload = json.loads(frames[0][len("event: run_start\ndata: "):].strip())
    assert payload["encounter_id"] == "ED-101"
    joined = "".join(frames)
    assert "event: verdict" in joined and "event: done" in joined


def _stub_transport():
    """Stage-aware stub keyed by prompt markers; answers Zero-candidates Ultra."""

    def transport(model_id, messages, *, timeout_s, extra_body=None):
        user = messages[-1]["content"]
        text = user if isinstance(user, str) else " ".join(
            part.get("text", "") for part in user
        )
        if "RADIOLOGY REPORT" in text:
            payload: dict = {"findings": [], "vision_confidence": "HIGH"}
        elif "DISCHARGE TRIAGE INPUT" in text:
            payload = {
                "action": "SILENT_PASS",
                "confidence": 0.99,
                "reasons": ["nano is happy"],
            }
        elif "Contradiction kinds" in text:
            payload = {"queries": ["fleischner 7mm nodule follow-up guideline"]}
        else:
            payload = {"candidates": []}  # lazy Ultra -> honest seed rescue
        return json.dumps(payload), {"prompt_tokens": 100, "completion_tokens": 50}

    return transport


def test_live_stub_overrides_gate_and_records_replay(monkeypatch, tmp_path) -> None:
    from backend.engine import pipeline

    monkeypatch.setattr(pipeline, "NEBIUS_API_KEY", "stub-live-for-test")

    store = ReplayStore(path=tmp_path / "replay.json")
    events: list[dict] = []
    result = pipeline.run_audit(
        load_encounter("ED-104"),
        replay=store,
        transport_factory=lambda: (_stub_transport(), lambda: None),
        emit=events.append,
    )
    assert result.status == "CRITICAL_INTERCEPT"
    gate_done = next(
        e for e in events
        if e["event"] == "stage_done" and e["data"]["stage"] == "gate"
    )
    # FR-2.1: live Nano said SILENT_PASS — provable forces overruled it
    assert gate_done["data"]["decision"]["action"] == "ESCALATE"
    reasoning_done = next(
        e for e in events
        if e["event"] == "stage_done" and e["data"]["stage"] == "reasoning"
    )
    assert reasoning_done["data"]["trace"]["note"] == "empty_proposal_seed_fallback"
    assert reasoning_done["data"]["trace"]["replayed"] is True
    assert len(result.verdicts) == 2
    # capture store holds REAL live payloads for replayable stages only
    assert store.get("vision", "ED-104") is not None
    assert store.get("gate", "ED-104") is not None
    assert store.get("reasoning", "ED-104") is None
    # live stages were charged honestly; well under the per-discharge cap
    assert 0.0 < result.total_cost_usd < 0.05


def test_endpoint_streams_sse_and_404s_unknown() -> None:
    client = TestClient(app)
    response = client.post("/api/audit-stream", json={"encounter_id": "ED-104"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert body.startswith("event: run_start\ndata: ")
    assert body.count("event: stage_start") == 4
    assert body.count("event: stage_done") == 4
    assert "CRITICAL_INTERCEPT" in body
    assert body.rstrip(" \n").endswith("}")
    unknown = client.post("/api/audit-stream", json={"encounter_id": "ED-999"})
    assert unknown.status_code == 404

    silent = client.post("/api/audit-stream", json={"encounter_id": "ED-101"})
    assert silent.status_code == 200
    assert "SILENT_PASS" in silent.text
