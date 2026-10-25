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
    <footer className="flex h-11 shrink-0 items-center justify-between border-t border-white/10 bg-[#0A0D16]/95 px-4 font-mono text-[10px] backdrop-blur-xl">
      {/* ---------------- 4 pipeline stages ---------------- */}
      <div className="flex items-center gap-2">
        {STAGE_CONFIG.map((cfg) => {
          const trace = traces.find((t) => t.stage === cfg.id);
          const isActive = activeStage === cfg.id;
          const isDone = Boolean(trace);

          return (
            <div
              key={cfg.id}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1 transition-all duration-200 ${
                isActive
                  ? "border-[#3DE0D0] bg-[#3DE0D0]/20 text-[#3DE0D0] shadow-[0_0_14px_rgba(61,224,208,0.35)]"
                  : isDone
                    ? "border-white/12 bg-white/[0.04] text-[#F4F6FA]"
                    : "border-white/6 bg-white/[0.015] text-[#8A93A6]"
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  isActive
                    ? "bg-[#3DE0D0] animate-ping"
                    : isDone
                      ? "bg-[#3DE0D0] shadow-[0_0_8px_#3DE0D0]"
                      : "bg-[#8A93A6]/40"
                }`}
              />
              <span className="font-bold">{cfg.label}</span>

              {trace ? (
                <div className="flex items-center gap-1.5 text-[9px] text-[#8A93A6]">
                  {trace.model_id && (
                    <span className="text-[#8A93A6]">{shortModel(trace.model_id)}</span>
                  )}
                  <span className="text-[#F4F6FA] font-bold">{trace.latency_ms}ms</span>
                  {trace.prompt_tokens > 0 && (
                    <span className="text-[#8A93A6]">
                      {trace.prompt_tokens + trace.completion_tokens}tok
                    </span>
                  )}
                  {trace.replayed && (
                    <span className="rounded-full bg-[#FFB84D]/15 border border-[#FFB84D]/40 px-1.5 text-[8px] font-bold text-[#FFB84D]">
                      REPLAY
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-[9px] text-[#8A93A6]">{cfg.role}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------- right totals & spend ---------------- */}
      <div className="flex items-center gap-4 text-[10px]">
        {_runStart?.mode_note && (
          <span className="text-[9px] text-[#8A93A6] max-w-36 truncate" title={_runStart.mode_note}>
            {_runStart.mode_note}
          </span>
        )}
        {isRunning && (
          <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-[#3DE0D0] animate-pulse">
            <span className="h-2 w-2 rounded-full bg-[#3DE0D0] animate-ping" />
            STREAMING PIPELINE…
          </span>
        )}
        {traces.length > 0 && (
          <>
            <div className="flex items-center gap-1 text-[#8A93A6]">
              <span>Latency:</span>
              <span className="font-bold text-[#F4F6FA]">{totalLatency}ms</span>
            </div>

            <div className="flex items-center gap-1 text-[#8A93A6]">
              <span>Tokens:</span>
              <span className="font-bold text-[#F4F6FA]">{totalTokens}</span>
            </div>

            <div className="flex items-center gap-1 text-[#8A93A6]">
              <span>Audit Cost:</span>
              <span className={`font-bold ${totalCost > 0 ? "text-[#3DE0D0]" : "text-[#F4F6FA]"}`}>
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
