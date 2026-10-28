"""SilentCatch architecture benchmark (PRD FA-6 / FR-6.1).

Three configurations are compared on the same synthetic encounters:

  1. ``nano_only``     — report-derived findings -> Nano-30B gate only.
                         Text-only baseline: it does NOT read the image.
  2. ``ultra_only``    — report-derived findings + guideline bundle -> Ultra-550B
                         for every case (no fast-path gate).
  3. ``tiered_router`` — full pipeline: vision -> gate -> Tavily -> Ultra + rig.

Two execution modes are deliberately separate:

  * replay (default) — no provider calls are made even when API keys exist.
    Classification metrics ARE computed, but they score deterministic fixture
    routing, not provider inference. Every scored value carries a
    ``score_source`` label: ``fixture_deterministic`` when the pipeline reached
    the outcome without expected-label seeds, or ``fixture_seeded`` when stage-4
    candidates were loaded from the fixture expectations. Seeded predictions are
    fixture-wiring checks, never model outputs.
  * live (``--live``) — every scored prediction must come from the documented
    live path. A timeout, schema failure, or deterministic fallback makes that
    case incomplete instead of crediting a fixture answer as model success.

Predictive evaluation never receives expected findings. Labels are loaded only
by the evaluator after a prediction exists.

Usage:
  python eval/benchmark.py                     # replay, no network
  python eval/benchmark.py --live --limit 2    # opt-in live smoke
  python eval/benchmark.py --live              # full live benchmark (costs apply)
  python eval/benchmark.py --live --smoke      # one case, one provider pass
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

# Ensure project root is in python path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend import config
from backend.config import NEBIUS_API_KEY, TAVILY_API_KEY, spend_caps
from backend.engine import (
    contradiction_ultra,
    guideline_search,
    kinematic_labs,
    noise_gate,
    pipeline,
    vision_extractor,
)
from backend.engine.telemetry import (
    PRICING_ASSUMPTIONS_VERSION,
    TOKEN_COSTS_USD_PER_MTOK,
    SpendLedger,
    day_cost,
    estimate_cost,
    pricing_snapshot,
)
from backend.engine.replay import ReplayStore
from backend.fixtures.loader import load_encounter_records, load_encounters, load_eval_specs
from backend.schemas import Encounter, FindingKind, FindingSpec

RESULTS_PATH = Path(__file__).resolve().parent / "results_latest.json"
SCHEMA_VERSION = 2

# Design latency budgets from the README "Stage Details" table. Replay cases
# execute locally in microseconds, so those timings are never reported as
# inference latency.
STAGE_LATENCY_TARGETS_MS: dict[str, float] = {
    "vision": 400.0,
    "gate": 250.0,
    "guideline": 300.0,
    "reasoning": 600.0,
}

# Per-discharge token budgets used ONLY for public-rate replay cost estimates.
# They are documented design assumptions, not measured provider usage.
REPLAY_TOKEN_BUDGETS: dict[str, dict[str, int]] = {
    "nano_only": {"gate": 200},
    "ultra_only": {"gate": 200, "reasoning": 800},
    "tiered_router_safe": {"vision": 600, "gate": 200},
    "tiered_router_critical": {"vision": 600, "gate": 200, "reasoning": 800},
}

CONFIG_NAMES = {
    "nano_only": "Nemotron 3 Nano-30B Only",
    "ultra_only": "Nemotron 3 Ultra-550B Only",
    "tiered_router": "SilentCatch Tiered Router (Ours)",
}

CONFIG_COMPONENTS = {
    "nano_only": [
        "deterministic report-text finding extraction (no image)",
        "Nano-30B gate",
        "deterministic fail-safe overrides",
    ],
    "ultra_only": [
        "deterministic report-text finding extraction (no image)",
        "template guideline query + Tavily/snapshot retrieval",
        "Ultra-550B synthesis",
        "shared deterministic verification rig",
    ],
    "tiered_router": [
        "Super-VL vision extraction (image + report)",
        "Nano-30B triage gate",
        "Tavily/snapshot guideline retrieval",
        "Ultra-550B synthesis + failsafe tier",
        "shared deterministic verification rig",
    ],
}

LIVE_SOURCES = frozenset({"live", "failsafe_live", "tavily_live"})
LOCAL_SOURCES = frozenset(
    {
        "replay_seed",
        "seed_replay",
        "deterministic_replay",
        "template_replay",
        "cache_snapshot",
        "cache_hit",
        "replay_no_prediction",
    }
)
FAILURE_SOURCES = frozenset({"failure_no_prediction"})

DISCLAIMERS = [
    "Synthetic encounters only: 12 development fixtures (8 expected-safe, 4 expected-contradiction).",
    "Results apply only to the listed cases; they do not establish clinical sensitivity or real-world safety.",
    "This is an experimental prototype, not a validated clinical decision-support device.",
    "Replay metrics score deterministic fixture routing, not model inference; fixture-seeded stage-4 cases are labelled fixture_seeded.",
    "Latency values are design targets from the Stage Details table, not measured inference latency.",
    "Cost values are public-rate estimates from documented token budgets, not provider invoices.",
]


# --------------------------------------------------------------------------- models


class CaseStageResult(BaseModel):
    stage: str
    source: str
    model_id: str | None = None
    replayed: bool = True
    latency_ms: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cost_usd: float | None = None
    cost_type: str = "unavailable"
    note: str = ""


class CaseResult(BaseModel):
    encounter_id: str
    expected_contradiction: bool
    expected_outcome: Literal["CRITICAL_INTERCEPT", "SILENT_PASS"]
    predicted_outcome: str | None = None
    flagged: bool | None = None
    evaluable: bool = False
    scored: bool = False
    # Provenance of a scored value: live inference, deterministic fixture
    # routing, or fixture-seeded replay (expected labels became stage-4 input).
    score_source: Literal["live_inference", "fixture_deterministic", "fixture_seeded"] | None = None
    status: str = "failed"
    prediction_source: str = "none"
    case_mode: str = "REPLAYED"
    fallback_affected: bool = False
    verification_rejected: bool = False
    stages: list[CaseStageResult] = Field(default_factory=list)
    stage_sources: dict[str, str] = Field(default_factory=dict)
    latency_ms: float | None = None
    latency_scope: str = "unavailable"
    cost_usd: float | None = None
    cost_type: str = "unavailable"
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    verdicts_count: int = 0
    error: str | None = None
    notes: list[str] = Field(default_factory=list)


class ConfigSummary(BaseModel):
    key: str
    name: str
    description: list[str]
    input_modality: str
    mode: str = "REPLAYED"
    total_cases: int = 0
    evaluable_cases: int = 0
    scored_cases: int = 0
    score_source: str | None = None
    incomplete_cases: int = 0
    failed_cases: int = 0
    fallback_affected_cases: int = 0
    # Replay-only functional check: predicted vs expected on fixture cases.
    # This is NOT model accuracy (no provider call was made).
    replay_check_total: int = 0
    replay_check_matches: int = 0
    replay_check_pct: float | None = None
    positive_cases_total: int = 0
    negative_cases_total: int = 0
    positive_cases_scored: int = 0
    negative_cases_scored: int = 0
    tp: int = 0
    fp: int = 0
    tn: int = 0
    fn: int = 0
    recall_pct: float | None = None
    precision_pct: float | None = None
    specificity_pct: float | None = None
    fpr_pct: float | None = None
    median_latency_ms: float | None = None
    p95_latency_ms: float | None = None
    latency_n: int = 0
    latency_scope: str = "unavailable"
    estimated_latency_ms: dict[str, float] | None = None
    cost_per_1k_discharges_usd: float | None = None
    cost_per_discharge_avg_usd: float | None = None
    cost_type: str = "unavailable"
    pricing_version: str = PRICING_ASSUMPTIONS_VERSION
    cost_reduction_vs_ultra_pct: float | None = None
    notes: list[str] = Field(default_factory=list)


class BenchmarkMeta(BaseModel):
    schema_version: int = SCHEMA_VERSION
    eval_date: str
    mode: str
    environment: str  # backward-compatible alias for mode
    requested_mode: str
    scoring_basis: str = "unscored"
    git_commit: str | None = None
    total_encounters: int
    positive_cases: int
    negative_cases: int
    safe_count: int  # backward-compatible alias
    contradiction_count: int  # backward-compatible alias
    total_eval_runs: int
    configs_evaluated: list[str]
    case_limit: int | None = None
    case_ids: list[str] = Field(default_factory=list)
    models_resolved: dict[str, str | None] = Field(default_factory=dict)
    tavily_configured: bool = False
    pricing: dict[str, Any] = Field(default_factory=dict)
    disclaimers: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class BenchmarkReport(BaseModel):
    schema_version: int = SCHEMA_VERSION
    meta: BenchmarkMeta
    summary: dict[str, ConfigSummary]
    configs: dict[str, ConfigSummary]
    cases: list[CaseResult]


@dataclass
class BenchmarkOptions:
    live: bool = False
    transport: vision_extractor.LlmTransport | None = None
    search_post: guideline_search.HttpPostFn | None = None
    model_ids: dict[str, str] = field(default_factory=lambda: dict(config.DEFAULT_MODEL_IDS))
    case_limit: int | None = None
    encounter_ids: tuple[str, ...] = ()
    configs: tuple[str, ...] = ("nano_only", "ultra_only", "tiered_router")
    # Live predictive evaluation must never receive expected findings.
    allow_seed_fallback: bool = True


# --------------------------------------------------------------------------- helpers


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return result.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def _pricing_role(trace) -> str:
    if trace.stage == "vision":
        return "vision"
    if trace.stage == "gate":
        return "gate"
    if trace.stage == "reasoning":
        return "failsafe" if trace.source == "failsafe_live" else "reasoning"
    if trace.stage == "guideline":
        # Query generation is a Nano call; the Tavily fetch itself is token-less.
        return "gate" if trace.model_id else "failsafe"
    return "failsafe"


def _is_live_trace(trace) -> bool:
    return trace.source in LIVE_SOURCES or trace.source.startswith("live")


def _trace_cost(trace) -> tuple[float | None, str]:
    if trace.source == "tavily_live":
        return None, "external_credits_unavailable"
    if not _is_live_trace(trace):
        return 0.0, "not_applicable_replay"
    if trace.prompt_tokens or trace.completion_tokens:
        return estimate_cost(_pricing_role(trace), trace.prompt_tokens, trace.completion_tokens), (
            "estimated_from_actual_tokens"
        )
    return None, "unavailable_no_usage"


def _stage_result(trace) -> CaseStageResult:
    cost, cost_type = _trace_cost(trace)
    live = _is_live_trace(trace)
    return CaseStageResult(
        stage=pipeline.stage_source_key(trace),
        source=trace.source or ("replay_seed" if trace.replayed else "live"),
        model_id=trace.model_id,
        replayed=trace.replayed,
        latency_ms=round(float(trace.latency_ms), 3),
        prompt_tokens=trace.prompt_tokens if live else None,
        completion_tokens=trace.completion_tokens if live else None,
        cost_usd=round(cost, 9) if cost is not None else None,
        cost_type=cost_type,
        note=trace.note,
    )


def _aggregate_cost(stages: list[CaseStageResult]) -> tuple[float | None, str, int | None, int | None]:
    live = [stage for stage in stages if stage.source in LIVE_SOURCES or stage.source.startswith("live")]
    if not live:
        return 0.0, "not_applicable_replay", None, None

    known = [stage.cost_usd for stage in live if stage.cost_usd is not None]
    total = round(sum(known), 9) if known else None
    prompt_tokens = sum(stage.prompt_tokens or 0 for stage in live) if all(
        stage.prompt_tokens is not None for stage in live
    ) else None
    completion_tokens = sum(stage.completion_tokens or 0 for stage in live) if all(
        stage.completion_tokens is not None for stage in live
    ) else None

    if any(stage.cost_type == "external_credits_unavailable" for stage in live):
        return total, "partial_external_credits_unavailable", prompt_tokens, completion_tokens
    if not known:
        return None, "unavailable_no_usage", prompt_tokens, completion_tokens
    if len(known) != len(live):
        return total, "partial_estimated_from_actual_tokens", prompt_tokens, completion_tokens
    return total, "estimated_from_actual_tokens", prompt_tokens, completion_tokens


def _source_mode(sources: list[str], live_requested: bool) -> str:
    if any(source in FAILURE_SOURCES for source in sources):
        return "FAILED"
    live_count = sum(1 for source in sources if source in LIVE_SOURCES)
    if live_count == len(sources) and all(source not in {"cache_hit"} for source in sources):
        return "LIVE"
    if live_count > 0:
        return "MIXED"
    return "REPLAYED"


def _prediction_source(trace) -> str:
    source = trace.source
    if source in {"live", "failsafe_live", "live_empty", "live_rejected"}:
        return "model"
    if source == "live_override":
        return "deterministic_override"
    if source in {"seed_replay", "seed_fallback", "seed_rescue"}:
        return "fixture_seed"
    if source in {"deterministic_replay"}:
        return "deterministic"
    if source in {"deterministic_fallback"}:
        return "deterministic_fallback"
    return "none"


def _latency_stats(values: list[float]) -> tuple[float | None, float | None, int]:
    usable = [value for value in values if isinstance(value, (int, float)) and math.isfinite(value)]
    if not usable:
        return None, None, 0
    median = round(float(statistics.median(usable)), 3)
    if len(usable) < 2:
        return median, None, 1
    ordered = sorted(usable)
    rank = max(1, math.ceil(0.95 * len(ordered)))
    return median, round(float(ordered[rank - 1]), 3), len(usable)


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator * 100.0, 1)


def _case_scored(case: CaseResult, live_requested: bool) -> bool:
    """Score evaluable predictions while keeping provenance explicit.

    Replay is scored as a deterministic fixture-routing check. Live runs only
    score predictions that actually came from the provider path.
    """
    if not case.evaluable or case.predicted_outcome not in {"CRITICAL_INTERCEPT", "SILENT_PASS"}:
        return False
    if live_requested:
        if case.prediction_source in {"none", "fixture_seed"}:
            return False
        return case.case_mode == "LIVE"
    return case.case_mode == "REPLAYED"


def _score_source_for(case: CaseResult, live_requested: bool) -> str | None:
    if not case.scored:
        return None
    if live_requested:
        return "live_inference"
    if case.prediction_source == "fixture_seed":
        return "fixture_seeded"
    return "fixture_deterministic"


def _apply_scoring(case: CaseResult, live_requested: bool) -> None:
    case.scored = _case_scored(case, live_requested)
    case.score_source = _score_source_for(case, live_requested)


def _replay_token_budget(config_key: str, expected_contradiction: bool) -> dict[str, int]:
    if config_key == "tiered_router":
        budget_key = "tiered_router_critical" if expected_contradiction else "tiered_router_safe"
    else:
        budget_key = config_key
    return dict(REPLAY_TOKEN_BUDGETS[budget_key])


def _estimate_replay_cost(config_key: str, expected_contradiction: bool) -> float:
    """Public-rate estimate from documented token budgets (not an invoice)."""
    budget = _replay_token_budget(config_key, expected_contradiction)
    return sum(
        tokens * TOKEN_COSTS_USD_PER_MTOK[role][0] / 1_000_000.0
        for role, tokens in budget.items()
    )


def _estimated_latency(config_key: str) -> dict[str, float]:
    """Design-target latency map; not a measurement."""
    if config_key == "nano_only":
        stages = {"gate": STAGE_LATENCY_TARGETS_MS["gate"]}
    elif config_key == "ultra_only":
        stages = {
            "guideline": STAGE_LATENCY_TARGETS_MS["guideline"],
            "reasoning": STAGE_LATENCY_TARGETS_MS["reasoning"],
        }
    else:
        stages = dict(STAGE_LATENCY_TARGETS_MS)

    if config_key == "tiered_router":
        # Clean discharges return after the gate; contradictions run all stages.
        fast_path = STAGE_LATENCY_TARGETS_MS["vision"] + STAGE_LATENCY_TARGETS_MS["gate"]
    else:
        fast_path = sum(stages.values())
    return {
        **stages,
        "fast_path_ms": round(fast_path, 3),
        "critical_path_ms": round(sum(stages.values()), 3),
    }


def _finish_case(
    encounter: Encounter,
    *,
    expected_contradiction: bool,
    predicted_outcome: str | None,
    stages: list[CaseStageResult],
    case_mode: str,
    prediction_source: str,
    latency_ms: float,
    live_requested: bool,
    notes: list[str],
    verification_rejected: bool = False,
    error: str | None = None,
    verdicts_count: int = 0,
) -> CaseResult:
    flagged = (predicted_outcome == "CRITICAL_INTERCEPT") if predicted_outcome else None
    evaluable = predicted_outcome in {"CRITICAL_INTERCEPT", "SILENT_PASS"}
    stage_sources = {stage.stage: stage.source for stage in stages}
    cost, cost_type, prompt_tokens, completion_tokens = _aggregate_cost(stages)
    fallback_affected = any(
        stage.source not in LIVE_SOURCES and stage.source not in LOCAL_SOURCES
        for stage in stages
    ) or any(stage.source in {"cache_hit", "cache_snapshot"} for stage in stages)

    if error:
        status = "error"
    elif not evaluable:
        status = "failed"
    elif prediction_source == "fixture_seed":
        status = "replay_fixture"
    elif live_requested and case_mode != "LIVE":
        status = "fallback"
    elif prediction_source in {"deterministic", "deterministic_override", "deterministic_fallback"}:
        status = "completed"
    else:
        status = "completed"

    case = CaseResult(
        encounter_id=encounter.encounter_id,
        expected_contradiction=expected_contradiction,
        expected_outcome="CRITICAL_INTERCEPT" if expected_contradiction else "SILENT_PASS",
        predicted_outcome=predicted_outcome,
        flagged=flagged,
        evaluable=evaluable,
        scored=False,
        status=status,
        prediction_source=prediction_source,
        case_mode=case_mode if evaluable else "FAILED",
        fallback_affected=fallback_affected,
        verification_rejected=verification_rejected,
        stages=stages,
        stage_sources=stage_sources,
        latency_ms=round(latency_ms, 3),
        latency_scope="live_end_to_end" if live_requested else "local_replay",
        cost_usd=cost,
        cost_type=cost_type,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        verdicts_count=verdicts_count,
        error=error,
        notes=notes,
    )
    _apply_scoring(case, live_requested)
    return case


# --------------------------------------------------------------------------- configs


def evaluate_nano_only(
    encounter: Encounter,
    options: BenchmarkOptions,
    ledger: SpendLedger,
) -> CaseResult:
    """Config 1: Stage-2 Nano gate only, on report-derived findings.

    The Nano model is text-only; this baseline intentionally does not perform
    image extraction. It is a triage baseline, not a full multimodal system.
    """
    started = time.perf_counter()
    findings = vision_extractor.parse_report_sentences(encounter.radiology_study.report_text)
    slopes = kinematic_labs.analyze_serial_labs(encounter.serial_labs)
    flags = kinematic_labs.all_flags(slopes)

    transport = options.transport if options.live else None
    notes: list[str] = ["Nano-only uses report-derived findings; no image is read."]
    if transport is not None and not ledger.live_call_allowed():
        transport = None
        notes.append("Budget cap reached before the Nano call; deterministic replay used.")

    decision, trace = noise_gate.decide(
        findings,
        encounter.draft_discharge_packet,
        slopes,
        flags,
        transport=transport,
        model_id=options.model_ids.get("gate", ""),
    )
    if transport is not None:
        cost, _ = _trace_cost(trace)
        if cost:
            ledger.charge_live_call(cost)

    elapsed_ms = (time.perf_counter() - started) * 1000.0
    stage = _stage_result(trace)
    mode = _source_mode([stage.source], options.live)
    prediction = "ESCALATE" if decision.action == "ESCALATE" else "SILENT_PASS"
    prediction_source = _prediction_source(trace)
    if prediction_source == "deterministic_fallback":
        notes.append("Nano call failed; the deterministic gate supplied this prediction.")
    if options.live and mode != "LIVE":
        notes.append("Not scored as live: the final action was not purely a live Nano decision.")

    return _finish_case(
        encounter,
        expected_contradiction=False,  # overwritten by the evaluator
        predicted_outcome="CRITICAL_INTERCEPT" if prediction == "ESCALATE" else "SILENT_PASS",
        stages=[stage],
        case_mode=mode,
        prediction_source=prediction_source,
        latency_ms=elapsed_ms,
        live_requested=options.live,
        notes=notes,
    )


def evaluate_ultra_only(
    encounter: Encounter,
    options: BenchmarkOptions,
    ledger: SpendLedger,
    *,
    seed_candidates: list[FindingSpec] | None = None,
) -> CaseResult:
    """Config 2: every case goes to Ultra-550B (no fast-path gate).

    `seed_candidates` is only supplied by the explicit replay/demo orchestrator.
    The live predictive path always passes None.
    """
    started = time.perf_counter()
    findings = vision_extractor.parse_report_sentences(encounter.radiology_study.report_text)
    slopes = kinematic_labs.analyze_serial_labs(encounter.serial_labs)
    flags = kinematic_labs.all_flags(slopes)
    notes: list[str] = ["Ultra-only uses report-derived findings; no image is read."]

    queries = (
        guideline_search.template_queries(FindingKind.INCIDENTAL_FINDING_DROP)
        + guideline_search.template_queries(FindingKind.KINETIC_MED_COLLISION)
    )
    bundle, search_trace = guideline_search.search(
        queries,
        http_post=options.search_post,
        allow_live=options.live,
    )

    transport = options.transport if options.live else None
    if transport is not None and not ledger.live_call_allowed():
        transport = None
        notes.append("Budget cap reached before the Ultra call; no prediction can be scored.")

    verdicts, ultra_trace = contradiction_ultra.synthesize_verdicts(
        encounter.encounter_id,
        encounter.radiology_study.report_text,
        encounter.lab_note.text if encounter.lab_note else None,
        encounter.serial_labs,
        encounter.draft_discharge_packet,
        findings=findings,
        slopes=slopes,
        flags=flags,
        bundle=bundle,
        seed_candidates=seed_candidates if not options.live else None,
        transport=transport,
        model_id=options.model_ids.get("reasoning", ""),
        failsafe_model_id=options.model_ids.get("failsafe", ""),
        allow_seed_fallback=options.allow_seed_fallback and not options.live,
    )
    if transport is not None:
        cost, _ = _trace_cost(ultra_trace)
        if cost:
            ledger.charge_live_call(cost)

    elapsed_ms = (time.perf_counter() - started) * 1000.0
    stages = [_stage_result(search_trace), _stage_result(ultra_trace)]
    sources = [stage.source for stage in stages]
    mode = _source_mode(sources, options.live)
    prediction_source = _prediction_source(ultra_trace)
    if prediction_source == "fixture_seed":
        notes.append(
            "Replay was seeded from expected fixtures; labelled fixture_seeded, not model performance."
        )
    if ultra_trace.source == "live_rejected":
        notes.append("Ultra proposed candidates, but deterministic verification rejected all of them.")

    predicted = "CRITICAL_INTERCEPT" if verdicts else "SILENT_PASS"
    if ultra_trace.source in {"failure_no_prediction"}:
        predicted = None  # no model outcome to score

    return _finish_case(
        encounter,
        expected_contradiction=False,  # overwritten by the evaluator
        predicted_outcome=predicted,
        stages=stages,
        case_mode=mode,
        prediction_source=prediction_source,
        latency_ms=elapsed_ms,
        live_requested=options.live,
        notes=notes,
        verification_rejected=ultra_trace.source == "live_rejected",
        verdicts_count=len(verdicts),
    )


def evaluate_tiered_router(encounter: Encounter, options: BenchmarkOptions) -> CaseResult:
    """Config 3: full SilentCatch pipeline with deterministic verification."""
    started = time.perf_counter()
    ledger = SpendLedger(*spend_caps().values())
    ledger.seed_day(day_cost())

    result = pipeline.run_audit(
        encounter,
        ledger=ledger,
        replay=ReplayStore(persist=False),
        transport_factory=(
            (lambda: (options.transport, lambda: None)) if options.live and options.transport else None
        ),
        search_post=options.search_post,
        vision_cache={},
        allow_live=options.live,
        # Live predictive evaluation must never receive expected-label seeds.
        allow_seed_fallback=options.allow_seed_fallback and not options.live,
    )
    elapsed_ms = (time.perf_counter() - started) * 1000.0

    stages = [_stage_result(trace) for trace in result.traces]
    prediction_source = "none"
    verification_rejected = False
    notes: list[str] = []

    reasoning = next((trace for trace in result.traces if trace.stage == "reasoning"), None)
    gate = next((trace for trace in result.traces if trace.stage == "gate"), None)
    reasoning_failed = reasoning is not None and reasoning.source == "failure_no_prediction"
    if result.status == "ERROR":
        notes.append("Pipeline returned ERROR; no clinical prediction is scored.")
    elif reasoning_failed:
        notes.append(
            "Ultra/failsafe produced no usable prediction; no clinical outcome is scored."
        )
    elif reasoning is not None:
        prediction_source = _prediction_source(reasoning)
        verification_rejected = reasoning.source == "live_rejected"
        if reasoning.source == "live_rejected":
            notes.append("Ultra proposed candidates, but deterministic verification rejected all of them.")
    elif gate is not None:
        prediction_source = _prediction_source(gate)
        notes.append("Fast-path SILENT_PASS; stages 3-4 were not required.")
    if result.fallback_used:
        notes.append("At least one stage used a cached/fallback source.")
    if options.live and result.execution_mode != "LIVE":
        notes.append("Not scored as live: at least one stage did not run live.")

    predicted_outcome = (
        result.status
        if result.status in {"CRITICAL_INTERCEPT", "SILENT_PASS"}
        and not reasoning_failed
        else None
    )

    return _finish_case(
        encounter,
        expected_contradiction=False,  # overwritten by the evaluator
        predicted_outcome=predicted_outcome,
        stages=stages,
        case_mode=result.execution_mode or ("REPLAYED" if not options.live else "MIXED"),
        prediction_source=prediction_source,
        latency_ms=elapsed_ms,
        live_requested=options.live,
        notes=notes,
        verification_rejected=verification_rejected,
        error=None if result.status != "ERROR" else "pipeline_error",
        verdicts_count=len(result.verdicts),
    )


# --------------------------------------------------------------------------- runner


def _summarize_config(
    key: str,
    cases: list[CaseResult],
    *,
    live_requested: bool,
    ultra_cost: float | None = None,
) -> ConfigSummary:
    mode = (
        "LIVE" if cases and all(case.case_mode == "LIVE" for case in cases)
        else "FAILED" if cases and all(case.case_mode == "FAILED" for case in cases)
        else "MIXED" if any(case.case_mode == "LIVE" for case in cases)
        else "REPLAYED"
    )
    scored = [case for case in cases if case.scored]
    tp = sum(1 for case in scored if case.expected_contradiction and case.flagged)
    fp = sum(1 for case in scored if not case.expected_contradiction and case.flagged)
    tn = sum(1 for case in scored if not case.expected_contradiction and not case.flagged)
    fn = sum(1 for case in scored if case.expected_contradiction and not case.flagged)

    score_sources = {case.score_source for case in scored if case.score_source}
    if not scored:
        score_source = None
    elif live_requested:
        score_source = "live_inference"
    elif "fixture_seeded" in score_sources:
        score_source = "fixture_seeded"
    else:
        score_source = "fixture_deterministic"

    estimated_latency: dict[str, float] | None = None
    if live_requested:
        latencies = [case.latency_ms for case in scored if case.latency_ms is not None]
        median, p95, n = _latency_stats(latencies)
        latency_scope = (
            "live_end_to_end" if scored and all(case.case_mode == "LIVE" for case in scored)
            else "local_replay" if scored and all(case.case_mode == "REPLAYED" for case in scored)
            else "mixed" if scored
            else "unavailable"
        )

        costs = [case.cost_usd for case in scored]
        cost_known = [cost for cost in costs if cost is not None]
        cost_type = (
            "not_applicable_replay" if scored and all(case.cost_type == "not_applicable_replay" for case in scored)
            else "estimated_from_actual_tokens" if scored and all(case.cost_type == "estimated_from_actual_tokens" for case in scored)
            else "partial_estimated_from_actual_tokens" if cost_known
            else "unavailable"
        )
        avg_cost = round(sum(cost_known) / len(scored), 9) if scored and len(cost_known) == len(scored) else None
    else:
        # Replay cases execute locally in microseconds. Report design targets,
        # never local timings, as latency.
        median, p95, n = None, None, 0
        latency_scope = "estimated_design_targets"
        estimated_latency = _estimated_latency(key)
        # Cost is a design estimate over every labelled case, independent of
        # whether that case's prediction was fixture-seeded.
        estimates = [
            _estimate_replay_cost(key, case.expected_contradiction) for case in cases
        ]
        avg_cost = round(sum(estimates) / len(estimates), 9) if estimates else None
        cost_type = "estimated_public_rates" if estimates else "unavailable"
    per_1k = round(avg_cost * 1000.0, 4) if avg_cost is not None else None

    notes: list[str] = []
    replay_checked = [
        case for case in cases
        if case.predicted_outcome in {"CRITICAL_INTERCEPT", "SILENT_PASS"}
    ]
    replay_matches = sum(
        1 for case in replay_checked
        if case.predicted_outcome == case.expected_outcome
    )
    if not live_requested:
        replay_total = len(replay_checked)
        replay_match_count = replay_matches
        replay_pct = _rate(replay_matches, replay_total)
        notes.append(
            "Replay mode: no provider calls were made. "
            f"{replay_matches}/{replay_total} predicted/expected fixture checks match; "
            "classification metrics score deterministic fixture routing, not model accuracy."
        )
        seeded_count = sum(1 for case in scored if case.score_source == "fixture_seeded")
        if seeded_count:
            notes.append(
                f"{seeded_count}/{len(scored)} scored case(s) used fixture-seeded stage-4 "
                "candidates; those predictions are fixture wiring, not model outputs."
            )
        notes.append(
            "Cost is estimated from documented token budgets at public list rates; "
            "not a provider invoice."
        )
        notes.append(
            "Latency figures are design targets from the Stage Details table, not measurements."
        )
    else:
        replay_total = 0
        replay_match_count = 0
        replay_pct = None
    if not scored:
        notes.append(
            "No live-scored cases; run --live to measure model performance."
            if live_requested
            else "No evaluable predictions; metrics are N/A."
        )

    if live_requested and len(scored) < len(cases):
        notes.append(
            f"{len(cases) - len(scored)} case(s) excluded from live metrics "
            "(fixture seed, provider failure, or fallback)."
        )

    return ConfigSummary(
        key=key,
        name=CONFIG_NAMES[key],
        description=CONFIG_COMPONENTS[key],
        input_modality="report text only (no image)" if key != "tiered_router" else "image + report text",
        mode=mode,
        total_cases=len(cases),
        evaluable_cases=sum(1 for case in cases if case.evaluable),
        scored_cases=len(scored),
        score_source=score_source,
        incomplete_cases=len(cases) - len(scored),
        failed_cases=sum(1 for case in cases if case.status in {"failed", "error"}),
        fallback_affected_cases=sum(1 for case in cases if case.fallback_affected),
        replay_check_total=replay_total,
        replay_check_matches=replay_match_count,
        replay_check_pct=replay_pct,
        positive_cases_total=sum(1 for case in cases if case.expected_contradiction),
        negative_cases_total=sum(1 for case in cases if not case.expected_contradiction),
        positive_cases_scored=sum(1 for case in scored if case.expected_contradiction),
        negative_cases_scored=sum(1 for case in scored if not case.expected_contradiction),
        tp=tp,
        fp=fp,
        tn=tn,
        fn=fn,
        recall_pct=_rate(tp, tp + fn),
        precision_pct=_rate(tp, tp + fp),
        specificity_pct=_rate(tn, tn + fp),
        fpr_pct=_rate(fp, fp + tn),
        median_latency_ms=median,
        p95_latency_ms=p95,
        latency_n=n,
        latency_scope=latency_scope,
        estimated_latency_ms=estimated_latency,
        cost_per_1k_discharges_usd=per_1k,
        cost_per_discharge_avg_usd=avg_cost,
        cost_type=cost_type,
        cost_reduction_vs_ultra_pct=(
            round((ultra_cost - per_1k) / ultra_cost * 100.0, 1)
            if ultra_cost and per_1k is not None and ultra_cost > 0
            else None
        ),
        notes=notes,
    )


def run_benchmark(options: BenchmarkOptions | None = None) -> BenchmarkReport:
    options = options or BenchmarkOptions()
    raw_records = load_encounter_records()
    encounters = load_encounters()
    if options.encounter_ids:
        wanted = set(options.encounter_ids)
        encounters = [enc for enc in encounters if enc.encounter_id in wanted]
        raw_records = [rec for rec in raw_records if rec["encounter_id"] in wanted]
        missing = wanted - {enc.encounter_id for enc in encounters}
        if missing:
            raise ValueError(f"Unknown encounter id(s): {sorted(missing)}")
    if options.case_limit is not None:
        encounters = encounters[: options.case_limit]
        raw_records = raw_records[: options.case_limit]

    labels: dict[str, list[FindingSpec]] = {
        record["encounter_id"]: load_eval_specs(record["encounter_id"])
        for record in raw_records
    }

    configs = list(options.configs)
    matrix: dict[str, list[CaseResult]] = {key: [] for key in configs}

    for encounter in encounters:
        ledger = SpendLedger(*spend_caps().values())
        ledger.seed_day(day_cost())
        if "nano_only" in configs:
            matrix["nano_only"].append(evaluate_nano_only(encounter, options, ledger))
        if "ultra_only" in configs:
            matrix["ultra_only"].append(
                evaluate_ultra_only(
                    encounter,
                    options,
                    ledger,
                    seed_candidates=(labels[encounter.encounter_id] if not options.live else None),
                )
            )
        if "tiered_router" in configs:
            matrix["tiered_router"].append(evaluate_tiered_router(encounter, options))

    # Attach ground-truth labels only after predictions exist.
    for cases in matrix.values():
        for case in cases:
            case.expected_contradiction = bool(labels[case.encounter_id])
            case.expected_outcome = (
                "CRITICAL_INTERCEPT" if case.expected_contradiction else "SILENT_PASS"
            )
            # Recompute scoring now that the label is known (scoring, not prediction).
            _apply_scoring(case, options.live)

    summary = {
        key: _summarize_config(key, cases, live_requested=options.live)
        for key, cases in matrix.items()
    }
    ultra_cost = summary["ultra_only"].cost_per_1k_discharges_usd if "ultra_only" in summary else None
    if "tiered_router" in summary:
        summary["tiered_router"] = _summarize_config(
            "tiered_router",
            matrix["tiered_router"],
            live_requested=options.live,
            ultra_cost=ultra_cost,
        )

    all_modes = {cfg.mode for cfg in summary.values()}
    if "LIVE" in all_modes and len(all_modes) > 1:
        overall_mode = "MIXED"
    elif all_modes == {"LIVE"}:
        overall_mode = "LIVE"
    elif all_modes == {"FAILED"}:
        overall_mode = "FAILED"
    else:
        overall_mode = "REPLAYED" if "LIVE" not in all_modes else "MIXED"

    detailed_cases: list[CaseResult] = []
    for record in raw_records:
        eid = record["encounter_id"]
        tiered = next((case for case in matrix.get("tiered_router", []) if case.encounter_id == eid), None)
        if tiered is not None:
            detailed_cases.append(tiered)
        else:
            fallback = next(
                (case for cases in matrix.values() for case in cases if case.encounter_id == eid),
                None,
            )
            if fallback:
                detailed_cases.append(fallback)

    models = dict(options.model_ids)
    pricing = pricing_snapshot()
    pricing["replay_estimate_model"] = {
        "token_budgets_per_discharge": REPLAY_TOKEN_BUDGETS,
        "stage_latency_targets_ms": STAGE_LATENCY_TARGETS_MS,
        "note": (
            "Documented design assumptions used for replay cost/latency estimates. "
            "They are not measured provider usage or inference latency."
        ),
    }
    meta = BenchmarkMeta(
        eval_date=time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        mode=overall_mode,
        environment=overall_mode,
        requested_mode="live" if options.live else "replay",
        scoring_basis="live_inference" if options.live else "fixture_deterministic",
        git_commit=_git_commit(),
        total_encounters=len(encounters),
        positive_cases=sum(1 for enc in encounters if labels[enc.encounter_id]),
        negative_cases=sum(1 for enc in encounters if not labels[enc.encounter_id]),
        safe_count=sum(1 for enc in encounters if not labels[enc.encounter_id]),
        contradiction_count=sum(1 for enc in encounters if labels[enc.encounter_id]),
        total_eval_runs=len(encounters) * len(configs),
        configs_evaluated=configs,
        case_limit=options.case_limit,
        case_ids=[enc.encounter_id for enc in encounters],
        models_resolved={role: models.get(role) for role in ("vision", "gate", "reasoning", "failsafe")},
        tavily_configured=bool(options.search_post is not None or TAVILY_API_KEY),
        pricing=pricing,
        disclaimers=DISCLAIMERS,
        limitations=[
            "Nano-only and Ultra-only baselines use report-derived findings, not image inference.",
            "Synthetic fixtures are regression/demo cases, not a clinical validation cohort.",
            "A synthetic 12-case set cannot establish sensitivity or specificity in clinical use.",
            "Deterministic span/absence checks reject defined unsupported quotes; they are not a universal hallucination guarantee.",
            "Tavily credit costs are external and not included in token cost estimates.",
        ],
    )
    report = BenchmarkReport(
        schema_version=SCHEMA_VERSION,
        meta=meta,
        summary=summary,
        configs=summary,
        cases=detailed_cases,
    )
    # Validate before returning/saving (Pydantic is the schema gate).
    return BenchmarkReport.model_validate(report.model_dump())


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _fmt_pct(value: float | None) -> str:
    return f"{value:.1f}%" if value is not None else "N/A"


def _fmt_ms(value: float | None) -> str:
    return f"{value:.2f} ms" if value is not None else "N/A"


def _fmt_cost(value: float | None) -> str:
    return f"${value:.4f}" if value is not None else "N/A"


def render_markdown_table(report: BenchmarkReport) -> str:
    lines = [
        "| Configuration | Mode | Basis | Scored (pos/neg) | Replay check | TP/FP/TN/FN | Recall | Precision | Specificity | FPR | Latency | Cost / 1k | Cost type |",
        "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |",
    ]
    for key in ("nano_only", "ultra_only", "tiered_router"):
        row = report.summary.get(key)
        if row is None:
            continue
        support = f"{row.scored_cases} ({row.positive_cases_scored}/{row.negative_cases_scored})"
        replay = (
            f"{row.replay_check_matches}/{row.replay_check_total}"
            if row.replay_check_total
            else "—"
        )
        matrix = f"{row.tp}/{row.fp}/{row.tn}/{row.fn}"
        if row.median_latency_ms is not None:
            latency = f"{_fmt_ms(row.median_latency_ms)} / {_fmt_ms(row.p95_latency_ms)}"
        elif row.estimated_latency_ms:
            latency = f"est. {row.estimated_latency_ms.get('critical_path_ms', 0):.0f} ms"
        else:
            latency = "N/A"
        cost = _fmt_cost(row.cost_per_1k_discharges_usd)
        lines.append(
            f"| {row.name} | {row.mode} | {row.score_source or '—'} | {support} | {replay} | {matrix} | "
            f"{_fmt_pct(row.recall_pct)} | {_fmt_pct(row.precision_pct)} | {_fmt_pct(row.specificity_pct)} | "
            f"{_fmt_pct(row.fpr_pct)} | {latency} | {cost} | {row.cost_type} |"
        )
    return "\n".join(lines)


def _resolve_live_models() -> tuple[dict[str, str], list[str]]:
    """Resolve model IDs from the provider listing; fail early on ambiguity."""
    import httpx

    if not NEBIUS_API_KEY:
        raise RuntimeError("NEBIUS_API_KEY is not set; refusing to pretend a live run.")
    with httpx.Client(timeout=20.0) as client:
        resolved = config.resolve_model_ids(client)
    problems: list[str] = []
    for role in ("gate", "reasoning"):
        if resolved.get(role) == config.DEFAULT_MODEL_IDS.get(role):
            # The resolver falls back to defaults on failure; in live mode we
            # require a provider-listed ID rather than a guessed one.
            problems.append(role)
    if problems:
        raise RuntimeError(
            "Could not resolve provider-listed model IDs for: " + ", ".join(problems)
        )
    return resolved, []


def main() -> None:
    parser = argparse.ArgumentParser(description="SilentCatch architecture benchmark")
    parser.add_argument("--live", action="store_true", help="Run live provider inference (costs apply)")
    parser.add_argument("--replay", action="store_true", help="Force deterministic replay (default)")
    parser.add_argument("--limit", type=int, default=None, help="Evaluate only the first N encounters")
    parser.add_argument(
        "--case",
        action="append",
        dest="cases",
        default=[],
        help="Evaluate a specific encounter id (repeatable), e.g. --case ED-104",
    )
    parser.add_argument("--smoke", action="store_true", help="One-case connectivity smoke test")
    parser.add_argument(
        "--config",
        choices=("all", "nano", "ultra", "tiered"),
        default="all",
        help="Restrict the benchmark to one configuration",
    )
    parser.add_argument("--output", type=Path, default=RESULTS_PATH)
    parser.add_argument(
        "--assert-passing",
        action="store_true",
        help="Fail unless the tiered config reaches 0%% FPR and 100%% recall on scored cases",
    )
    parser.add_argument("--json", action="store_true", help="Print the report JSON to stdout")
    args = parser.parse_args()

    if args.live and args.replay:
        parser.error("--live and --replay are mutually exclusive")

    live = bool(args.live)
    case_limit = args.limit
    if args.smoke:
        case_limit = 1
    if live and not NEBIUS_API_KEY:
        parser.error(
            "NEBIUS_API_KEY is not set. Refusing to run --live; no live result will be fabricated."
        )
    if live and not TAVILY_API_KEY:
        print(
            "WARNING: TAVILY_API_KEY is not set. Tiered/Ultra guideline retrieval will use the "
            "local snapshot; those cases will be MIXED, not LIVE.",
            file=sys.stderr,
        )

    models = dict(config.DEFAULT_MODEL_IDS)
    if live:
        try:
            models, _ = _resolve_live_models()
        except Exception as exc:  # noqa: BLE001
            parser.error(f"Live model-ID resolution failed: {type(exc).__name__}: {exc}")
        config.resolved_model_ids = models  # type: ignore[attr-defined]
        print(
            "LIVE benchmark requested. External API calls will be made and may incur charges. "
            "Spend caps: $%.2f/discharge, $%.2f/day."
            % (spend_caps()["per_discharge_usd"], spend_caps()["daily_usd"]),
            file=sys.stderr,
        )
    else:
        print(
            "REPLAY benchmark: no provider calls will be made"
            + (" (API keys are present but ignored)." if NEBIUS_API_KEY else "."),
            file=sys.stderr,
        )

    if args.config != "all":
        configs = {
            "nano": ("nano_only",),
            "ultra": ("ultra_only",),
            "tiered": ("tiered_router",),
            "all": ("nano_only", "ultra_only", "tiered_router"),
        }[args.config]
    else:
        configs = ("nano_only", "ultra_only", "tiered_router")

    transport = None
    close_transport = lambda: None  # noqa: E731
    if live:
        transport, close_transport = pipeline.build_live_transport()

    options = BenchmarkOptions(
        live=live,
        transport=transport,
        model_ids=models,
        case_limit=case_limit,
        encounter_ids=tuple(args.cases),
        configs=configs,
        allow_seed_fallback=not live,
    )
    try:
        report = run_benchmark(options)
    finally:
        close_transport()

    _atomic_write_json(args.output, report.model_dump())
    print(f"Saved benchmark results to {args.output}")
    print("\n" + "=" * 100)
    print("SILENTCATCH ARCHITECTURE BENCHMARK")
    print("=" * 100)
    print(render_markdown_table(report))
    print("=" * 100)
    print(f"Overall mode: {report.meta.mode} | cases: {report.meta.total_encounters} "
          f"({report.meta.positive_cases} positive / {report.meta.negative_cases} negative)")
    for disclaimer in report.meta.disclaimers:
        print(f"  - {disclaimer}")
    if args.json:
        print(json.dumps(report.model_dump(), indent=2))

    if args.assert_passing:
        tiered = report.summary.get("tiered_router")
        if tiered is None or tiered.mode != "LIVE" or tiered.scored_cases == 0:
            raise SystemExit(
                "Refusing to assert live acceptance criteria: tiered mode is "
                f"{tiered.mode if tiered else 'missing'} with {tiered.scored_cases if tiered else 0} scored cases."
            )
        if tiered.fpr_pct != 0.0 or tiered.recall_pct != 100.0:
            raise SystemExit(
                f"Acceptance criteria failed: FPR={tiered.fpr_pct}, recall={tiered.recall_pct}."
            )
        print("Live acceptance criteria passed on the scored cases.")


if __name__ == "__main__":
    main()
