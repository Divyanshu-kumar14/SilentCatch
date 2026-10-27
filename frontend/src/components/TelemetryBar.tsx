"use client";

import React, { useMemo } from "react";
import { Clock, Cpu, Coins } from "lucide-react";

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

  // Aggregate totals
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
    <footer className="relative z-50 flex h-12 shrink-0 items-center justify-between border-t border-white/[0.08] bg-slate-950/95 px-5 backdrop-blur-xl">
      {/* ---------------- 4 pipeline stages ---------------- */}
      <div className="flex items-center gap-2">
        {STAGE_CONFIG.map((cfg, index) => {
          const trace = traces.find((t) => t.stage === cfg.id);
          const isActive = activeStage === cfg.id;
          const isDone = Boolean(trace);

          return (
            <div key={cfg.id} className="flex items-center">
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-1 transition-all ${
                  isActive
                    ? "border-sky-500 bg-sky-500/20 text-sky-200 shadow-md shadow-sky-500/20"
                    : isDone
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                      : "border-white/5 bg-white/[0.02] text-slate-400"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isActive
                      ? "bg-sky-400 animate-ping"
                      : isDone
                        ? "bg-emerald-400"
                        : "bg-slate-600"
                  }`}
                />
                <span className="text-xs font-semibold">{cfg.label}</span>

                {trace ? (
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
                    {trace.model_id && (
                      <span className="text-slate-400">{shortModel(trace.model_id)}</span>
                    )}
                    <span className="font-semibold text-white">{trace.latency_ms}ms</span>
                    {trace.prompt_tokens > 0 && (
                      <span className="text-slate-400">
                        {trace.prompt_tokens + trace.completion_tokens}tok
                      </span>
                    )}
                    {trace.replayed && (
                      <span className="rounded bg-amber-500/20 border border-amber-500/40 px-1 text-[10px] font-semibold text-amber-300">
                        REPLAY
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-500">{cfg.role}</span>
                )}
              </div>

              {/* Connecting line between stages */}
              {index < STAGE_CONFIG.length - 1 && (
                <div
                  className={`mx-1.5 h-0.5 w-3 rounded transition-colors ${
                    isDone ? "bg-emerald-500/40" : "bg-white/10"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------- right totals & spend ---------------- */}
      <div className="flex items-center gap-5 text-xs">
        {runStart?.mode_note && (
          <span className="text-slate-400 max-w-44 truncate" title={runStart.mode_note}>
            {runStart.mode_note}
          </span>
        )}
        {isRunning && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-sky-400">
            <span className="h-2 w-2 rounded-full bg-sky-400 animate-ping" />
            STREAMING PIPELINE…
          </span>
        )}
        {traces.length > 0 && (
          <div className="flex items-center gap-4 border-l border-white/10 pl-4 font-mono text-xs">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Clock className="h-3.5 w-3.5 text-sky-400" />
              <span>Latency:</span>
              <span className="font-semibold text-white">{totalLatency}ms</span>
            </div>

            <div className="flex items-center gap-1.5 text-slate-400">
              <Cpu className="h-3.5 w-3.5 text-sky-400" />
              <span>Tokens:</span>
              <span className="font-semibold text-white">{totalTokens}</span>
            </div>

            <div className="flex items-center gap-1.5 text-slate-400">
              <Coins className="h-3.5 w-3.5 text-emerald-400" />
              <span>Audit Cost:</span>
              <span className="font-semibold text-emerald-300">
                ${totalCost.toFixed(4)}
              </span>
            </div>
          </div>
        )}
      </div>
    </footer>
  );
}

export default React.memo(TelemetryBar);
