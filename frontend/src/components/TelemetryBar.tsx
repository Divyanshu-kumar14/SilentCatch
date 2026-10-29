"use client";

import React, { useEffect, useMemo, useState } from "react";

import { shortModel } from "@/lib/clinical";
import type { Phase, RunStartEvent, StageTrace } from "@/lib/types";

const STAGE_CONFIG: ReadonlyArray<{
  id: string;
  label: string;
  role: string;
}> = [
  { id: "vision", label: "Vision", role: "vision extractor" },
  { id: "gate", label: "Gate", role: "deterministic + nano" },
  { id: "guideline", label: "Evidence", role: "guideline lookup" },
  { id: "reasoning", label: "Ultra", role: "reasoning + verifier" },
];

/**
 * README "Stage Details" design budgets, mirrored from
 * `eval/benchmark.py::STAGE_LATENCY_TARGETS_MS`. Replay executes locally in
 * microseconds, so these targets are shown with an asterisk instead.
 */
const STAGE_DESIGN_TARGET_MS: Readonly<Record<string, number>> = {
  vision: 400,
  gate: 250,
  guideline: 300,
  reasoning: 600,
};

/** Machine-readable backend provenance -> short UI label. */
function provenanceLabel(source: string | undefined): string | null {
  if (!source) return null;
  if (source === "live" || source === "failsafe_live" || source === "tavily_live") {
    return null; // genuinely live; no badge needed
  }
  if (source === "live_override") return "OVERRIDE";
  if (source === "live_empty") return "CLEAR"; // valid empty proposal: model read clean, not a rejection
  if (source === "live_rejected") return "REJECTED";
  if (source === "failure_no_prediction") return "FAILED";
  if (source === "cache_hit") return "CACHE";
  if (source.includes("fallback")) return "FALLBACK";
  if (source === "cache_snapshot") return "SNAPSHOT";
  if (source === "deterministic_replay") return "DETERMINISTIC";
  if (source.includes("replay") || source.includes("seed")) return "REPLAY";
  return source.toUpperCase();
}

function provenanceTone(label: string): string {
  if (label === "FAILED" || label === "REJECTED") return "text-signal";
  if (label === "FALLBACK" || label === "OVERRIDE") return "text-warn";
  return "text-faint";
}

function TelemetryBar({
  phase,
  runStart,
  traces,
  activeStage,
}: {
  phase: Phase;
  runStart?: RunStartEvent | null;
  traces: StageTrace[];
  activeStage: string | null;
}) {
  const isRunning = phase === "running";
  const overallMode = runStart?.mode ?? null;
  const isReplay = overallMode === "REPLAYED";

  // Live inference (Ultra 550B) can take 15-20s per stage; a ticking elapsed
  // readout proves the stream is alive instead of looking frozen.
  const [elapsedS, setElapsedS] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const t0 = Date.now();
    setElapsedS(0);
    const id = setInterval(() => setElapsedS(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [isRunning]);
  const activeLabel = activeStage
    ? (STAGE_CONFIG.find((c) => c.id === activeStage)?.label ?? activeStage).toLowerCase()
    : null;
  const estimatedLatency = isReplay
    ? STAGE_CONFIG.reduce(
        (sum, cfg) =>
          traces.some((t) => t.stage === cfg.id)
            ? sum + (STAGE_DESIGN_TARGET_MS[cfg.id] ?? 0)
            : sum,
        0,
      )
    : 0;

  // Aggregate only values the backend actually measured. Replay traces carry
  // zero/absent cost, so a replay run must not display a provider dollar figure.
  const { totalLatency, totalTokens, totalCost, hasTokenData, costApplicable } = useMemo(() => {
    let latency = 0;
    let tokens = 0;
    let cost = 0;
    let hasTokens = false;
    let providerEvidence = false;
    for (const t of traces) {
      latency += t.latency_ms ?? 0;
      const prompt = t.prompt_tokens ?? 0;
      const completion = t.completion_tokens ?? 0;
      if (prompt + completion > 0) {
        hasTokens = true;
        tokens += prompt + completion;
      }
      cost += t.est_cost_usd ?? 0;
      if (
        t.source === "live" ||
        t.source === "live_override" ||
        t.source === "failsafe_live" ||
        t.source === "tavily_live"
      ) {
        providerEvidence = true;
      }
    }
    return {
      totalLatency: latency,
      totalTokens: tokens,
      totalCost: cost,
      hasTokenData: hasTokens,
      costApplicable: overallMode === "LIVE" && providerEvidence,
    };
  }, [traces, overallMode]);

  return (
    <footer className="relative z-50 flex h-9 shrink-0 items-center justify-between gap-4 border-t border-edge bg-paper-deep px-4">
      {/* four pipeline stages, read as a ledger row */}
      <ol className="hidden min-w-0 items-center gap-0 md:flex">
        {STAGE_CONFIG.map((cfg, index) => {
          const trace = traces.find((t) => t.stage === cfg.id);
          const isActive = activeStage === cfg.id;
          const isDone = Boolean(trace);
          const badge = provenanceLabel(trace?.source);
          const designTarget = isReplay ? STAGE_DESIGN_TARGET_MS[cfg.id] : null;

          return (
            <li key={cfg.id} className="flex min-w-0 items-center">
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span
                  className={`h-1 w-1 shrink-0 translate-y-[-1px] rounded-full ${
                    isActive ? "bg-signal live-dot" : isDone ? "bg-safe" : "bg-edge-2"
                  }`}
                  aria-hidden
                />
                <span
                  className={`text-[11px] ${
                    isActive ? "font-medium text-ink" : isDone ? "text-ink-2" : "text-faint"
                  }`}
                >
                  {cfg.label}
                </span>

                {trace ? (
                  <span className="mono flex items-baseline gap-1.5 text-[10.5px] text-faint">
                    {trace.model_id && (
                      <span className="hidden text-muted lg:inline">{shortModel(trace.model_id)}</span>
                    )}
                    <span
                      className="text-ink-2"
                      title={
                        designTarget != null
                          ? "Design target from the README Stage Details table; not measured inference latency"
                          : undefined
                      }
                    >
                      {designTarget != null
                        ? `~${designTarget}ms*`
                        : trace.latency_ms == null
                          ? "—"
                          : trace.latency_ms < 1
                            ? "<1ms"
                            : `${Math.round(trace.latency_ms)}ms`}
                    </span>
                    {(trace.prompt_tokens ?? 0) + (trace.completion_tokens ?? 0) > 0 && (
                      <span className="hidden md:inline">
                        {(trace.prompt_tokens ?? 0) + (trace.completion_tokens ?? 0)}tok
                      </span>
                    )}
                    {badge && (
                      <span
                        title={trace.note || trace.source}
                        className={`uppercase tracking-[0.04em] ${provenanceTone(badge)}`}
                      >
                        {badge}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="hidden text-[10.5px] text-faint xl:inline">{cfg.role}</span>
                )}
              </div>

              {index < STAGE_CONFIG.length - 1 && (
                <span className="mx-2 h-px w-3 bg-edge-2" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>

      <div className="ml-auto flex shrink-0 items-center gap-3 text-[11px]">
        {isRunning && (
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <span className="h-1 w-1 rounded-full bg-signal live-dot" aria-hidden />
            streaming
            {activeLabel && (
              <span className="mono font-normal text-muted">
                · {activeLabel} {elapsedS}s
              </span>
            )}
          </span>
        )}

        {runStart?.mode_note && (
          <span
            className="hidden max-w-[30ch] truncate text-faint xl:inline"
            title={runStart.mode_note}
          >
            {runStart.mode_note}
          </span>
        )}

        {traces.length > 0 && (
          <div className="mono flex items-center gap-3 border-l border-edge pl-3">
            <span
              className="text-faint"
              title={
                isReplay
                  ? "Estimated from README design targets; this replay made no provider call"
                  : "Measured stage time from the SSE stream"
              }
            >
              {isReplay ? "est. " : "elapsed "}
              <span className={isReplay ? "text-warn" : "text-ink-2"}>
                {isReplay
                  ? estimatedLatency > 0
                    ? `~${Math.round(estimatedLatency)}ms*`
                    : "N/A"
                  : totalLatency < 1
                    ? "<1ms"
                    : `${Math.round(totalLatency)}ms`}
              </span>
              {isReplay && estimatedLatency > 0 && (
                <span className="ml-1 text-faint">(estimated)</span>
              )}
            </span>
            <span className="hidden text-faint sm:inline">
              tokens{" "}
              <span className="text-ink-2">{hasTokenData ? totalTokens : "N/A"}</span>
            </span>
            <span className="text-faint" title={
              costApplicable
                ? "Estimated from token usage at public rates"
                : "No provider call in this run; cost is not applicable"
            }>
              cost{" "}
              <span className="text-ink-2">
                {overallMode === "REPLAYED"
                  ? "N/A (replay)"
                  : costApplicable
                    ? totalCost > 0 && totalCost < 0.0001
                      ? "<$0.0001"
                      : `$${totalCost.toFixed(4)}`
                    : "N/A"}
              </span>
            </span>
          </div>
        )}
      </div>
    </footer>
  );
}

export default React.memo(TelemetryBar);
