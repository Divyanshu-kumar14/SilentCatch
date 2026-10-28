"""Benchmark truthfulness tests: replay vs live, leakage, failures, metrics."""

from __future__ import annotations

import json

import pytest

from backend.engine import pipeline, vision_extractor
from backend.engine.telemetry import SpendLedger
from backend.fixtures.loader import load_encounter, load_eval_specs
from eval import benchmark


def _ed104_specs_json() -> str:
    return json.dumps(
        {"candidates": [spec.model_dump(mode="json") for spec in load_eval_specs("ED-104")]}
    )


def _stage_transport():
    """Stage-aware stub proving which model calls the benchmark makes."""
    encounter = load_encounter("ED-104")
    findings = [
        finding.model_dump(mode="json")
        for finding in vision_extractor.parse_report_sentences(
            encounter.radiology_study.report_text
        )
    ]
    calls: list[str] = []

    def transport(model_id, messages, *, timeout_s, extra_body=None):
        calls.append(model_id)
        user = messages[-1]["content"]
        text = (
            user
            if isinstance(user, str)
            else " ".join(part.get("text", "") for part in user)
        )
        if "RADIOLOGY REPORT" in text:
            payload = {"findings": findings, "vision_confidence": "HIGH"}
        elif "DISCHARGE TRIAGE INPUT" in text:
            payload = {"action": "ESCALATE", "confidence": 0.9, "reasons": ["stub"]}
        elif "Contradiction kinds" in text:
            payload = {
                "queries": [
                    "fleischner solid pulmonary nodule 6-8 mm follow-up",
                    "ketorolac acute kidney injury contraindication",
                ]
            }
        elif "CLINICAL CONTEXT" in text:
            payload = json.loads(_ed104_specs_json())
        else:  # pragma: no cover - guard against an unexpected stage prompt
            raise AssertionError(f"unexpected prompt: {text[:120]}")
        return json.dumps(payload), {"prompt_tokens": 1000, "completion_tokens": 200}

    return transport, calls


def _search_post(query: str):
    return (
        [
            {
                "title": "Fleischner Society nodule guidance",
                "url": "https://pubs.rsna.org/doi/10.1148/radiol.2017161659",
                "content": "Solid nodule 6-8 mm: follow-up CT at 6-12 months.",
            }
        ],
        {},
    )


def test_replay_scores_fixture_routing_without_live_calls(monkeypatch) -> None:
    monkeypatch.setattr(benchmark, "NEBIUS_API_KEY", "key-present-but-ignored")

    report = benchmark.run_benchmark(
        benchmark.BenchmarkOptions(
            live=False,
            encounter_ids=("ED-104",),
            configs=("tiered_router",),
        )
    )
    case = report.cases[0]
    summary = report.summary["tiered_router"]

    assert report.meta.mode == "REPLAYED"
    assert report.meta.environment == "REPLAYED"
    assert report.meta.scoring_basis == "fixture_deterministic"
    assert case.prediction_source == "fixture_seed"
    # Scored as a fixture-routing check, with seeded provenance recorded.
    assert case.scored is True
    assert case.score_source == "fixture_seeded"
    assert summary.scored_cases == 1
    assert summary.score_source == "fixture_seeded"
    assert summary.recall_pct == 100.0
    # This subset has one positive case and no negatives, so FPR is undefined.
    assert summary.fpr_pct is None
    # Replay reports design targets, not microsecond local execution.
    assert summary.median_latency_ms is None
    assert summary.latency_scope == "estimated_design_targets"
    assert summary.estimated_latency_ms is not None
    assert summary.estimated_latency_ms["vision"] == 400.0
    assert summary.cost_type == "estimated_public_rates"
    assert summary.cost_per_1k_discharges_usd is not None
    assert summary.replay_check_total == 1
    assert summary.replay_check_matches == 1
    # No stage claims a provider call in replay mode.
    assert all(stage.source not in benchmark.LIVE_SOURCES for stage in case.stages)


def test_replay_nano_scoring_is_deterministic_not_seeded() -> None:
    report = benchmark.run_benchmark(
        benchmark.BenchmarkOptions(
            live=False,
            encounter_ids=("ED-104",),
            configs=("nano_only",),
        )
    )
    case = report.cases[0]
    summary = report.summary["nano_only"]

    assert case.scored is True
    assert case.score_source == "fixture_deterministic"
    assert summary.score_source == "fixture_deterministic"
    assert summary.recall_pct == 100.0
    assert summary.latency_scope == "estimated_design_targets"
    assert summary.median_latency_ms is None


def test_nano_only_live_actually_invokes_transport() -> None:
    calls: list[str] = []

    def transport(model_id, messages, *, timeout_s, extra_body=None):
        calls.append(model_id)
        return (
            json.dumps({"action": "ESCALATE", "confidence": 0.9, "reasons": ["stub"]}),
            {"prompt_tokens": 120, "completion_tokens": 30},
        )

    report = benchmark.run_benchmark(
        benchmark.BenchmarkOptions(
            live=True,
            transport=transport,
            model_ids={"gate": "nano-test-model"},
            encounter_ids=("ED-104",),
            configs=("nano_only",),
        )
    )
    case = report.cases[0]
    summary = report.summary["nano_only"]

    assert calls == ["nano-test-model"]
    assert case.case_mode == "LIVE"
    assert case.prediction_source == "model"
    assert case.scored is True
    assert case.stages[0].source == "live"
    assert case.stages[0].model_id == "nano-test-model"
    assert case.prompt_tokens == 120
    assert case.cost_usd is not None and case.cost_usd > 0
    assert case.cost_type == "estimated_from_actual_tokens"
    assert summary.scored_cases == 1
    assert summary.recall_pct == 100.0
    assert summary.median_latency_ms is not None and summary.median_latency_ms > 0


def test_provider_failure_never_becomes_a_fixture_prediction() -> None:
    encounter = load_encounter("ED-104")
    ledger = SpendLedger(0.05, 2.00)

    def dead_transport(model_id, messages, *, timeout_s, extra_body=None):
        raise TimeoutError(f"{model_id} unavailable")

    case = benchmark.evaluate_ultra_only(
        encounter,
        benchmark.BenchmarkOptions(
            live=True,
            transport=dead_transport,
            model_ids={"reasoning": "ultra-test", "failsafe": "super-test"},
            # Deliberately permit seeds at the options level: live must still veto.
            allow_seed_fallback=True,
        ),
        ledger,
        seed_candidates=load_eval_specs("ED-104"),
    )

    reasoning = next(stage for stage in case.stages if stage.stage == "reasoning")
    assert reasoning.source == "failure_no_prediction"
    assert case.predicted_outcome is None
    assert case.prediction_source == "none"
    assert case.scored is False
    assert case.verdicts_count == 0
    assert case.case_mode == "FAILED"


def test_live_tiered_pipeline_never_loads_expected_labels(monkeypatch) -> None:
    transport, calls = _stage_transport()

    def leak_guard(*_args, **_kwargs):
        raise AssertionError("pipeline loaded expected-label fixtures in live mode")

    monkeypatch.setattr(pipeline, "load_eval_specs", leak_guard)

    report = benchmark.run_benchmark(
        benchmark.BenchmarkOptions(
            live=True,
            transport=transport,
            search_post=_search_post,
            model_ids={
                "vision": "vision-test",
                "gate": "gate-test",
                "reasoning": "reasoning-test",
                "failsafe": "failsafe-test",
            },
            encounter_ids=("ED-104",),
            configs=("tiered_router",),
            # Deliberately True: live predictive evaluation must force it off.
            allow_seed_fallback=True,
        )
    )
    case = report.cases[0]
    summary = report.summary["tiered_router"]

    assert calls, "live pipeline made no model calls"
    assert case.case_mode == "LIVE"
    assert case.prediction_source == "model"
    assert case.scored is True
    assert case.fallback_affected is False
    assert case.verdicts_count == 2
    assert {stage.source for stage in case.stages} <= benchmark.LIVE_SOURCES
    assert case.prompt_tokens is not None and case.prompt_tokens > 0
    assert case.cost_type == "partial_external_credits_unavailable"
    assert summary.scored_cases == 1
    assert summary.recall_pct == 100.0
    assert summary.precision_pct == 100.0


def test_nullable_metrics_do_not_divide_by_zero() -> None:
    case = benchmark.CaseResult(
        encounter_id="ED-999",
        expected_contradiction=True,
        expected_outcome="CRITICAL_INTERCEPT",
        predicted_outcome=None,
        evaluable=False,
        scored=False,
        status="failed",
        prediction_source="none",
        case_mode="FAILED",
        notes=["no prediction"],
    )
    summary = benchmark._summarize_config(
        "tiered_router", [case], live_requested=True
    )
    assert summary.scored_cases == 0
    assert summary.recall_pct is None
    assert summary.precision_pct is None
    assert summary.specificity_pct is None
    assert summary.fpr_pct is None
    assert summary.median_latency_ms is None
    assert summary.p95_latency_ms is None
    assert summary.cost_per_1k_discharges_usd is None
    assert summary.cost_type == "unavailable"


def test_report_schema_keeps_backward_compatible_keys() -> None:
    report = benchmark.run_benchmark(
        benchmark.BenchmarkOptions(
            live=False,
            encounter_ids=("ED-104",),
            configs=("nano_only", "ultra_only", "tiered_router"),
        )
    )
    payload = report.model_dump()
    assert benchmark.BenchmarkReport.model_validate(payload)

    assert payload["schema_version"] == benchmark.SCHEMA_VERSION
    assert payload["meta"]["environment"] == payload["meta"]["mode"]
    assert payload["meta"]["safe_count"] == payload["meta"]["negative_cases"]
    assert payload["meta"]["contradiction_count"] == payload["meta"]["positive_cases"]
    assert payload["summary"].keys() == payload["configs"].keys()
    assert {"nano_only", "ultra_only", "tiered_router"} <= payload["summary"].keys()
    for config in payload["summary"].values():
        assert config["pricing_version"] == "2026-10-public-estimates-v1"
        assert "replay_check_total" in config
        assert "cost_type" in config
