"""4-stage audit pipeline (PRD Phase 2) — LIVE and REPLAYED, same output schema.

Offline determinism note (PRD NFR §7): with no NEBIUS_API_KEY the identical
audit runs — vision/gate/reasoning fall to the deterministic seed path, Tavily
falls to the guideline snapshot — and every trace says so (`replayed` badge).
With keys present, live calls run through the Token Factory client; failures
fall down the same ladder. Guards are never bypassed in either mode.
"""

from __future__ import annotations

import concurrent.futures
import functools
import json
import logging
import queue
import threading
import time
from typing import Callable, Iterator

import openai
from openai import OpenAI

from backend.config import NEBIUS_API_KEY, NEBIUS_BASE_URL, resolved, spend_caps
from backend.engine import (
    contradiction_ultra,
    guideline_search,
    kinematic_labs,
    noise_gate,
    vision_extractor,
)
from backend.engine.replay import ReplayStore
from backend.engine.telemetry import SpendLedger, add_day_cost, day_cost, estimate_cost
from backend.fixtures.loader import FIXTURES_DIR, load_eval_specs
from backend.schemas import (
    AuditResult,
    Encounter,
    FindingKind,
    ScanFinding,
    StageTrace,
)

logger = logging.getLogger(__name__)

StageRole = str  # vision | gate | reasoning | failsafe

_LIVE_SOURCES = frozenset({"live", "failsafe_live", "tavily_live"})
_LOCAL_SOURCES = frozenset(
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
_FAILURE_SOURCES = frozenset({"failure_no_prediction"})


def stage_source_key(trace: StageTrace) -> str:
    """Stable per-stage key for provenance maps (two guideline sub-stages)."""
    if trace.stage == "guideline" and trace.source in {
        "tavily_live",
        "cache_snapshot",
        "cache_snapshot_fallback",
        "snapshot_only",
    }:
        return "guideline_search"
    if trace.stage == "guideline":
        return "guideline_query"
    return trace.stage


def audit_execution_summary(
    traces: list[StageTrace], required_stages: list[str]
) -> tuple[str, dict[str, str], bool]:
    """Derive mode from what actually happened, never from key presence."""
    sources: dict[str, str] = {}
    for trace in traces:
        sources[stage_source_key(trace)] = trace.source or (
            "replay_seed" if trace.replayed else "live"
        )

    observed = [sources[key] for key in required_stages if key in sources]
    if not observed:
        return "REPLAYED", sources, False

    live_count = sum(1 for source in observed if source in _LIVE_SOURCES)
    failure = any(source in _FAILURE_SOURCES for source in observed)
    fallback = any(
        source not in _LIVE_SOURCES and source not in _LOCAL_SOURCES
        for source in observed
    ) or any(source in {"cache_hit", "cache_snapshot"} for source in observed)

    if failure and live_count == 0:
        mode = "FAILED"
    elif live_count == len(observed) and not fallback:
        mode = "LIVE"
    elif live_count > 0:
        mode = "MIXED"
    else:
        mode = "REPLAYED"
    return mode, sources, fallback


@functools.lru_cache(maxsize=32)
def _fixture_png(url: str | None) -> bytes | None:
    """PRD image URLs are '/fixtures/images/<name>.png' under backend/fixtures."""
    if not url:
        return None
    trimmed = url.lstrip("/")
    if trimmed.startswith("fixtures/"):
        path = FIXTURES_DIR / trimmed[len("fixtures/"):]
    else:
        path = FIXTURES_DIR.parent / trimmed
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _kind_hints(unaddressed: list[ScanFinding], flags: list[str]) -> list[FindingKind]:
    kinds: list[FindingKind] = []
    if any(finding.recommended_cpt for finding in unaddressed):
        kinds.append(FindingKind.INCIDENTAL_FINDING_DROP)
    if flags:
        kinds.append(FindingKind.KINETIC_MED_COLLISION)
    return kinds


def _role_for(trace: StageTrace) -> StageRole:
    """Best-effort pricing role from a trace's stage/note (G3 estimates)."""
    stage = trace.stage
    if stage == "reasoning" and "failsafe" in (trace.note or "").lower():
        return "failsafe"
    if stage == "guideline":
        # query generation is a Nano call; the Tavily fetch is token-less
        return "gate" if trace.model_id else "failsafe"
    return {"vision": "vision", "gate": "gate", "reasoning": "reasoning"}.get(
        stage, "failsafe"
    )


def _attr(
    trace: StageTrace,
    ledger: SpendLedger,
) -> StageTrace:
    """Attribute live-call cost. Replays cost $0 — that's the whole point."""
    if trace.replayed:
        return trace
    cost = estimate_cost(_role_for(trace), trace.prompt_tokens, trace.completion_tokens)
    trace.est_cost_usd = round(cost, 8)
    ledger.charge_live_call(cost)
    add_day_cost(cost)
    return trace


def build_live_transport() -> tuple[vision_extractor.LlmTransport | None, Callable[[], None]]:
    """One Token Factory client per audit; TimeoutError is the failover signal."""
    if not NEBIUS_API_KEY:
        return None, (lambda: None)
    client = OpenAI(
        api_key=NEBIUS_API_KEY,
        base_url=NEBIUS_BASE_URL,
        max_retries=0,  # retries live in our own fallback ladder
    )

    def transport(
        model_id: str,
        messages: list[dict],
        *,
        timeout_s: float,
        extra_body: dict | None = None,
    ) -> tuple[str, dict]:
        try:
            response = client.chat.completions.create(
                model=model_id,
                messages=messages,
                temperature=0.0,
                timeout=timeout_s,
                extra_body=extra_body or {},
            )
        except openai.APITimeoutError as exc:
            raise TimeoutError(str(exc)) from exc
        content = response.choices[0].message.content or ""
        usage = getattr(response, "usage", None)
        return content, {
            "prompt_tokens": getattr(usage, "prompt_tokens", 0),
            "completion_tokens": getattr(usage, "completion_tokens", 0),
        }

    return transport, client.close


def run_audit(  # noqa: C901 — a guarded linear stream read top to bottom
    encounter: Encounter,
    *,
    ledger: SpendLedger | None = None,
    replay: ReplayStore | None = None,
    transport_factory: Callable[[], tuple] | None = None,
    search_post: guideline_search.HttpPostFn | None = None,
    vision_cache: dict[str, object] | None = None,
    emit: Callable[[dict], None] | None = None,
    allow_live: bool = True,
    allow_seed_fallback: bool = True,
) -> AuditResult:
    """Run the 4-stage audit; emit ordered events; never raise to the stream.

    `allow_live=False` forces the deterministic/replay ladder even when API keys
    are present (used by the default benchmark and offline tests).
    `allow_seed_fallback=False` forbids expected-label fixtures from becoming a
    prediction (used by live predictive evaluation).
    """
    if ledger is None:
        ledger = SpendLedger(*spend_caps().values())
        ledger.seed_day(day_cost())
    replay = replay or ReplayStore()
    events: list[dict] = []
    emit = emit or events.append
    started = time.perf_counter()
    traces: list[StageTrace] = []

    def stage_event(kind: str, stage: str, extra: dict | None = None) -> None:
        data = {"stage": stage}
        if extra:
            data.update(extra)
        emit({"event": kind, "data": data})

    def finish(result: AuditResult) -> AuditResult:
        required = ["vision", "gate"]
        if any(trace.stage == "guideline" for trace in result.traces):
            required += ["guideline_query", "guideline_search"]
        if any(trace.stage == "reasoning" for trace in result.traces):
            required += ["reasoning"]
        mode, sources, fallback = audit_execution_summary(result.traces, required)
        result.execution_mode = mode
        result.stage_sources = sources
        result.fallback_used = fallback
        emit({"event": "verdict", "data": result.model_dump()})
        emit({"event": "done", "data": result.model_dump()})
        return result

    try:
        ledger.start_request()
        intended_live = (
            allow_live
            and ledger.live_call_allowed()
            and (bool(NEBIUS_API_KEY) or transport_factory is not None)
        )
        if intended_live:
            transport, close_llm = (transport_factory or build_live_transport)()
            live_llm = transport is not None
        else:
            transport, close_llm = None, lambda: None
            live_llm = False

        if not allow_live:
            mode_note = "live inference disabled by caller -> deterministic replay"
        elif NEBIUS_API_KEY and not ledger.live_call_allowed():
            # FR-2.2: budget tripped -> whole audit runs the replay path
            mode_note = f"live Budget exceeded -> replay ({ledger.cap_reason()})"
        elif not live_llm and transport_factory is None:
            mode_note = "no NEBIUS_API_KEY -> deterministic seed replay"
        elif not live_llm:
            mode_note = "injected transport unavailable -> deterministic replay"
        else:
            mode_note = ""
        emit({"event": "run_start", "data": {
            "encounter_id": encounter.encounter_id,
            "mode": "LIVE" if live_llm else "REPLAYED",
            "requested_mode": "LIVE" if allow_live else "REPLAYED",
            "daily_spend_usd": round(day_cost(), 6),
            "mode_note": mode_note,
            "allow_seed_fallback": allow_seed_fallback,
        }})
        models = resolved()

        def stage_transport() -> vision_extractor.LlmTransport | None:
            """FR-2.2 budget gate: a tripped cap disables later live calls."""
            if transport is None:
                return None
            return transport if ledger.live_call_allowed() else None

        try:
            # ---------------- Stage 1: vision ----------------
            stage_event("stage_start", "vision")
            png = _fixture_png(encounter.radiology_study.slice_image_url)
            vision_result, vision_trace = vision_extractor.extract_findings(
                encounter.radiology_study.report_text,
                image_png=png,
                transport=stage_transport(),
                model_id=models.get("vision", ""),
                vision_cache=vision_cache if vision_cache is not None else {},
            )
            _attr(vision_trace, ledger)
            traces.append(vision_trace)
            if not vision_trace.replayed:
                replay.record("vision", encounter.encounter_id,
                              vision_result.model_dump(), {"model_id": models.get("vision", "")})
            stage_event("stage_done", "vision", {
                "trace": vision_trace.model_dump(),
                "findings": [f.model_dump() for f in vision_result.findings],
                "vision_confidence": vision_result.vision_confidence,
            })

            # ---------------- Stage 2: Nano gate ----------------
            slopes = kinematic_labs.analyze_serial_labs(encounter.serial_labs)
            flags = kinematic_labs.all_flags(slopes)
            stage_event("stage_start", "gate")
            decision, gate_trace = noise_gate.decide(
                vision_result.findings,
                encounter.draft_discharge_packet,
                slopes,
                flags,
                transport=stage_transport(),
                model_id=models.get("gate", ""),
            )
            _attr(gate_trace, ledger)
            traces.append(gate_trace)
            if not gate_trace.replayed:
                replay.record("gate", encounter.encounter_id,
                              decision.model_dump(), {"model_id": models.get("gate", "")})
            stage_event("stage_done", "gate", {
                "trace": gate_trace.model_dump(),
                "decision": decision.model_dump(),
            })
            if decision.action == "SILENT_PASS":
                return finish(AuditResult(
                    encounter_id=encounter.encounter_id,
                    status="SILENT_PASS",
                    traces=traces,
                    total_cost_usd=round(ledger.request_spend, 8),
                    elapsed_ms=int((time.perf_counter() - started) * 1000),
                ))

            # ---------------- Stage 3: Tavily guidelines ----------------
            unaddressed = noise_gate.unaddressed_findings(
                vision_result.findings, encounter.draft_discharge_packet
            )
            kinds = _kind_hints(unaddressed, flags)
            stage_event("stage_start", "guideline")
            queries, query_trace = guideline_search.generate_queries(
                kinds,
                transport=stage_transport(),
                model_id=models.get("gate", ""),
            )
            bundle, search_trace = guideline_search.search(
                queries,
                http_post=search_post,
                allow_live=stage_transport() is not None,
            )
            _attr(query_trace, ledger)
            traces.append(query_trace)
            traces.append(search_trace)
            stage_event("stage_done", "guideline", {
                "queries": queries,
                "guidelines": [g.model_dump() for g in bundle.guidelines],
                "trace": search_trace.model_dump(),
                "query_trace": query_trace.model_dump(),
                "degraded": bundle.degraded,
            })

            # ---------------- Stage 4: Ultra + span-guard ----------------
            stage_event("stage_start", "reasoning")
            # Predictive evaluation disables expected-label seed candidates;
            # the demo/replay path keeps them (and badges the trace honestly).
            seed_specs = load_eval_specs(encounter.encounter_id) if allow_seed_fallback else []
            verdicts, ultra_trace = contradiction_ultra.synthesize_verdicts(
                encounter.encounter_id,
                encounter.radiology_study.report_text,
                encounter.lab_note.text if encounter.lab_note else None,
                encounter.serial_labs,
                encounter.draft_discharge_packet,
                findings=vision_result.findings,
                slopes=slopes,
                flags=flags,
                bundle=bundle,
                seed_candidates=seed_specs,
                transport=stage_transport(),
                model_id=models.get("reasoning", ""),
                failsafe_model_id=models.get("failsafe", ""),
                allow_seed_fallback=allow_seed_fallback,
            )
            _attr(ultra_trace, ledger)
            traces.append(ultra_trace)
            stage_event("stage_done", "reasoning", {
                "trace": ultra_trace.model_dump(),
                "verdicts": [v.model_dump() for v in verdicts],
            })

            status = "CRITICAL_INTERCEPT" if verdicts else "SILENT_PASS"
            return finish(AuditResult(
                encounter_id=encounter.encounter_id,
                status=status,
                verdicts=verdicts,
                traces=traces,
                total_cost_usd=round(ledger.request_spend, 8),
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            ))
        finally:
            try:
                close_llm()
            except Exception:  # noqa: BLE001 — close must not mask results
                logger.exception("LLM client close failed")
    except Exception as exc:  # noqa: BLE001 — stream terminates loud, never hangs
        logger.exception("audit pipeline crashed")
        return finish_or_error(encounter, traces, exc, started, emit)


def finish_or_error(
    encounter: Encounter,
    traces: list[StageTrace],
    exc: Exception,
    started: float,
    emit: Callable[[dict], None],
) -> AuditResult:
    required = ["vision", "gate"] + sorted(
        {stage_source_key(trace) for trace in traces if trace.stage in {"guideline", "reasoning"}}
    )
    _mode, sources, fallback = audit_execution_summary(traces, required)
    result = AuditResult(
        encounter_id=encounter.encounter_id,
        status="ERROR",
        traces=traces,
        elapsed_ms=int((time.perf_counter() - started) * 1000),
        execution_mode="ERROR",
        stage_sources=sources,
        fallback_used=fallback,
    )
    payload = result.model_dump()
    payload["error"] = f"{type(exc).__name__}: {exc}"
    emit({"event": "verdict", "data": payload})
    emit({"event": "done", "data": payload})
    # AuditResult carries status ERROR; the 'error' key rides the SSE payload only.
    return result


def serialize_sse(events: Iterator[dict]) -> Iterator[str]:
    """Format the audit event list into an SSE byte stream (utf-8 text)."""
    for event in events:
        yield f"event: {event['event']}\ndata: {json.dumps(event['data'], default=str)}\n\n"


_AUDIT_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=16, thread_name_prefix="audit-worker"
)


def event_stream(
    encounter: Encounter,
    *,
    vision_cache: dict[str, object] | None = None,
    replay: ReplayStore | None = None,
) -> Iterator[dict]:
    """Progressive audit events for SSE.

    Stage engines are synchronous (Token Factory REST calls), so the audit runs
    on a pooled worker thread emitting into a queue; the generator drains it stage by
    stage — the frontend sees stage_start/done lines incrementally (PRD R-2).
    """
    events: queue.Queue = queue.Queue()

    def worker() -> None:
        try:
            run_audit(
                encounter,
                emit=events.put,
                vision_cache=vision_cache if vision_cache is not None else {},
                replay=replay,
            )
        finally:
            events.put(None)  # sentinel: stream complete

    _AUDIT_EXECUTOR.submit(worker)
    while True:
        event = events.get()
        if event is None:
            return
        yield event
