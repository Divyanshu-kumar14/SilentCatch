"""Stage-4 gates (plan 2.4): repair retry, failover ladder, span-guard always on."""

from __future__ import annotations

import json

from backend.engine import contradiction_ultra
from backend.engine.guideline_search import GuidelineBundle, GuidelineResult
from backend.fixtures.loader import load_encounter, load_eval_specs
from backend.schemas import FindingKind


def _bundle() -> GuidelineResult:
    return GuidelineResult(
        queries=["fleischner"],
        guidelines=[
            GuidelineBundle(
                title="Fleischner 2017",
                url="https://pubs.rsna.org/doi/10.1148/radiol.2017161659",
                source="cache_snapshot",
            )
        ],
    )


def _inputs():
    encounter = load_encounter("ED-104")
    return dict(
        encounter_id="ED-104",
        radiology_report=encounter.radiology_study.report_text,
        lab_note=encounter.lab_note.text if encounter.lab_note else None,
        serial_labs=encounter.serial_labs,
        packet=encounter.draft_discharge_packet,
        findings=[],
        slopes=[],
        flags=["KINETIC_AKI_STAGE_1"],
        bundle=_bundle(),
        seed_candidates=load_eval_specs("ED-104"),
    )


def _batch_transport(payloads: list):
    calls: list[str] = []

    def transport(model_id, messages, *, timeout_s, extra_body=None):
        calls.append(model_id)
        idx = min(len(calls) - 1, len(payloads) - 1)
        return payloads[idx], {"prompt_tokens": 500, "completion_tokens": 300}

    return transport, calls


def test_ultra_verifies_candidates_and_injects_guideline_url() -> None:
    spec_payload = {
        "candidates": [
            {
                "kind": "INCIDENTAL_FINDING_DROP",
                "severity": "CRITICAL",
                "explanation": "7.2 mm RUL nodule with no follow-up order",
                "source_quote": "Incidental 7.2 mm spiculated solid noncalcified nodule in the right upper lobe",
                "source": "radiology_report",
                "guideline_url": None,
                "discharge_patch": {
                    "remove_drug_name": None,
                    "add_prescription": None,
                    "add_follow_up_order": {
                        "specialty": "Radiology",
                        "timeframe": "6 months",
                        "reason": "nodule follow-up",
                        "cpt_code": "71250",
                    },
                    "note": "",
                },
            }
        ]
    }
    transport, _calls = _batch_transport(
        [json.dumps(spec_payload), json.dumps(spec_payload)]
    )
    verdicts, trace = contradiction_ultra.synthesize_verdicts(
        **_inputs(), transport=transport, model_id="ultra", failsafe_model_id="super"
    )
    assert len(verdicts) == 1
    assert verdicts[0].kind == FindingKind.INCIDENTAL_FINDING_DROP
    # G2: live guideline URL (bundle) is attached when the model omits it.
    assert verdicts[0].guideline_url and "rsna" in verdicts[0].guideline_url
    assert verdicts[0].verified_span.end_char > verdicts[0].verified_span.start_char
    assert trace.model_id == "ultra" and trace.replayed is False


def test_malformed_output_repairs_once() -> None:
    bad = '{"candidates": [{"kind": "INCIDENTAL_FINDING_DROP"}]}'  # missing fields
    good = json.dumps(
        {
            "candidates": [
                {
                    "kind": "KINETIC_MED_COLLISION",
                    "severity": "CRITICAL",
                    "explanation": "NSAID vs AKI velocity",
                    "source_quote": "creatinine rising 0.62 → 0.88 → 1.16 mg/dL over 36 hours",
                    "source": "lab_note",
                    "guideline_url": None,
                    "discharge_patch": {
                        "remove_drug_name": "Ketorolac",
                        "note": "temporary",
                    },
                }
            ]
        }
    )
    transport, calls = _batch_transport([bad, good])
    verdicts, trace = contradiction_ultra.synthesize_verdicts(
        **_inputs(), transport=transport, model_id="ultra", failsafe_model_id="super"
    )
    assert len(calls) == 2, "exactly one automatic repair retry (FR-4.1)"
    assert len(verdicts) == 1 and verdicts[0].kind == FindingKind.KINETIC_MED_COLLISION
    # Honest ledger: repair-call tokens ride on the same stage trace.
    assert trace.prompt_tokens == 1000 and trace.completion_tokens == 600
    assert trace.replayed is False


def test_fallback_ladder_ultra_to_super_to_seed() -> None:
    def dead_transport(model_id, messages, *, timeout_s, extra_body=None):
        raise TimeoutError(f"{model_id} congested")

    verdicts, trace = contradiction_ultra.synthesize_verdicts(
        **_inputs(),
        transport=dead_transport,
        model_id="ultra",
        failsafe_model_id="super",
    )
    assert len(verdicts) == 2  # seed candidates run through the rig
    assert verdicts[0].verified_span.end_char > 0
    assert trace.replayed is True and "failure_fallback" in trace.note


def test_hallucinated_quote_never_surfaces_honest_seed_rescue() -> None:
    """R-1: the invented 9.9mm quote must never appear — verdicts (if any) come
    from the deterministically verified seed, honestly replay-badged."""
    hallucination = json.dumps(
        {
            "candidates": [
                {
                    "kind": "INCIDENTAL_FINDING_DROP",
                    "severity": "CRITICAL",
                    "explanation": "invented lesion",
                    "source_quote": "Incidental 9.9 mm nodule in the left lung",
                    "source": "radiology_report",
                    "guideline_url": None,
                    "discharge_patch": {"note": "invented"},
                }
            ]
        }
    )
    transport, _ = _batch_transport([hallucination])
    verdicts, trace = contradiction_ultra.synthesize_verdicts(
        **_inputs(), transport=transport, model_id="ultra", failsafe_model_id="super"
    )
    assert all("9.9" not in v.source_quote for v in verdicts)
    assert all(v.verified_span.end_char > v.verified_span.start_char for v in verdicts)
    assert trace.replayed is True


def test_budget_cap_forces_replay_mid_audit(monkeypatch) -> None:
    """FR-2.2: once the $0.05/discharge cap trips mid-audit, the remaining
    stages take the deterministic replay path — capped evidence stays $-true."""
    from backend.engine import pipeline
    from backend.fixtures.loader import load_encounter

    monkeypatch.setattr(pipeline, "NEBIUS_API_KEY", "key-present-for-test")

    def expensive_transport(model_id, messages, *, timeout_s, extra_body=None):
        # stage 1 goes live; its usage alone blows past the per-discharge cap
        return '{"findings": [], "vision_confidence": "HIGH"}', {
            "prompt_tokens": 1_000_000,
            "completion_tokens": 0,
        }

    events: list[dict] = []
    result = pipeline.run_audit(
        load_encounter("ED-104"),
        transport_factory=lambda: (expensive_transport, lambda: None),
        emit=events.append,
    )
    run_start = events[0]["data"]
    assert run_start["mode"] == "LIVE"
    vision_trace = result.traces[0]
    assert vision_trace.replayed is False  # stage 1 went live and was charged
    for trace in result.traces[1:]:
        assert trace.replayed is True, "capped stages must replay deterministically"
    assert result.status == "CRITICAL_INTERCEPT"  # seed rescue still intercepts
    assert result.total_cost_usd == 0.6  # 1M prompt tokens @ $0.60/Mtok
