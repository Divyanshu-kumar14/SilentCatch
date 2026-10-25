"use client";

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

export default function TelemetryBar({
  phase,
  runStart,
  traces,
  activeStage,
}: {
  phase: Phase;
  runStart: RunStartEvent | null;
  traces: StageTrace[];
  activeStage: string | null;
}) {
  const isRunning = phase === "running";

  // Aggregate totals
  const totalLatency = traces.reduce((acc, t) => acc + (t.latency_ms || 0), 0);
  const totalPromptTokens = traces.reduce((acc, t) => acc + (t.prompt_tokens || 0), 0);
  const totalCompTokens = traces.reduce((acc, t) => acc + (t.completion_tokens || 0), 0);
  const totalCost = traces.reduce((acc, t) => acc + (t.est_cost_usd || 0), 0);

  return (
    <footer className="flex h-11 shrink-0 items-center justify-between border-t border-border bg-pane px-3 font-mono text-[10px]">
      {/* ---------------- 4 pipeline stages ---------------- */}
      <div className="flex items-center gap-2">
        {STAGE_CONFIG.map((cfg) => {
          const trace = traces.find((t) => t.stage === cfg.id);
          const isActive = activeStage === cfg.id;
          const isDone = Boolean(trace);

          return (
            <div
              key={cfg.id}
              className={`flex items-center gap-1.5 rounded-sm border px-2 py-0.5 transition-colors ${
                isActive
                  ? "border-live/60 bg-live/15 text-live"
                  : isDone
                    ? "border-border-strong bg-pane-raised text-text"
                    : "border-border/40 bg-bg/50 text-text-faint"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  isActive
                    ? "bg-live animate-ping"
                    : isDone
                      ? "bg-safe"
                      : "bg-text-faint/50"
                }`}
              />
              <span className="font-semibold">{cfg.label}</span>

              {trace ? (
                <div className="flex items-center gap-1 text-[9px] text-text-dim">
                  {trace.model_id && (
                    <span className="text-text-faint">{shortModel(trace.model_id)}</span>
                  )}
                  <span>{trace.latency_ms}ms</span>
                  {trace.prompt_tokens > 0 && (
                    <span className="text-text-faint">
                      {trace.prompt_tokens + trace.completion_tokens}tok
                    </span>
                  )}
                  {trace.replayed && (
                    <span className="rounded-[2px] border border-warn/30 bg-warn/10 px-0.5 text-[8px] text-warn">
                      REPLAY
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-[9px] text-text-faint">{cfg.role}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------- right totals & spend ---------------- */}
      <div className="flex items-center gap-3 text-[10px]">
        {isRunning && (
          <span className="animate-pulse font-mono text-[9.5px] text-live">
            ● STREAMING PIPELINE…
          </span>
        )}
        {traces.length > 0 && (
          <>
            <div className="flex items-center gap-1 text-text-dim">
              <span className="text-text-faint">Latency:</span>
              <span className="text-text font-semibold">{totalLatency}ms</span>
            </div>

            <div className="flex items-center gap-1 text-text-dim">
              <span className="text-text-faint">Tokens:</span>
              <span className="text-text font-semibold">
                {totalPromptTokens + totalCompTokens}
              </span>
            </div>

            <div className="flex items-center gap-1 text-text-dim">
              <span className="text-text-faint">Audit Cost:</span>
              <span className={`font-semibold ${totalCost > 0 ? "text-live" : "text-text"}`}>
                ${totalCost.toFixed(4)}
              </span>
            </div>
          </>
        )}

        {runStart && (
          <div className="flex items-center gap-1 rounded-[2px] border border-border bg-bg/80 px-1.5 py-0.5 text-text-dim">
            <span className="text-text-faint">Daily Ledger:</span>
            <span className="text-text">${runStart.daily_spend_usd.toFixed(4)} / $2.00</span>
          </div>
        )}
      </div>
    </footer>
  );
}
