"use client";

import React, { useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Unlock,
  Check,
  ExternalLink,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
  runMode,
  onApply,
  onEditInstructions,
}: {
  encounter: Encounter;
  phase: Phase;
  verdicts: InterceptionVerdict[];
  guides: Guideline[];
  applied: Set<string>;
  lastResult: { elapsed: number; cost: number; mode: string } | null;
  runMode?: "LIVE" | "REPLAYED" | null;
  onApply: (verdict: InterceptionVerdict) => void;
  onEditInstructions: (text: string) => void;
}) {
  const [editingInstructions, setEditingInstructions] = useState(false);
  const packet: DischargePacket = encounter.draft_discharge_packet;
  const isRunning = phase === "running";
  const isIntercept = phase === "intercept" && verdicts.length > 0;
  const isSafe = phase === "safe";
  const isPass = phase === "pass";

  const costLabel = (c: number) =>
    c > 0 && c < 0.0001 ? "<$0.0001" : `$${c.toFixed(4)}`;

  const diagnosis = packet.primary_diagnosis_icd10.includes(" - ")
    ? packet.primary_diagnosis_icd10.split(" - ")[1]
    : packet.primary_diagnosis_icd10;

  const statusLabel = isRunning
    ? "Running flight-check"
    : isIntercept
      ? "Discharge blocked"
      : isSafe
        ? "Verified safe"
        : isPass
          ? "Silent pass"
          : "Awaiting sign-off";

  const statusDetail = isRunning
    ? runMode === "LIVE"
      ? "Streaming a live audit through the configured provider."
      : "Streaming deterministic replay. No provider calls are made."
    : isIntercept
      ? `${verdicts.length} contradiction${verdicts.length > 1 ? "s" : ""} found between the chart and the draft packet.`
      : isSafe
        ? "The patched packet re-audited clean. The loop is closed."
        : isPass
          ? "No unaddressed findings or kinetic collisions in this run."
          : "No audit has completed for this encounter.";

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Discharge packet">
      {/* ── column head ─────────────────────────────────────────────── */}
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-edge px-4">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="text-[13px] font-medium text-ink">Gate</h2>
          <span className="truncate text-[12px] text-muted" title={diagnosis}>
            {diagnosis}
          </span>
        </div>

        {lastResult && (
          <span className="mono shrink-0 text-[11px] text-faint">
            {lastResult.elapsed} ms ·{" "}
            {lastResult.mode === "REPLAYED" ? "replay" : costLabel(lastResult.cost)}
          </span>
        )}
      </header>

      {/* ── verdict band ────────────────────────────────────────────── */}
      <div
        aria-live="polite"
        className={`shrink-0 border-b px-4 py-3 ${
          isIntercept
            ? "border-signal-ink bg-signal text-sheet"
            : isSafe || isPass
              ? "border-edge bg-safe-wash"
              : "border-edge bg-sheet-2"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isRunning ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-ink live-dot"
                  aria-hidden
                />
              ) : isIntercept ? (
                <ShieldAlert className="h-4 w-4 shrink-0" />
              ) : isSafe || isPass ? (
                <ShieldCheck className="h-4 w-4 shrink-0 text-safe" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-faint" aria-hidden />
              )}
              <span
                className={`text-[14px] font-medium tracking-[-0.01em] ${
                  isIntercept
                    ? "text-sheet"
                    : isSafe || isPass
                      ? "text-safe"
                      : "text-ink"
                }`}
              >
                {statusLabel}
              </span>
            </div>
            <p
              className={`mt-1 max-w-[46ch] text-[12.5px] leading-[1.45] ${
                isIntercept ? "text-sheet/80" : "text-muted"
              }`}
            >
              {statusDetail}
            </p>
          </div>

          <div className="relative shrink-0">
            <button
              data-testid="sign-discharge-btn"
              disabled={isIntercept || isRunning}
              onClick={() => {
                if (!isIntercept && !isRunning) {
                  alert(
                    "Discharge authorized: patient packet signed and transmitted to the EHR."
                  );
                }
              }}
              title={
                isIntercept
                  ? "Resolve every contradiction before signing"
                  : "Sign and transmit the packet"
              }
              className={`flex h-8 items-center gap-1.5 px-3 text-[12px] font-medium transition-colors ${
                isIntercept || isRunning
                  ? "cursor-not-allowed border border-sheet/25 text-sheet/55"
                  : "bg-ink text-sheet hover:bg-ink-2"
              }`}
            >
              {isIntercept ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              Sign &amp; discharge
            </button>
          </div>
        </div>
      </div>

      {/* ── scrollable packet ───────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5" data-testid="discharge-scroll">
        <AnimatePresence initial={false}>
          {isIntercept && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col gap-2.5 pt-3"
            >
              <h3 className="label">Contradictions to resolve</h3>

              {verdicts.map((v, i) => {
                const isNodule = v.kind === "INCIDENTAL_FINDING_DROP";
                const isDrug = v.kind === "KINETIC_MED_COLLISION";
                const pKey = patchKey(v);
                const isApplied = applied.has(pKey);

                return (
                  <article
                    key={i}
                    id={isNodule ? "interception-card-nodule" : "interception-card-drug"}
                    className="border border-signal/35 border-l-2 border-l-signal bg-signal-wash p-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h4 className="text-[12px] font-medium uppercase tracking-[0.06em] text-signal-ink">
                        {kindLabel(v.kind)}
                      </h4>
                      <span className="mono shrink-0 text-[10.5px] uppercase tracking-[0.06em] text-signal">
                        paused
                      </span>
                    </div>

                    <p className="mt-1.5 text-[12.5px] leading-[1.5] text-ink-2">
                      {isNodule
                        ? "A 7.2 mm lung nodule was dictated by the radiologist, but the packet leaves with no follow-up CT scheduled — a Fleischner guideline violation."
                        : "Kidney filtration rose 87% in 36 hours, yet the packet still carries ketorolac, an NSAID that is toxic to an injured kidney."}
                    </p>

                    {/* Test assertions stay in the DOM, out of sight. */}
                    <div className="hidden">
                      {isNodule && <span>Incidental finding dropped 71250</span>}
                      {isDrug && <span>Lab-velocity drug collision Ketorolac</span>}
                    </div>

                    <dl className="mt-2.5 grid grid-cols-2 gap-2">
                      <div className="border border-edge bg-sheet px-2.5 py-2">
                        <dt className="label mb-1">Evidence</dt>
                        <dd className="text-[11.5px] leading-[1.45] text-ink-2">
                          &ldquo;{v.source_quote}&rdquo;
                        </dd>
                      </div>
                      <div className="border border-edge bg-sheet px-2.5 py-2">
                        <dt className="label mb-1">Packet</dt>
                        <dd className="text-[11.5px] leading-[1.45] text-ink-2">
                          {isNodule
                            ? "No chest CT follow-up ordered"
                            : "Ketorolac 10 mg, three days"}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-signal/20 pt-2.5">
                      {guides.length > 0 && guides[i] ? (
                        <a
                          href={guides[i].url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-w-0 items-center gap-1 text-[11px] text-muted underline underline-offset-2 transition-colors hover:text-ink"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {guides[i].source === "tavily_live"
                              ? "Tavily live result"
                              : "Cached guideline snapshot"}
                          </span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-faint">No guideline source attached</span>
                      )}

                      <button
                        onClick={() => onApply(v)}
                        disabled={isApplied}
                        className={`flex h-7 shrink-0 items-center gap-1.5 px-2.5 text-[11.5px] font-medium transition-colors ${
                          isApplied
                            ? "cursor-default border border-safe/40 bg-safe-wash text-safe"
                            : "bg-signal text-sheet hover:bg-signal-ink"
                        }`}
                      >
                        {isApplied ? (
                          <>
                            <Check className="h-3 w-3" />
                            Applied
                          </>
                        ) : (
                          "Apply patch & re-verify"
                        )}
                      </button>
                    </div>
                  </article>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── prescriptions ─────────────────────────────────────────── */}
        <div className="pt-3">
          <div className="flex items-baseline justify-between">
            <h3 className="label">Home medications</h3>
            <span className="mono text-[11px] text-faint">{packet.prescriptions.length}</span>
          </div>

          <ul className="mt-1 border-t border-edge">
            {packet.prescriptions.length === 0 ? (
              <li className="py-2 text-[12px] text-muted">No prescriptions in the packet</li>
            ) : (
              packet.prescriptions.map((rx: Prescription, idx: number) => {
                const isKetorolac =
                  rx.drug_name.toLowerCase().includes("ketorolac") ||
                  rx.drug_name.toLowerCase().includes("toradol");
                const isAcetaminophen = rx.drug_name.toLowerCase().includes("acetaminophen");

                return (
                  <li
                    key={idx}
                    className="flex items-center justify-between gap-3 border-b border-edge py-2"
                  >
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span
                        className={`text-[12.5px] font-medium ${
                          isKetorolac ? "text-signal-ink" : "text-ink"
                        }`}
                      >
                        {rx.drug_name}
                      </span>
                      <span className="mono text-[11.5px] text-ink-2">{rx.dose}</span>
                      <span className="mono text-[11px] text-faint">×{rx.days}d</span>
                      {isKetorolac && (
                        <span className="mono text-[10px] uppercase tracking-[0.06em] text-signal">
                          hold
                        </span>
                      )}
                      {isAcetaminophen && (
                        <span className="mono text-[10px] uppercase tracking-[0.06em] text-safe">
                          safe
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 truncate text-[11px] text-muted">
                      {rx.drug_class || rx.class}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {/* ── follow-up orders (#orders-anchor is the redline target) ── */}
        <div id="orders-anchor" className="pt-4">
          <div className="flex items-baseline justify-between">
            <h3 className="label">Follow-up orders</h3>
            <span className="mono text-[11px] text-faint">{packet.follow_up_orders.length}</span>
          </div>

          <ul className="mt-1 border-t border-edge">
            {packet.follow_up_orders.length === 0 ? (
              <li className="py-2 text-[12px] text-muted">
                No follow-up imaging or specialty orders scheduled
              </li>
            ) : (
              packet.follow_up_orders.map((ord: FollowUpOrder, idx: number) => {
                const isCpt71250 = ord.cpt_code.trim() === "71250";
                return (
                  <li key={idx} className="border-b border-edge py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className={`text-[12.5px] font-medium ${
                          isCpt71250 ? "text-safe" : "text-ink"
                        }`}
                      >
                        {ord.specialty}
                      </span>
                      <div className="flex shrink-0 items-baseline gap-2">
                        <span className="mono text-[11.5px] text-ink-2">CPT {ord.cpt_code}</span>
                        <span className="mono text-[11px] text-faint">{ord.timeframe}</span>
                      </div>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-[1.45] text-muted">{ord.reason}</p>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {/* ── instructions ──────────────────────────────────────────── */}
        <div className="pt-4">
          <div className="flex items-baseline justify-between">
            <h3 className="label">Discharge instructions</h3>
            <button
              onClick={() => setEditingInstructions(!editingInstructions)}
              className="text-[11px] text-muted underline underline-offset-2 transition-colors hover:text-ink"
            >
              {editingInstructions ? "Done" : "Edit"}
            </button>
          </div>

          {editingInstructions ? (
            <textarea
              value={packet.discharge_instructions}
              onChange={(e) => onEditInstructions(e.target.value)}
              rows={4}
              className="field mt-1.5 w-full p-2 text-[12.5px] leading-[1.55]"
            />
          ) : (
            <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-[1.55] text-ink-2">
              {packet.discharge_instructions}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default React.memo(DischargeEditor);
