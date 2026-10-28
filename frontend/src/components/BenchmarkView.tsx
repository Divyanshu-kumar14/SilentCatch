"use client";

import React, { useMemo, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  TrendingDown,
  CheckCircle2,
  Layers,
  Award,
  Search,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowUpRight,
  Activity,
  AlertTriangle,
} from "lucide-react";

import benchmarkData from "@/data/results_latest.json";
import type {
  BenchmarkCase,
  BenchmarkReport,
} from "@/lib/types";

const report = benchmarkData as unknown as BenchmarkReport;

interface FixtureNote {
  title: string;
  category: "safe" | "intercept";
  modalityIcon: string;
  fixturePlan: string;
  fixtureRisk: string;
  referenceAction: string;
}

/**
 * Human-readable notes for the synthetic fixtures. These describe what each
 * fixture contains and what the fixture author expected — they are not clinical
 * validation results and they are not model outputs.
 */
const FIXTURE_NOTES: Record<string, FixtureNote> = {
  "ED-101": {
    title: "28M Ankle Sprain (Pickup Basketball)",
    category: "safe",
    modalityIcon: "🦴",
    fixturePlan: "Fixture discharge plan: rest, ice, compression, elevation; ibuprofen as needed.",
    fixtureRisk: "No acute imaging finding and no dangerous medication collision in this fixture.",
    referenceAction: "Reference expectation: silent pass.",
  },
  "ED-102": {
    title: "54F Pneumonia with Incidentally Noted 6mm Nodule",
    category: "safe",
    modalityIcon: "🩻",
    fixturePlan: "Fixture discharge plan: antibiotics and a 6-month chest CT already ordered.",
    fixtureRisk: "The incidental nodule is already covered by an existing follow-up order.",
    referenceAction: "Reference expectation: silent pass.",
  },
  "ED-103": {
    title: "41M Renal Colic, Recovering Creatinine",
    category: "safe",
    modalityIcon: "🌊",
    fixturePlan: "Fixture discharge plan: analgesia and outpatient urology follow-up.",
    fixtureRisk: "Creatinine is recovering; no rising kinetic AKI pattern and no interacting drug.",
    referenceAction: "Reference expectation: silent pass.",
  },
  "ED-104": {
    title: "62M Bicycle Trauma & Fractured 7th Rib",
    category: "intercept",
    modalityIcon: "🩻",
    fixturePlan: "Fixture discharge plan: Ketorolac (Toradol 15mg) and outpatient orthopedics.",
    fixtureRisk:
      "Fixture contains two contradictions: a 7.2mm RUL nodule without follow-up, and a rising creatinine trajectory paired with a nephrotoxic NSAID.",
    referenceAction:
      "Reference expectation: intercept until CT follow-up is ordered and the analgesic is replaced.",
  },
  "ED-105": {
    title: "33F Forearm Kitchen Knife Laceration",
    category: "safe",
    modalityIcon: "🦴",
    fixturePlan: "Fixture discharge plan: sutured laceration, tetanus toxoid, wound care instructions.",
    fixtureRisk: "No foreign body, intact cortical margin, and normal baseline vitals in this fixture.",
    referenceAction: "Reference expectation: silent pass.",
  },
  "ED-106": {
    title: "47M Atypical Chest Pain (ACS Ruled Out)",
    category: "safe",
    modalityIcon: "🩻",
    fixturePlan: "Fixture discharge plan: oral PPI for GERD after negative serial troponins.",
    fixtureRisk: "No acute cardiothoracic finding and stable hemodynamics in this fixture.",
    referenceAction: "Reference expectation: silent pass.",
  },
  "ED-107": {
    title: "19M Acute Viral Gastroenteritis",
    category: "safe",
    modalityIcon: "🩻",
    fixturePlan: "Fixture discharge plan: oral rehydration, ondansetron, BRAT diet.",
    fixtureRisk: "Benign non-obstructive bowel gas and rehydrated renal labs in this fixture.",
    referenceAction: "Reference expectation: silent pass.",
  },
  "ED-108": {
    title: "68F Uncomplicated Acute Cystitis",
    category: "safe",
    modalityIcon: "🌊",
    fixturePlan: "Fixture discharge plan: oral nitrofurantoin 100mg BID x 5 days.",
    fixtureRisk: "Bladder ultrasound negative for retention or hydronephrosis in this fixture.",
    referenceAction: "Reference expectation: silent pass.",
  },
  "ED-109": {
    title: "51M Acute-on-Chronic Lumbar Strain",
    category: "safe",
    modalityIcon: "🦴",
    fixturePlan: "Fixture discharge plan: cyclobenzaprine, walking, physical therapy.",
    fixtureRisk: "Degenerative changes without acute fracture or neural compression in this fixture.",
    referenceAction: "Reference expectation: silent pass.",
  },
  "ED-110": {
    title: "59M MVA Blunt Abdominal Trauma",
    category: "intercept",
    modalityIcon: "🩻",
    fixturePlan: "Fixture discharge plan: ibuprofen for abdominal wall contusion.",
    fixtureRisk: "Fixture reports an indeterminate 2.4cm adrenal lesion that the plan does not follow up.",
    referenceAction: "Reference expectation: intercept until outpatient endocrine/CT follow-up is arranged.",
  },
  "ED-111": {
    title: "73F Congestive Heart Failure",
    category: "intercept",
    modalityIcon: "🩻",
    fixturePlan: "Fixture discharge plan: spironolactone 25mg daily for fluid maintenance.",
    fixtureRisk: "Fixture combines a rising potassium trajectory with a potassium-sparing diuretic.",
    referenceAction: "Reference expectation: intercept until the diuretic choice is reconciled with the potassium trend.",
  },
  "ED-112": {
    title: "45M Severe Mechanical Fall",
    category: "intercept",
    modalityIcon: "🦴",
    fixturePlan: "Fixture discharge plan: enoxaparin for DVT prophylaxis.",
    fixtureRisk: "Fixture combines a falling hemoglobin trajectory with an anticoagulant.",
    referenceAction: "Reference expectation: intercept until the bleeding risk is evaluated.",
  },
};

// ------------------------------------------------------------------ formatting

function pct(value: number | null | undefined): string {
  return value == null ? "N/A" : `${value.toFixed(1)}%`;
}

function ms(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return value < 10 ? `${value.toFixed(1)} ms` : `${Math.round(value)} ms`;
}

function usd(value: number | null | undefined): string {
  if (value == null) return "N/A";
  if (value === 0) return "$0.00";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function latencyScopeLabel(scope: string): string {
  switch (scope) {
    case "live_end_to_end":
      return "live end-to-end";
    case "local_replay":
      return "local replay";
    case "mixed":
      return "mixed provenance";
    default:
      return "not measured";
  }
}

function costTypeLabel(type: string): string {
  switch (type) {
    case "estimated_from_actual_tokens":
      return "estimated from token usage";
    case "partial_external_credits_unavailable":
      return "partial — external credits unavailable";
    case "external_credits_unavailable":
      return "external credits unavailable";
    case "not_applicable_replay":
      return "not applicable to replay";
    default:
      return "unavailable";
  }
}

function sourceLabel(source: string | undefined): string {
  if (!source) return "unknown";
  if (source === "live" || source === "failsafe_live" || source === "tavily_live") return "live";
  if (source === "live_rejected") return "live rejected";
  if (source === "live_empty") return "live empty";
  if (source === "failure_no_prediction") return "failed";
  if (source === "cache_hit") return "cache hit";
  if (source === "cache_snapshot") return "snapshot";
  if (source.includes("fallback")) return "fallback";
  return source.replaceAll("_", " ");
}

function modeBadgeClass(mode: string): string {
  if (mode === "LIVE") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (mode === "MIXED") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (mode === "REPLAYED") return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  return "border-rose-500/30 bg-rose-500/10 text-rose-300";
}

function caseAgreesWithFixture(c: BenchmarkCase): boolean | null {
  if (c.predicted_outcome == null) return null;
  return c.predicted_outcome === c.expected_outcome;
}

// --------------------------------------------------------------------- component

export default function BenchmarkView({
  onSelectEncounter,
}: {
  onSelectEncounter?: (id: string) => void;
}) {
  const { meta, summary, cases } = report;
  const tiered = summary.tiered_router ?? summary[Object.keys(summary)[0]];
  const configs = Object.entries(summary);
  const isReplay = meta.mode === "REPLAYED";

  const [activeFilter, setActiveFilter] = useState<"all" | "intercept" | "safe">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>("ED-104");

  const filteredCases = useMemo(
    () =>
      cases.filter((c) => {
        const isIntercept = c.expected_outcome === "CRITICAL_INTERCEPT";
        if (activeFilter === "intercept" && !isIntercept) return false;
        if (activeFilter === "safe" && isIntercept) return false;
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        const note = FIXTURE_NOTES[c.encounter_id];
        return (
          c.encounter_id.toLowerCase().includes(q) ||
          (note?.title ?? "").toLowerCase().includes(q) ||
          (c.predicted_outcome ?? "").toLowerCase().includes(q) ||
          Object.values(c.stage_sources).join(" ").toLowerCase().includes(q)
        );
      }),
    [cases, activeFilter, searchQuery]
  );

  const costApplicable =
    tiered.cost_type !== "not_applicable_replay" &&
    tiered.cost_per_1k_discharges_usd != null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-6 text-slate-100 font-sans">
      {/* ---------------- 1. HERO / PROVENANCE ---------------- */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-slate-900 via-slate-900 to-sky-950/40 p-6 shadow-2xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
              <Activity className="h-4 w-4" />
              <span>Multi-Tier Model Evaluation · Synthetic Fixtures</span>
            </div>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">
              Architecture Benchmark & Replay Ledger
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-300">
              {isReplay
                ? "This artifact was produced in replay mode. The pipeline re-ran local fixture traces; no provider calls were made. Replay agreement is a functional check, not model accuracy."
                : `This artifact was produced in ${meta.mode.toLowerCase()} mode. Metrics cover only the ${meta.total_encounters} listed synthetic fixtures and do not establish clinical sensitivity or real-world safety.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold ${modeBadgeClass(
                meta.mode
              )}`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  meta.mode === "LIVE"
                    ? "bg-emerald-400"
                    : meta.mode === "MIXED"
                      ? "bg-amber-400"
                      : "bg-sky-400"
                }`}
              />
              <span>{isReplay ? "REPLAY · NO PROVIDER CALLS" : `${meta.mode} RUN`}</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-sky-300">
              <span>{meta.eval_date}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-slate-300">
          <Sparkles className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="leading-snug">
            <strong className="text-white">How to read this page:</strong>{" "}
            <span className="font-mono">N/A</span> means the run produced no scored value.
            A replay check compares local fixture output with fixture expectations; it is
            not recall, precision, or clinical validation. Scored metrics appear only when
            a prediction came from a live provider response.
            {meta.requested_mode !== meta.mode && (
              <>
                {" "}
                Requested mode was <span className="font-mono">{meta.requested_mode}</span>;
                executed mode was <span className="font-mono">{meta.mode}</span>.
              </>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- 2. KPI CARDS ---------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 to-slate-900/60 p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              False Positive Rate
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-black text-emerald-400">
              {pct(tiered.fpr_pct)}
            </span>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
              {tiered.fp} FP
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">
            {tiered.negative_cases_scored}/{tiered.negative_cases_total} clean fixtures scored
          </p>
          <p className="mt-2 border-t border-white/[0.06] pt-2 text-xs leading-relaxed text-slate-300">
            {tiered.scored_cases === 0
              ? "No scored clean cases in this run, so no FPR is claimed."
              : "False positives are counted only on scored clean-fixture cases."}
          </p>
        </div>

        <div className="rounded-2xl border border-rose-500/30 bg-gradient-to-b from-rose-500/10 to-slate-900/60 p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-400">
              Critical Recall
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-black text-rose-400">
              {pct(tiered.recall_pct)}
            </span>
            <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
              {tiered.tp}/{tiered.positive_cases_scored} detected
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">
            {tiered.positive_cases_scored}/{tiered.positive_cases_total} contradiction fixtures scored
          </p>
          <p className="mt-2 border-t border-white/[0.06] pt-2 text-xs leading-relaxed text-slate-300">
            {tiered.positive_cases_scored === 0
              ? "Replay predictions are not scored, so no recall is claimed."
              : "Recall is limited to the synthetic contradiction fixtures that produced a scored live prediction."}
          </p>
        </div>

        <div className="rounded-2xl border border-sky-500/30 bg-gradient-to-b from-sky-500/10 to-slate-900/60 p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
              Estimated Cost / 1k
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400">
              <TrendingDown className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-black text-sky-400">
              {costApplicable ? usd(tiered.cost_per_1k_discharges_usd) : "N/A"}
            </span>
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
              {costTypeLabel(tiered.cost_type)}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">
            Reduction vs Ultra baseline:{" "}
            {tiered.cost_reduction_vs_ultra_pct == null
              ? "N/A"
              : pct(tiered.cost_reduction_vs_ultra_pct)}
          </p>
          <p className="mt-2 border-t border-white/[0.06] pt-2 text-xs leading-relaxed text-slate-300">
            Cost is estimated from actual token usage at public rates. It is not a provider
            invoice and is not applicable to replay runs.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-slate-800/40 to-slate-900/60 p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Median Latency
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-slate-300">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-black text-white">
              {ms(tiered.median_latency_ms)}
            </span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
              {latencyScopeLabel(tiered.latency_scope)}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">
            p95: {ms(tiered.p95_latency_ms)} · n={tiered.latency_n}
          </p>
          <p className="mt-2 border-t border-white/[0.06] pt-2 text-xs leading-relaxed text-slate-300">
            {tiered.latency_scope === "local_replay"
              ? "Replay timings measure local execution only; they are not model inference latency."
              : "Latency covers only the scored cases in this artifact."}
          </p>
        </div>
      </div>

      {/* ---------------- 3. CONFIGURATION TABLE ---------------- */}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-2xl backdrop-blur-md">
        <header className="flex flex-col gap-2 border-b border-white/[0.08] bg-slate-900/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-sky-400" />
              <h2 className="text-sm font-bold tracking-wide text-white">
                Architecture Comparison ({cases.length} cases × {configs.length} configurations)
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Executed mode: {meta.mode} · requested: {meta.requested_mode} ·{" "}
              {meta.total_encounters} synthetic fixtures
            </p>
          </div>
          <span className="self-start rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 font-mono text-xs font-semibold text-sky-300 sm:self-auto">
            schema v{report.schema_version}
          </span>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/[0.06] bg-slate-950/60 font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-6 py-3.5">Model Architecture</th>
                <th className="px-4 py-3.5 text-center">Mode</th>
                <th className="px-4 py-3.5 text-center">Scored (pos/neg)</th>
                <th className="px-4 py-3.5 text-center">Replay check</th>
                <th className="px-4 py-3.5 text-center">FPR</th>
                <th className="px-4 py-3.5 text-center">Recall</th>
                <th className="px-4 py-3.5 text-center">Precision</th>
                <th className="px-4 py-3.5 text-center">Median / p95</th>
                <th className="px-5 py-3.5 text-right">Cost / 1k</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {configs.map(([key, data]) => {
                const isSelected = key === "tiered_router";
                const scoredNone = data.scored_cases === 0;
                return (
                  <tr
                    key={key}
                    className={
                      isSelected
                        ? "bg-sky-500/10 font-medium text-white"
                        : "text-slate-300 hover:bg-white/[0.02]"
                    }
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                            isSelected
                              ? "border border-sky-500/40 bg-sky-500/20 text-sky-400"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {isSelected ? (
                            <Award className="h-4 w-4" />
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-slate-500" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{data.name}</span>
                            {isSelected && (
                              <span className="rounded-full border border-sky-500/30 bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                                TIERED
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-400">
                            {data.description.join(" · ")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span
                        className={`inline-block rounded-md border px-2 py-1 font-mono text-[10px] font-bold ${modeBadgeClass(
                          data.mode
                        )}`}
                      >
                        {data.mode}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center font-mono text-slate-200">
                      <div className="font-bold">{data.scored_cases}</div>
                      <div className="text-[10px] text-slate-400">
                        {data.positive_cases_scored}/{data.negative_cases_scored}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center font-mono text-slate-200">
                      <div className="font-bold">
                        {data.replay_check_matches}/{data.replay_check_total}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        fixture agreement
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center font-mono">
                      <span
                        className={`inline-block rounded-md border px-2.5 py-1 text-xs ${
                          scoredNone
                            ? "border-white/10 bg-white/5 text-slate-400"
                            : data.fpr_pct === 0
                              ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-300"
                              : "border-rose-500/30 bg-rose-500/20 text-rose-300"
                        }`}
                      >
                        {pct(data.fpr_pct)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center font-mono">
                      <span
                        className={`inline-block rounded-md border px-2.5 py-1 text-xs ${
                          scoredNone
                            ? "border-white/10 bg-white/5 text-slate-400"
                            : data.recall_pct === 100
                              ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-300"
                              : "border-amber-500/30 bg-amber-500/20 text-amber-300"
                        }`}
                      >
                        {pct(data.recall_pct)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center font-mono text-slate-200">
                      {pct(data.precision_pct)}
                    </td>
                    <td className="px-4 py-4 text-center font-mono">
                      <div className="font-semibold text-white">{ms(data.median_latency_ms)}</div>
                      <div className="text-[10px] text-slate-400">
                        p95 {ms(data.p95_latency_ms)} · {latencyScopeLabel(data.latency_scope)}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right font-mono">
                      <div className="text-sm font-bold text-white">
                        {data.cost_type === "not_applicable_replay"
                          ? "N/A"
                          : usd(data.cost_per_1k_discharges_usd)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {costTypeLabel(data.cost_type)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- 4. PER-ENCOUNTER FIXTURE LEDGER ---------------- */}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-2xl backdrop-blur-md">
        <header className="border-b border-white/[0.08] bg-slate-900/80 px-6 py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-bold tracking-wide text-white">
                  Per-Encounter Fixture Ledger ({cases.length} synthetic cases)
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                Expected outcomes are authored with the fixtures. Predicted outcomes are shown with
                their execution source and scoring status.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center rounded-xl border border-white/10 bg-slate-950/60 p-1">
                <button
                  onClick={() => setActiveFilter("all")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                    activeFilter === "all"
                      ? "border border-sky-500/30 bg-sky-500/20 text-sky-300"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  All ({cases.length})
                </button>
                <button
                  onClick={() => setActiveFilter("intercept")}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                    activeFilter === "intercept"
                      ? "border border-rose-500/30 bg-rose-500/20 text-rose-300"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <AlertTriangle className="h-3 w-3 text-rose-400" />
                  <span>Contradiction ({meta.positive_cases})</span>
                </button>
                <button
                  onClick={() => setActiveFilter("safe")}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                    activeFilter === "safe"
                      ? "border border-emerald-500/30 bg-emerald-500/20 text-emerald-300"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <ShieldCheck className="h-3 w-3 text-emerald-400" />
                  <span>Expected safe ({meta.negative_cases})</span>
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter by ID, outcome, source…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-48 rounded-xl border border-white/10 bg-slate-950/60 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-sky-500/50 focus:outline-none sm:w-56"
                />
              </div>
            </div>
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="border-b border-white/[0.06] bg-slate-950/60 font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="w-[86px] px-3 py-3.5">Encounter</th>
                <th className="w-[90px] px-3 py-3.5">Modality</th>
                <th className="px-3 py-3.5">Fixture Scenario</th>
                <th className="w-[118px] px-1 py-3.5 text-center">Expected</th>
                <th className="w-[130px] px-1 py-3.5 text-center">Predicted</th>
                <th className="w-[96px] px-1 py-3.5 text-center">Mode / Source</th>
                <th className="w-[82px] px-2 py-3.5 text-right">Latency</th>
                <th className="w-[92px] px-2 py-3.5 text-right">Cost</th>
                <th className="w-[72px] px-1 py-3.5 text-center">Status</th>
                <th className="w-[45px] px-1 py-3.5 text-center">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filteredCases.map((c) => {
                const isIntercept = c.expected_outcome === "CRITICAL_INTERCEPT";
                const isExpanded = expandedId === c.encounter_id;
                const note = FIXTURE_NOTES[c.encounter_id];
                const agrees = caseAgreesWithFixture(c);
                return (
                  <React.Fragment key={c.encounter_id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : c.encounter_id)}
                      className={`cursor-pointer transition-colors ${
                        isExpanded
                          ? "bg-white/[0.04]"
                          : isIntercept
                            ? "hover:bg-rose-500/[0.03]"
                            : "hover:bg-white/[0.02]"
                      }`}
                    >
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-white">
                            {c.encounter_id}
                          </span>
                          {c.encounter_id === "ED-104" && (
                            <span className="rounded border border-amber-500/30 bg-amber-500/20 px-1 py-0.2 text-[10px] font-bold text-amber-300">
                              DEMO
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-1 truncate font-mono text-[11px] text-slate-300">
                          <span>{note?.modalityIcon ?? "🩻"}</span>
                          <span className="truncate">
                            {c.expected_contradiction ? "multi-modal" : "single study"}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="truncate font-medium text-white">
                          {note?.title ?? c.encounter_id}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">
                          {note?.fixturePlan ?? "Synthetic fixture"}
                        </div>
                      </td>
                      <td className="px-1 py-3.5 text-center font-mono">
                        <span
                          className={`inline-block whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-tight ${
                            isIntercept
                              ? "border-rose-500/30 bg-rose-500/20 text-rose-300"
                              : "border-emerald-500/30 bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {c.expected_outcome}
                        </span>
                      </td>
                      <td className="px-1 py-3.5 text-center font-mono">
                        {c.predicted_outcome == null ? (
                          <span className="text-[10px] font-bold text-slate-500">
                            NO PREDICTION
                          </span>
                        ) : (
                          <span
                            className={`inline-block whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-tight ${
                              c.predicted_outcome === "CRITICAL_INTERCEPT"
                                ? "border-rose-500/30 bg-rose-500/20 text-rose-300"
                                : "border-emerald-500/30 bg-emerald-500/20 text-emerald-300"
                            }`}
                          >
                            {c.predicted_outcome}
                          </span>
                        )}
                      </td>
                      <td className="px-1 py-3.5 text-center font-mono">
                        <div className="text-[10px] font-bold text-slate-300">{c.case_mode}</div>
                        <div className="truncate text-[10px] text-slate-500" title={c.prediction_source}>
                          {sourceLabel(c.prediction_source)}
                        </div>
                      </td>
                      <td className="px-2 py-3.5 text-right font-mono text-xs text-slate-300">
                        <div>{ms(c.latency_ms)}</div>
                        <div className="text-[10px] text-slate-500">
                          {latencyScopeLabel(c.latency_scope)}
                        </div>
                      </td>
                      <td className="px-2 py-3.5 text-right font-mono text-xs text-slate-300">
                        <div>
                          {c.cost_type === "not_applicable_replay" ? "N/A" : usd(c.cost_usd)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {c.cost_type === "not_applicable_replay"
                            ? "replay"
                            : costTypeLabel(c.cost_type)}
                        </div>
                      </td>
                      <td className="px-1 py-3.5 text-center">
                        {c.scored ? (
                          <span
                            className={`inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                              agrees
                                ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-300"
                                : "border-rose-500/30 bg-rose-500/20 text-rose-300"
                            }`}
                            title="Scored against fixture expectation (not clinical validation)"
                          >
                            {agrees ? "SCORED ✓" : "SCORED ✗"}
                          </span>
                        ) : c.predicted_outcome != null ? (
                          <span
                            className="inline-flex items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold text-sky-300"
                            title="Replay/fixture agreement only; not a scored model prediction"
                          >
                            REPLAY
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-500">N/A</span>
                        )}
                      </td>
                      <td className="px-1 py-3.5 text-center text-slate-400">
                        {isExpanded ? (
                          <ChevronUp className="mx-auto h-4 w-4 text-sky-400" />
                        ) : (
                          <ChevronDown className="mx-auto h-4 w-4 hover:text-white" />
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="border-b border-white/[0.06] bg-slate-950/70">
                        <td colSpan={10} className="px-6 py-4">
                          <div className="space-y-3 rounded-xl border border-white/[0.08] bg-slate-900/60 p-4">
                            <div className="flex flex-col justify-between gap-2 border-b border-white/[0.06] pb-3 sm:flex-row sm:items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">
                                  {note?.title ?? c.encounter_id}
                                </span>
                                <span
                                  className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
                                    isIntercept
                                      ? "border-rose-500/30 bg-rose-500/20 text-rose-300"
                                      : "border-emerald-500/30 bg-emerald-500/20 text-emerald-300"
                                  }`}
                                >
                                  {isIntercept ? "Contradiction fixture" : "Expected-safe fixture"}
                                </span>
                                <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${modeBadgeClass(c.case_mode)}`}>
                                  {c.case_mode}
                                </span>
                              </div>

                              {onSelectEncounter && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectEncounter(c.encounter_id);
                                  }}
                                  className="flex items-center gap-1.5 self-start rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 transition-all hover:bg-sky-500/20 sm:self-auto"
                                >
                                  <span>Open in Flight-Check Console</span>
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-3">
                              <div className="rounded-lg border border-white/[0.04] bg-black/30 p-3">
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                  Fixture discharge plan
                                </div>
                                <p className="leading-relaxed text-slate-200">
                                  {note?.fixturePlan ?? "Synthetic fixture"}
                                </p>
                              </div>
                              <div className="rounded-lg border border-white/[0.04] bg-black/30 p-3">
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                  Fixture contradiction
                                </div>
                                <p className={isIntercept ? "font-medium leading-relaxed text-rose-300" : "leading-relaxed text-emerald-300"}>
                                  {note?.fixtureRisk ?? "No authored contradiction"}
                                </p>
                              </div>
                              <div className="rounded-lg border border-white/[0.04] bg-black/30 p-3">
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                  Reference expectation
                                </div>
                                <p className="font-medium leading-relaxed text-sky-300">
                                  {note?.referenceAction ?? "See fixture definition."}
                                </p>
                              </div>
                            </div>

                            {c.stages.length > 0 && (
                              <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
                                <table className="w-full text-left text-[11px]">
                                  <thead className="bg-black/40 text-[10px] uppercase tracking-wider text-slate-400">
                                    <tr>
                                      <th className="px-3 py-1.5">Stage</th>
                                      <th className="px-3 py-1.5">Source</th>
                                      <th className="px-3 py-1.5">Model</th>
                                      <th className="px-3 py-1.5 text-right">Latency</th>
                                      <th className="px-3 py-1.5 text-right">Tokens</th>
                                      <th className="px-3 py-1.5 text-right">Cost</th>
                                      <th className="px-3 py-1.5">Note</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/[0.04] font-mono text-slate-300">
                                    {c.stages.map((s, i) => (
                                      <tr key={`${s.stage}-${i}`}>
                                        <td className="px-3 py-1.5 text-white">{s.stage}</td>
                                        <td className="px-3 py-1.5">{sourceLabel(s.source)}</td>
                                        <td className="px-3 py-1.5">{s.model_id ?? "—"}</td>
                                        <td className="px-3 py-1.5 text-right">{ms(s.latency_ms)}</td>
                                        <td className="px-3 py-1.5 text-right">
                                          {s.prompt_tokens == null && s.completion_tokens == null
                                            ? "N/A"
                                            : (s.prompt_tokens ?? 0) + (s.completion_tokens ?? 0)}
                                        </td>
                                        <td className="px-3 py-1.5 text-right">
                                          {s.cost_type === "not_applicable_replay"
                                            ? "N/A"
                                            : usd(s.cost_usd)}
                                        </td>
                                        <td className="px-3 py-1.5 text-slate-400">{s.note || "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {(c.notes.length > 0 || c.fallback_affected || c.error) && (
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                {c.fallback_affected && (
                                  <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-300">
                                    fallback affected
                                  </span>
                                )}
                                {c.verification_rejected && (
                                  <span className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-300">
                                    verification rejected
                                  </span>
                                )}
                                {c.error && (
                                  <span className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-rose-300">
                                    error: {c.error}
                                  </span>
                                )}
                                {c.notes.map((n) => (
                                  <span
                                    key={n}
                                    className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300"
                                  >
                                    {n}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="space-y-1 border-t border-white/[0.08] bg-slate-950/60 px-6 py-3 text-[11px] leading-relaxed text-slate-400">
          {meta.disclaimers.map((line) => (
            <p key={line}>• {line}</p>
          ))}
        </footer>
      </section>
    </div>
  );
}
