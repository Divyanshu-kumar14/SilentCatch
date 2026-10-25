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
    <section className="glass-pane flex min-h-0 flex-col rounded-2xl overflow-hidden">
      {/* ------------------------------------------------ header */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <span className="flex h-2 w-2 rounded-full bg-[#3DE0D0] shadow-[0_0_10px_#3DE0D0]" />
          <h2 className="shrink-0 font-mono text-[11px] font-bold tracking-[0.18em] text-[#F4F6FA]">
            DISCHARGE PACKET
          </h2>
          <span
            className="truncate rounded-full bg-white/5 border border-white/10 px-2.5 py-0.5 font-mono text-[9px] font-bold text-[#B9C0CF]"
            title={packet.primary_diagnosis_icd10}
          >
            {packet.primary_diagnosis_icd10}
          </span>
        </div>
        <div className="shrink-0 pl-2">
          {lastResult && (
            <span className="rounded-full bg-white/5 border border-white/8 px-2.5 py-0.5 font-mono text-[9px] text-[#8A93A6]">
              {lastResult.elapsed}ms · ${lastResult.cost.toFixed(4)}
            </span>
          )}
        </div>
      </header>

      {/* ------------------------------------------------ action button */}
      <div className="shrink-0 border-b border-white/10 bg-white/[0.02] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  isRunning
                    ? "bg-[#3DE0D0] animate-ping"
                    : isIntercept
                      ? "bg-[#FF5A5F] shadow-[0_0_12px_#FF5A5F]"
                      : isSafe || isPass
                        ? "bg-[#3DE0D0] shadow-[0_0_12px_#3DE0D0]"
                        : "bg-[#8A93A6]"
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
            <p className="mt-0.5 font-mono text-[9.5px] text-[#8A93A6]">
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
            className={`group relative shrink-0 rounded-xl border px-4 py-2 font-mono text-[11px] font-bold tracking-wider transition-all duration-200 shadow-lg ${
              isRunning
                ? "border-[#3DE0D0]/40 bg-[#3DE0D0]/10 text-[#3DE0D0] cursor-wait"
                : isIntercept
                  ? "border-[#FF5A5F] bg-[#FF5A5F]/20 text-[#FF5A5F] hover:bg-[#FF5A5F]/30 shadow-[0_0_16px_rgba(255,90,95,0.3)]"
                  : isSafe || isPass
                    ? "border-[#3DE0D0] bg-[#3DE0D0]/20 text-[#3DE0D0] hover:bg-[#3DE0D0]/30 shadow-[0_0_16px_rgba(61,224,208,0.3)]"
                    : "border-[#3DE0D0] bg-[#3DE0D0]/20 text-[#3DE0D0] hover:bg-[#3DE0D0]/30 shadow-[0_0_16px_rgba(61,224,208,0.3)]"
            }`}
          >
            {isRunning ? "AUDITING…" : "Sign & Discharge Patient"}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------ scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="discharge-scroll">
        {/* ----------------- CRITICAL INTERCEPT CARDS (FR-5.2) ----------------- */}
        {isIntercept && (
          <div className="mb-4 flex flex-col gap-3.5">
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
                  className="rounded-2xl border border-[#FF5A5F]/80 bg-gradient-to-b from-[#FF5A5F]/25 via-[#0A0D16]/95 to-[#06070C] p-4 shadow-[0_4px_30px_rgba(255,90,95,0.3)]"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[#FF5A5F] px-2.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider text-[#06070C] shadow-md">
                        {v.severity}
                      </span>
                      <span className="font-mono text-[12px] font-bold text-[#FF5A5F]">
                        {kindLabel(v.kind)}
                      </span>
                    </div>

                    {guidelineUrl && (
                      <a
                        href={guidelineUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 font-mono text-[9.5px] font-bold text-[#3DE0D0] hover:underline transition-colors"
                        title={guidelineUrl}
                      >
                        <span className="rounded-full border border-[#3DE0D0]/40 bg-[#3DE0D0]/10 px-2 py-0.5">
                          Tavily Guideline
                        </span>
                        <span className="max-w-28 truncate">{guidelineUrl.replace(/^https?:\/\//, "")}</span>
                        ↗
                      </a>
                    )}
                  </div>

                  <p className="mt-2 text-[12px] leading-relaxed text-[#F4F6FA]">
                    {v.explanation}
                  </p>

                  <div className="mt-2.5 rounded-xl border border-white/10 bg-black/60 p-3">
                    <span className="block font-mono text-[8.5px] font-bold uppercase tracking-wider text-[#8A93A6]">
                      Verified Quote (Span-Guard Match {v.verified_span.start_char}–{v.verified_span.end_char} · {v.verified_span.match_mode})
                    </span>
                    <blockquote className="mt-1 font-mono text-[11px] leading-snug text-[#B9C0CF]">
                      &ldquo;{v.source_quote}&rdquo;
                    </blockquote>
                  </div>

                  {/* Patch preview */}
                  <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
                    <span className="block font-mono text-[9px] font-bold tracking-wider text-[#8A93A6] uppercase">
                      Recommended Safe Patch
                    </span>
                    <div className="mt-1.5 flex flex-col gap-1.5 font-mono text-[11px]">
                      {patch.remove_drug_name && (
                        <div className="flex items-baseline gap-1.5 text-[#FF5A5F]">
                          <span>− Discontinue:</span>
                          <span className="font-bold underline">{patch.remove_drug_name}</span>
                        </div>
                      )}
                      {patch.add_prescription && (
                        <div className="flex items-baseline gap-1.5 text-[#3DE0D0]">
                          <span>+ Add Rx:</span>
                          <span className="font-bold">
                            {patch.add_prescription.drug_name} ({patch.add_prescription.dose})
                          </span>
                        </div>
                      )}
                      {patch.add_follow_up_order && (
                        <div className="flex items-baseline gap-1.5 text-[#3DE0D0]">
                          <span>+ Order CPT {patch.add_follow_up_order.cpt_code}:</span>
                          <span className="font-bold">
                            {patch.add_follow_up_order.reason} ({patch.add_follow_up_order.timeframe})
                          </span>
                        </div>
                      )}
                      {patch.note && (
                        <p className="mt-1 text-[10px] text-[#8A93A6]">
                          Note: {patch.note}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-end">
                      {isApplied ? (
                        <span className="rounded-xl border border-[#3DE0D0]/80 bg-[#3DE0D0]/15 px-3 py-1 font-mono text-[10px] font-bold text-[#3DE0D0]">
                          ✓ Safe Patch Applied &amp; Re-Verified
                        </span>
                      ) : (
                        <button
                          onClick={() => onApply(v)}
                          disabled={isRunning}
                          className="rounded-xl border border-[#3DE0D0] bg-[#3DE0D0] hover:bg-[#3DE0D0]/90 px-4 py-1.5 font-mono text-[11px] font-bold tracking-wider text-[#06070C] shadow-[0_0_18px_rgba(61,224,208,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
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
        <div id="rx-anchor" className="mb-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3.5">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <h3 className="font-mono text-[10px] font-bold tracking-[0.18em] text-[#8A93A6] uppercase">
              Home Medications &amp; Prescriptions
            </h3>
            <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[8.5px] font-bold text-[#8A93A6] border border-white/8">
              {packet.prescriptions.length} order{packet.prescriptions.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="mt-2.5 flex flex-col gap-2">
            {packet.prescriptions.length === 0 ? (
              <p className="font-mono text-[10px] text-[#8A93A6]">No prescriptions</p>
            ) : (
              packet.prescriptions.map((rx: Prescription, idx: number) => {
                const isKetorolac = rx.drug_name.toLowerCase().includes("ketorolac") || rx.drug_name.toLowerCase().includes("toradol");
                const isAcetaminophen = rx.drug_name.toLowerCase().includes("acetaminophen");
                return (
                  <div
                    key={idx}
                    className={`flex items-baseline justify-between rounded-xl border px-3 py-2 font-mono text-[11px] transition-colors ${
                      isIntercept && isKetorolac
                        ? "border-[#FF5A5F]/80 bg-[#FF5A5F]/15 text-[#FF5A5F] shadow-[0_0_14px_rgba(255,90,95,0.3)]"
                        : isAcetaminophen
                          ? "border-[#3DE0D0]/80 bg-[#3DE0D0]/15 text-[#3DE0D0]"
                          : "border-white/8 bg-black/40 text-[#F4F6FA]"
                    }`}
                  >
                    <div>
                      <span className="font-bold">{rx.drug_name}</span>
                      <span className="ml-2 text-[10px] text-[#B9C0CF]">{rx.dose}</span>
                      <span className="ml-1 text-[9px] text-[#8A93A6]">x{rx.days}d</span>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[8.5px] text-[#8A93A6]">
                      {rx.drug_class || rx.class}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ----------------- SECTION: FOLLOW-UP ORDERS (#orders-anchor) ----------------- */}
        <div id="orders-anchor" className="mb-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3.5">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <h3 className="font-mono text-[10px] font-bold tracking-[0.18em] text-[#8A93A6] uppercase">
              Follow-Up Orders &amp; Closed-Loop Referrals
            </h3>
            <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[8.5px] font-bold text-[#8A93A6] border border-white/8">
              {packet.follow_up_orders.length} order{packet.follow_up_orders.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="mt-2.5 flex flex-col gap-2">
            {packet.follow_up_orders.length === 0 ? (
              <p className="font-mono text-[10px] text-[#8A93A6]">No follow-up orders</p>
            ) : (
              packet.follow_up_orders.map((ord: FollowUpOrder, idx: number) => {
                const isCpt71250 = ord.cpt_code.trim() === "71250";
                return (
                  <div
                    key={idx}
                    className={`rounded-xl border px-3 py-2 font-mono text-[11px] ${
                      isCpt71250
                        ? "border-[#3DE0D0]/80 bg-[#3DE0D0]/15 text-[#3DE0D0] shadow-[0_0_14px_rgba(61,224,208,0.3)]"
                        : "border-white/8 bg-black/40 text-[#F4F6FA]"
                    }`}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-bold">{ord.specialty}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] text-[#F4F6FA]">
                          CPT {ord.cpt_code}
                        </span>
                        <span className="text-[10px] text-[#B9C0CF]">{ord.timeframe}</span>
                      </div>
                    </div>
                    <p className="mt-1 text-[10px] text-[#8A93A6]">{ord.reason}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ----------------- SECTION: DISCHARGE INSTRUCTIONS ----------------- */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <h3 className="font-mono text-[10px] font-bold tracking-[0.18em] text-[#8A93A6] uppercase">
              Discharge Instructions &amp; Patient Guidance
            </h3>
            <button
              onClick={() => setEditingInstructions(!editingInstructions)}
              className="font-mono text-[9px] font-bold text-[#3DE0D0] hover:underline transition-colors"
            >
              {editingInstructions ? "Done Editing" : "Edit in Sandbox"}
            </button>
          </div>

          {editingInstructions ? (
            <textarea
              value={packet.discharge_instructions}
              onChange={(e) => onEditInstructions(e.target.value)}
              rows={4}
              className="mt-2.5 w-full rounded-xl border border-[#3DE0D0]/60 bg-[#06070C] p-3 font-mono text-[11px] text-[#F4F6FA] outline-none focus:border-[#3DE0D0] focus:ring-1 focus:ring-[#3DE0D0]/50"
            />
          ) : (
            <p className="mt-2 text-[11.5px] leading-relaxed text-[#B9C0CF] whitespace-pre-wrap">
              {packet.discharge_instructions}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default React.memo(DischargeEditor);
