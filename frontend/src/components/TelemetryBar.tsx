"use client";

import React, { useMemo } from "react";

import { shortModel } from "@/lib/clinical";
import type { Phase, RunStartEvent, StageTrace } from "@/lib/types";

const STAGE_CONFIG: ReadonlyArray<{
  id: string;
  label: string;
  role: string;
}> = [
  { id: "vision", label: "STAGE 1 · VISION", role: "Super VL 120B" },
  { id: "gate", label: "STAGE 2 · GATE", role: "Nano 30B" },
  { id: "guideline", label: "STAGE 3 · EVIDENCE", role: "Tavily Guidelines" },
  { id: "reasoning", label: "STAGE 4 · ULTRA", role: "Ultra 550B + Rig" },
];

function TelemetryBar({
  phase,
  _runStart,
  traces,
  activeStage,
}: {
  phase: Phase;
  _runStart?: RunStartEvent | null;
  traces: StageTrace[];
  activeStage: string | null;
}) {
  const isRunning = phase === "running";

  // Single-pass aggregate totals with useMemo
  const { totalLatency, totalTokens, totalCost } = useMemo(() => {
    let latency = 0;
    let tokens = 0;
    let cost = 0;
    for (const t of traces) {
      latency += t.latency_ms || 0;
      tokens += (t.prompt_tokens || 0) + (t.completion_tokens || 0);
      cost += t.est_cost_usd || 0;
    }
    return { totalLatency: latency, totalTokens: tokens, totalCost: cost };
  }, [traces]);

  return (
    <footer className="flex h-11 shrink-0 items-center justify-between border-t border-white/10 bg-slate-950/90 px-4 font-mono text-[10px] backdrop-blur-md">
      {/* ---------------- 4 pipeline stages ---------------- */}
      <div className="flex items-center gap-2">
        {STAGE_CONFIG.map((cfg) => {
          const trace = traces.find((t) => t.stage === cfg.id);
          const isActive = activeStage === cfg.id;
          const isDone = Boolean(trace);

          return (
            <div
              key={cfg.id}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-all ${
                isActive
                  ? "border-sky-400/60 bg-sky-500/20 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.25)]"
                  : isDone
                    ? "border-white/10 bg-slate-900/80 text-slate-200"
                    : "border-white/5 bg-slate-950/40 text-slate-500"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  isActive
                    ? "bg-sky-400 animate-ping"
                    : isDone
                      ? "bg-emerald-400 shadow-[0_0_6px_#10b981]"
                      : "bg-slate-600"
                }`}
              />
              <span className="font-bold">{cfg.label}</span>

              {trace ? (
                <div className="flex items-center gap-1 text-[9px] text-slate-400">
                  {trace.model_id && (
                    <span className="text-slate-500">{shortModel(trace.model_id)}</span>
                  )}
                  <span className="text-slate-300 font-semibold">{trace.latency_ms}ms</span>
                  {trace.prompt_tokens > 0 && (
                    <span className="text-slate-500">
                      {trace.prompt_tokens + trace.completion_tokens}tok
                    </span>
                  )}
                  {trace.replayed && (
                    <span className="rounded bg-amber-500/15 border border-amber-500/40 px-1 text-[8px] font-bold text-amber-300">
                      REPLAY
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-[9px] text-slate-500">{cfg.role}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------- right totals & spend ---------------- */}
      <div className="flex items-center gap-3.5 text-[10px]">
        {_runStart?.mode_note && (
          <span className="text-[9px] text-slate-500 max-w-36 truncate" title={_runStart.mode_note}>
            {_runStart.mode_note}
          </span>
        )}
        {isRunning && (
          <span className="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold text-sky-400 animate-pulse">
            <span className="h-2 w-2 rounded-full bg-sky-400 animate-ping" />
            STREAMING PIPELINE…
          </span>
        )}
        {traces.length > 0 && (
          <>
            <div className="flex items-center gap-1 text-slate-400">
              <span className="text-slate-500">Latency:</span>
              <span className="font-bold text-slate-200">{totalLatency}ms</span>
            </div>

            <div className="flex items-center gap-1 text-slate-400">
              <span className="text-slate-500">Tokens:</span>
              <span className="font-bold text-slate-200">{totalTokens}</span>
            </div>

            <div className="flex items-center gap-1 text-slate-400">
              <span className="text-slate-500">Audit Cost:</span>
              <span className={`font-bold ${totalCost > 0 ? "text-sky-400" : "text-slate-200"}`}>
                ${totalCost.toFixed(4)}
              </span>
            </div>
          </>
        )}
      </div>
    </footer>
  );
}

export default React.memo(TelemetryBar);
