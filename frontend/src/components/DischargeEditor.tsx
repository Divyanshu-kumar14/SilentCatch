"use client";

import React, { useState } from "react";

import { kindLabel, patchKey } from "@/lib/clinical";
import type {
  DischargePacket,
  Encounter,
  FollowUpOrder,
  Guideline,
  InterceptionVerdict,
  Phase,
  Prescription,
} from "@/lib/types";

function DischargeEditor({
  encounter,
  phase,
  verdicts,
  guides,
  applied,
  lastResult,
  onApply,
  onEditInstructions,
  onRun,
}: {
  encounter: Encounter;
  phase: Phase;
  verdicts: InterceptionVerdict[];
  guides: Guideline[];
  applied: Set<string>;
  lastResult: { elapsed: number; cost: number } | null;
  onApply: (verdict: InterceptionVerdict) => void;
  onEditInstructions: (text: string) => void;
  onRun: () => void;
}) {
  const [editingInstructions, setEditingInstructions] = useState(false);
  const packet: DischargePacket = encounter.draft_discharge_packet;
  const isRunning = phase === "running";
  const isIntercept = phase === "intercept" && verdicts.length > 0;
  const isSafe = phase === "safe";
  const isPass = phase === "pass";

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-slate-950/80 backdrop-blur-md shadow-2xl overflow-hidden">
      {/* ------------------------------------------------ header */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/60 px-3.5 py-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="flex h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
          <h2 className="shrink-0 font-mono text-[11px] font-bold tracking-[0.16em] text-slate-200">
            DISCHARGE PACKET
          </h2>
          <span
            className="truncate rounded bg-slate-800/80 border border-white/10 px-2 py-0.5 font-mono text-[9.5px] font-medium text-slate-300"
            title={packet.primary_diagnosis_icd10}
          >
            {packet.primary_diagnosis_icd10}
          </span>
        </div>
        <div className="shrink-0 pl-2">
          {lastResult && (
            <span className="rounded bg-slate-900/90 border border-white/5 px-2 py-0.5 font-mono text-[9px] text-slate-400">
              {lastResult.elapsed}ms · ${lastResult.cost.toFixed(4)}
            </span>
          )}
        </div>
      </header>

      {/* ------------------------------------------------ action button */}
      <div className="shrink-0 border-b border-white/10 bg-slate-900/40 px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  isRunning
                    ? "bg-sky-400 animate-ping"
                    : isIntercept
                      ? "bg-rose-500 shadow-[0_0_10px_#f43f5e]"
                      : isSafe || isPass
                        ? "bg-emerald-400 shadow-[0_0_10px_#10b981]"
                        : "bg-slate-500"
                }`}
              />
              <span className="font-mono text-[11.5px] font-bold tracking-wide text-white">
                {isRunning
                  ? "RUNNING FLIGHT-CHECK INTERLOCK…"
                  : isIntercept
                    ? "SAFETY INTERLOCK: CRITICAL INTERCEPT"
                    : isSafe
                      ? "VERIFIED SAFE · DISCHARGE AUTHORIZED"
                      : isPass
                        ? "FLIGHT-CHECK CLEAR · SILENT PASS"
                        : "PENDING CLINICAL SIGN-OFF"}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[10px] text-slate-400">
              {isRunning
                ? "Streaming multi-stage audit via Nebius Token Factory & Tavily"
                : isIntercept
                  ? `${verdicts.length} cross-modal contradiction${verdicts.length > 1 ? "s" : ""} detected before sign-off`
                  : isSafe
                    ? "Patched packet re-audited clean in <1s (loop closed)"
                    : "Zero-latency pass: no unaddressed findings or kinetic collisions"}
            </p>
          </div>

          <button
            onClick={onRun}
            disabled={isRunning}
            data-testid="sign-discharge-btn"
            className={`group relative shrink-0 rounded-lg border px-4 py-2 font-mono text-[11px] font-bold tracking-wider transition-all duration-200 shadow-md ${
              isRunning
                ? "border-sky-500/40 bg-sky-500/15 text-sky-300 cursor-wait"
                : isIntercept
                  ? "border-rose-500/80 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 hover:border-rose-400"
                  : isSafe || isPass
                    ? "border-emerald-500/80 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 hover:border-emerald-400"
                    : "border-sky-500/80 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 hover:border-sky-400"
            }`}
          >
            {isRunning ? "AUDITING…" : "Sign & Discharge Patient"}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------ scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5" data-testid="discharge-scroll">
        {/* ----------------- CRITICAL INTERCEPT CARDS (FR-5.2) ----------------- */}
        {isIntercept && (
          <div className="mb-4 flex flex-col gap-3">
            {verdicts.map((v, i) => {
              const key = patchKey(v);
              const isApplied = applied.has(key);
              const patch = v.discharge_patch;
              const matchingGuide = guides.find((g) =>
                v.guideline_url ? g.url === v.guideline_url : true
              );
              const guidelineUrl = v.guideline_url ?? matchingGuide?.url;

              return (
                <article
                  key={i}
                  className="rounded-xl border border-rose-500/70 bg-gradient-to-b from-rose-950/40 via-slate-900/80 to-slate-950/90 p-3.5 shadow-[0_4px_24px_rgba(244,63,94,0.18)]"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-rose-500 px-2 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider text-slate-950 shadow-sm">
                        {v.severity}
                      </span>
                      <span className="font-mono text-[11.5px] font-bold text-rose-300">
                        {kindLabel(v.kind)}
                      </span>
                    </div>

                    {guidelineUrl && (
                      <a
                        href={guidelineUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 font-mono text-[9px] font-medium text-sky-400 hover:text-sky-300 transition-colors"
                        title={guidelineUrl}
                      >
                        <span className="rounded border border-sky-400/40 bg-sky-500/10 px-1.5 py-0.5">
                          Tavily Guideline
                        </span>
                        <span className="max-w-28 truncate">{guidelineUrl.replace(/^https?:\/\//, "")}</span>
                        ↗
                      </a>
                    )}
                  </div>

                  <p className="mt-2 text-[12px] leading-relaxed text-slate-200">
                    {v.explanation}
                  </p>

                  <div className="mt-2.5 rounded-lg border border-white/10 bg-black/60 p-2.5">
                    <span className="block font-mono text-[8.5px] font-bold uppercase tracking-wider text-slate-400">
                      Verified Quote (Span-Guard Match {v.verified_span.start_char}–{v.verified_span.end_char} · {v.verified_span.match_mode})
                    </span>
                    <blockquote className="mt-1 font-mono text-[11px] leading-snug text-slate-300">
                      &ldquo;{v.source_quote}&rdquo;
                    </blockquote>
                  </div>

                  {/* Patch preview */}
                  <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/80 p-3">
                    <span className="block font-mono text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                      Recommended Safe Patch
                    </span>
                    <div className="mt-1.5 flex flex-col gap-1.5 font-mono text-[10.5px]">
                      {patch.remove_drug_name && (
                        <div className="flex items-baseline gap-1.5 text-rose-400">
                          <span>− Discontinue:</span>
                          <span className="font-bold underline">{patch.remove_drug_name}</span>
                        </div>
                      )}
                      {patch.add_prescription && (
                        <div className="flex items-baseline gap-1.5 text-emerald-400">
                          <span>+ Add Rx:</span>
                          <span className="font-bold">
                            {patch.add_prescription.drug_name} ({patch.add_prescription.dose})
                          </span>
                        </div>
                      )}
                      {patch.add_follow_up_order && (
                        <div className="flex items-baseline gap-1.5 text-emerald-400">
                          <span>+ Order CPT {patch.add_follow_up_order.cpt_code}:</span>
                          <span className="font-bold">
                            {patch.add_follow_up_order.reason} ({patch.add_follow_up_order.timeframe})
                          </span>
                        </div>
                      )}
                      {patch.note && (
                        <p className="mt-1 text-[10px] text-slate-400">
                          Note: {patch.note}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-end">
                      {isApplied ? (
                        <span className="rounded-lg border border-emerald-500/60 bg-emerald-500/15 px-3 py-1 font-mono text-[10px] font-bold text-emerald-300">
                          ✓ Safe Patch Applied &amp; Re-Verified
                        </span>
                      ) : (
                        <button
                          onClick={() => onApply(v)}
                          disabled={isRunning}
                          className="rounded-lg border border-sky-400 bg-sky-500 hover:bg-sky-400 px-3.5 py-1.5 font-mono text-[11px] font-bold tracking-wider text-slate-950 shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                        >
                          Apply Safe Patch &amp; Re-Verify
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* ----------------- SECTION: HOME MEDICATIONS (#rx-anchor) ----------------- */}
        <div id="rx-anchor" className="mb-4 rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <h3 className="font-mono text-[10px] font-bold tracking-[0.16em] text-slate-400 uppercase">
              Home Medications &amp; Prescriptions
            </h3>
            <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[8.5px] font-medium text-slate-400 border border-white/5">
              {packet.prescriptions.length} order{packet.prescriptions.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="mt-2.5 flex flex-col gap-2">
            {packet.prescriptions.length === 0 ? (
              <p className="font-mono text-[10px] text-slate-500">No prescriptions</p>
            ) : (
              packet.prescriptions.map((rx: Prescription, idx: number) => {
                const isKetorolac = rx.drug_name.toLowerCase().includes("ketorolac") || rx.drug_name.toLowerCase().includes("toradol");
                const isAcetaminophen = rx.drug_name.toLowerCase().includes("acetaminophen");
                return (
                  <div
                    key={idx}
                    className={`flex items-baseline justify-between rounded-lg border px-3 py-2 font-mono text-[11px] transition-colors ${
                      isIntercept && isKetorolac
                        ? "border-rose-500/70 bg-rose-950/40 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.2)]"
                        : isAcetaminophen
                          ? "border-emerald-500/70 bg-emerald-950/40 text-emerald-300"
                          : "border-white/5 bg-slate-950/60 text-slate-200"
                    }`}
                  >
                    <div>
                      <span className="font-bold">{rx.drug_name}</span>
                      <span className="ml-2 text-[10px] text-slate-400">{rx.dose}</span>
                      <span className="ml-1 text-[9px] text-slate-500">x{rx.days}d</span>
                    </div>
                    <span className="rounded border border-white/10 bg-slate-900/80 px-1.5 py-0.5 text-[8.5px] text-slate-400">
                      {rx.drug_class || rx.class}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ----------------- SECTION: FOLLOW-UP ORDERS (#orders-anchor) ----------------- */}
        <div id="orders-anchor" className="mb-4 rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <h3 className="font-mono text-[10px] font-bold tracking-[0.16em] text-slate-400 uppercase">
              Follow-Up Orders &amp; Closed-Loop Referrals
            </h3>
            <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[8.5px] font-medium text-slate-400 border border-white/5">
              {packet.follow_up_orders.length} order{packet.follow_up_orders.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="mt-2.5 flex flex-col gap-2">
            {packet.follow_up_orders.length === 0 ? (
              <p className="font-mono text-[10px] text-slate-500">No follow-up orders</p>
            ) : (
              packet.follow_up_orders.map((ord: FollowUpOrder, idx: number) => {
                const isCpt71250 = ord.cpt_code.trim() === "71250";
                return (
                  <div
                    key={idx}
                    className={`rounded-lg border px-3 py-2 font-mono text-[11px] ${
                      isCpt71250
                        ? "border-emerald-500/70 bg-emerald-950/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                        : "border-white/5 bg-slate-950/60 text-slate-200"
                    }`}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-bold">{ord.specialty}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded border border-white/10 bg-slate-900/80 px-1.5 py-0.5 text-[9px] text-slate-300">
                          CPT {ord.cpt_code}
                        </span>
                        <span className="text-[10px] text-slate-400">{ord.timeframe}</span>
                      </div>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">{ord.reason}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ----------------- SECTION: DISCHARGE INSTRUCTIONS ----------------- */}
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <h3 className="font-mono text-[10px] font-bold tracking-[0.16em] text-slate-400 uppercase">
              Discharge Instructions &amp; Patient Guidance
            </h3>
            <button
              onClick={() => setEditingInstructions(!editingInstructions)}
              className="font-mono text-[9px] font-semibold text-sky-400 hover:text-sky-300 transition-colors"
            >
              {editingInstructions ? "Done Editing" : "Edit in Sandbox"}
            </button>
          </div>

          {editingInstructions ? (
            <textarea
              value={packet.discharge_instructions}
              onChange={(e) => onEditInstructions(e.target.value)}
              rows={4}
              className="mt-2.5 w-full rounded-lg border border-sky-500/50 bg-slate-950/90 p-2.5 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/40"
            />
          ) : (
            <p className="mt-2 text-[11.5px] leading-relaxed text-slate-300 whitespace-pre-wrap">
              {packet.discharge_instructions}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default React.memo(DischargeEditor);
