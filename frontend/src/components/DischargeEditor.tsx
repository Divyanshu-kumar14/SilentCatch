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
    <section className="flex min-h-0 flex-col border border-border bg-pane">
      {/* ------------------------------------------------ header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2 overflow-hidden">
          <h2 className="shrink-0 font-mono text-[10px] font-semibold tracking-[0.2em] text-text-dim">
            DISCHARGE PACKET
          </h2>
          <span
            className="truncate rounded-[2px] border border-border bg-pane-raised px-1.5 py-0.5 font-mono text-[9px] text-text-faint"
            title={packet.primary_diagnosis_icd10}
          >
            {packet.primary_diagnosis_icd10}
          </span>
        </div>
        <div className="shrink-0 pl-2">
          {lastResult && (
            <span className="font-mono text-[9px] text-text-faint">
              {lastResult.elapsed}ms · ${lastResult.cost.toFixed(4)}
            </span>
          )}
        </div>
      </header>

      {/* ------------------------------------------------ action button */}
      <div className="shrink-0 border-b border-border bg-pane-raised px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  isRunning
                    ? "bg-live animate-ping"
                    : isIntercept
                      ? "bg-intercept"
                      : isSafe || isPass
                        ? "bg-safe"
                        : "bg-text-faint"
                }`}
              />
              <span className="font-mono text-[11px] font-semibold tracking-wide text-text">
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
            <p className="font-mono text-[9.5px] text-text-faint">
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
            className={`group relative shrink-0 rounded-sm border px-3.5 py-2 font-mono text-[11px] font-semibold tracking-wider transition-all ${
              isRunning
                ? "border-live/40 bg-live/10 text-live cursor-wait"
                : isIntercept
                  ? "border-intercept/60 bg-intercept/10 text-intercept hover:bg-intercept/20"
                  : isSafe || isPass
                    ? "border-safe/60 bg-safe/10 text-safe hover:bg-safe/20"
                    : "border-live/60 bg-live/15 text-live hover:bg-live/25 hover:border-live"
            }`}
          >
            {isRunning ? "AUDITING…" : "Sign & Discharge Patient"}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------ scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="discharge-scroll">
        {/* ----------------- CRITICAL INTERCEPT CARDS (FR-5.2) ----------------- */}
        {isIntercept && (
          <div className="mb-4 flex flex-col gap-2.5">
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
                  className="rounded-sm border border-intercept/70 bg-gradient-to-b from-intercept/15 to-intercept/5 p-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-[2px] bg-intercept px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-bg">
                        {v.severity}
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-intercept">
                        {kindLabel(v.kind)}
                      </span>
                    </div>

                    {guidelineUrl && (
                      <a
                        href={guidelineUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-mono text-[9px] text-live hover:underline"
                        title={guidelineUrl}
                      >
                        <span className="rounded-[2px] border border-live/40 bg-live/10 px-1 py-0.2">
                          Tavily Guideline
                        </span>
                        <span className="max-w-28 truncate">{guidelineUrl.replace(/^https?:\/\//, "")}</span>
                        ↗
                      </a>
                    )}
                  </div>

                  <p className="mt-1.5 text-[11.5px] leading-snug text-text">
                    {v.explanation}
                  </p>

                  <div className="mt-2 rounded-[2px] border border-border-strong bg-bg/80 px-2 py-1.5">
                    <span className="block font-mono text-[8.5px] uppercase tracking-wider text-text-faint">
                      Verified Quote (Span-Guard Match {v.verified_span.start_char}–{v.verified_span.end_char} · {v.verified_span.match_mode})
                    </span>
                    <blockquote className="mt-0.5 font-mono text-[10.5px] text-text-dim">
                      &ldquo;{v.source_quote}&rdquo;
                    </blockquote>
                  </div>

                  {/* Patch preview */}
                  <div className="mt-2.5 rounded-[2px] border border-border bg-pane-raised px-2.5 py-2">
                    <span className="block font-mono text-[8.5px] font-semibold tracking-wider text-text-faint uppercase">
                      Recommended Safe Patch
                    </span>
                    <div className="mt-1 flex flex-col gap-1 font-mono text-[10px]">
                      {patch.remove_drug_name && (
                        <div className="flex items-baseline gap-1 text-intercept">
                          <span>− Discontinue:</span>
                          <span className="font-semibold">{patch.remove_drug_name}</span>
                        </div>
                      )}
                      {patch.add_prescription && (
                        <div className="flex items-baseline gap-1 text-safe">
                          <span>+ Add Rx:</span>
                          <span className="font-semibold">
                            {patch.add_prescription.drug_name} ({patch.add_prescription.dose})
                          </span>
                        </div>
                      )}
                      {patch.add_follow_up_order && (
                        <div className="flex items-baseline gap-1 text-safe">
                          <span>+ Order CPT {patch.add_follow_up_order.cpt_code}:</span>
                          <span className="font-semibold">
                            {patch.add_follow_up_order.reason} ({patch.add_follow_up_order.timeframe})
                          </span>
                        </div>
                      )}
                      {patch.note && (
                        <p className="mt-0.5 text-[9.5px] text-text-dim">
                          Note: {patch.note}
                        </p>
                      )}
                    </div>

                    <div className="mt-2.5 flex items-center justify-end">
                      {isApplied ? (
                        <span className="rounded-sm border border-safe/60 bg-safe/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-safe">
                          ✓ Safe Patch Applied &amp; Re-Verified
                        </span>
                      ) : (
                        <button
                          onClick={() => onApply(v)}
                          disabled={isRunning}
                          className="rounded-sm border border-live bg-live px-3 py-1 font-mono text-[10.5px] font-semibold tracking-wider text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
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
        <div id="rx-anchor" className="mb-4 rounded-sm border border-border bg-pane-raised p-2.5">
          <div className="flex items-center justify-between border-b border-border pb-1.5">
            <h3 className="font-mono text-[9.5px] font-semibold tracking-[0.18em] text-text-dim uppercase">
              Home Medications &amp; Prescriptions
            </h3>
            <span className="font-mono text-[8.5px] text-text-faint">
              {packet.prescriptions.length} order{packet.prescriptions.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="mt-2 flex flex-col gap-1.5">
            {packet.prescriptions.length === 0 ? (
              <p className="font-mono text-[10px] text-text-faint">No prescriptions</p>
            ) : (
              packet.prescriptions.map((rx: Prescription, idx: number) => {
                const isKetorolac = rx.drug_name.toLowerCase().includes("ketorolac") || rx.drug_name.toLowerCase().includes("toradol");
                const isAcetaminophen = rx.drug_name.toLowerCase().includes("acetaminophen");
                return (
                  <div
                    key={idx}
                    className={`flex items-baseline justify-between rounded-[2px] border px-2 py-1.5 font-mono text-[10.5px] transition-colors ${
                      isIntercept && isKetorolac
                        ? "border-intercept/60 bg-intercept/10 text-intercept"
                        : isAcetaminophen
                          ? "border-safe/60 bg-safe/10 text-safe"
                          : "border-border bg-bg/50 text-text"
                    }`}
                  >
                    <div>
                      <span className="font-semibold">{rx.drug_name}</span>
                      <span className="ml-2 text-[9.5px] text-text-dim">{rx.dose}</span>
                      <span className="ml-1 text-[8.5px] text-text-faint">x{rx.days}d</span>
                    </div>
                    <span className="rounded-[2px] border border-border px-1 py-0.2 text-[8px] text-text-faint">
                      {rx.drug_class || rx.class}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ----------------- SECTION: FOLLOW-UP ORDERS (#orders-anchor) ----------------- */}
        <div id="orders-anchor" className="mb-4 rounded-sm border border-border bg-pane-raised p-2.5">
          <div className="flex items-center justify-between border-b border-border pb-1.5">
            <h3 className="font-mono text-[9.5px] font-semibold tracking-[0.18em] text-text-dim uppercase">
              Follow-Up Orders &amp; Closed-Loop Referrals
            </h3>
            <span className="font-mono text-[8.5px] text-text-faint">
              {packet.follow_up_orders.length} order{packet.follow_up_orders.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="mt-2 flex flex-col gap-1.5">
            {packet.follow_up_orders.length === 0 ? (
              <p className="font-mono text-[10px] text-text-faint">No follow-up orders</p>
            ) : (
              packet.follow_up_orders.map((ord: FollowUpOrder, idx: number) => {
                const isCpt71250 = ord.cpt_code.trim() === "71250";
                return (
                  <div
                    key={idx}
                    className={`rounded-[2px] border px-2 py-1.5 font-mono text-[10.5px] ${
                      isCpt71250
                        ? "border-safe/60 bg-safe/10 text-safe"
                        : "border-border bg-bg/50 text-text"
                    }`}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-semibold">{ord.specialty}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-[2px] border border-border px-1 py-0.2 text-[8.5px] text-text-faint">
                          CPT {ord.cpt_code}
                        </span>
                        <span className="text-[9.5px] text-text-dim">{ord.timeframe}</span>
                      </div>
                    </div>
                    <p className="mt-0.5 text-[9.5px] text-text-dim">{ord.reason}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ----------------- SECTION: DISCHARGE INSTRUCTIONS ----------------- */}
        <div className="rounded-sm border border-border bg-pane-raised p-2.5">
          <div className="flex items-center justify-between border-b border-border pb-1.5">
            <h3 className="font-mono text-[9.5px] font-semibold tracking-[0.18em] text-text-dim uppercase">
              Discharge Instructions &amp; Patient Guidance
            </h3>
            <button
              onClick={() => setEditingInstructions(!editingInstructions)}
              className="font-mono text-[8.5px] text-live hover:underline"
            >
              {editingInstructions ? "Done" : "Edit in Sandbox"}
            </button>
          </div>

          {editingInstructions ? (
            <textarea
              value={packet.discharge_instructions}
              onChange={(e) => onEditInstructions(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-sm border border-live/60 bg-bg p-2 font-mono text-[11px] text-text outline-none focus:border-live"
            />
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-text-dim whitespace-pre-wrap">
              {packet.discharge_instructions}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default React.memo(DischargeEditor);
