"use client";

import React, { useMemo, useState } from "react";
import { Search, ChevronDown, ChevronUp, ArrowUpRight } from "lucide-react";

import benchmarkData from "@/data/results_latest.json";
import type { BenchmarkCase, BenchmarkReport } from "@/lib/types";

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

/** Mode is provenance, so it reads as a tone, not a badge. */
function modeTone(mode: string): string {
  if (mode === "LIVE") return "text-safe";
  if (mode === "MIXED") return "text-warn";
  if (mode === "REPLAYED") return "text-muted";
  return "text-signal";
}

function caseAgreesWithFixture(c: BenchmarkCase): boolean | null {
  if (c.predicted_outcome == null) return null;
  return c.predicted_outcome === c.expected_outcome;
}

function outcomeTone(outcome: string | null): string {
  if (outcome == null) return "text-faint";
  return outcome === "CRITICAL_INTERCEPT" ? "text-signal" : "text-safe";
}

function outcomeLabel(outcome: string | null): string {
  if (outcome == null) return "no prediction";
  return outcome === "CRITICAL_INTERCEPT" ? "intercept" : "silent pass";
}

/** Drop the fixture-note prefix where the surrounding label already says it. */
function stripPrefix(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text.slice(prefix.length).trim() : text;
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
    <div className="mx-auto max-w-[1440px] px-6 py-8 text-ink lg:px-10">
      {/* ───────────────────────── provenance ───────────────────────── */}
      <header className="border-b border-ink pb-6">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <div className="max-w-[60ch]">
            <p className="label">Evidence · synthetic fixtures</p>
            <h1 className="mt-2 font-display text-[clamp(2.2rem,4.2vw,3.6rem)] leading-[0.98] tracking-[-0.03em]">
              Architecture benchmark &amp; replay ledger
            </h1>
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-2">
              {isReplay
                ? "This artifact was produced in replay mode. The pipeline re-ran local fixture traces; no provider calls were made. Replay agreement is a functional check, not model accuracy."
                : `This artifact was produced in ${meta.mode.toLowerCase()} mode. Metrics cover only the ${meta.total_encounters} listed synthetic fixtures and do not establish clinical sensitivity or real-world safety.`}
            </p>
          </div>

          <dl className="grid w-full shrink-0 grid-cols-2 gap-x-8 gap-y-4 sm:w-auto sm:grid-cols-4 sm:gap-y-3">
            <div>
              <dt className="label">Executed mode</dt>
              <dd className={`mt-1 text-[13px] font-medium ${modeTone(meta.mode)}`}>
                {meta.mode}
                <span className="ml-2 text-[11px] font-normal text-faint">
                  requested {meta.requested_mode}
                </span>
              </dd>
            </div>
            <div>
              <dt className="label">Fixtures</dt>
              <dd className="mt-1 text-[13px] font-medium text-ink">
                {meta.total_encounters}
                <span className="ml-2 text-[11px] font-normal text-faint">
                  {meta.contradiction_count} contradiction · {meta.safe_count} safe
                </span>
              </dd>
            </div>
            <div>
              <dt className="label">Run</dt>
              <dd className="mono mt-1 text-[12px] text-ink-2">{meta.eval_date}</dd>
            </div>
            <div>
              <dt className="label">Schema</dt>
              <dd className="mono mt-1 text-[12px] text-ink-2">v{report.schema_version}</dd>
            </div>
          </dl>
        </div>

        <p className="mt-5 max-w-[92ch] border-l-2 border-edge-2 pl-3 text-[12.5px] leading-[1.6] text-muted">
          <span className="font-medium text-ink-2">How to read this page.</span>{" "}
          <span className="mono">N/A</span> means the run produced no scored value. A replay check
          compares local fixture output with fixture expectations; it is not recall, precision, or
          clinical validation. Scored metrics appear only when a prediction came from a live
          provider response.
          {meta.requested_mode !== meta.mode && (
            <>
              {" "}
              Requested mode was <span className="mono">{meta.requested_mode}</span>; executed mode
              was <span className="mono">{meta.mode}</span>.
            </>
          )}
        </p>
      </header>

      {/* ──────────────────────────── KPIs ──────────────────────────── */}
      <section
        className="grid grid-cols-1 gap-x-10 gap-y-8 border-b border-edge py-8 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Headline numbers"
      >
        <div className="border-t border-ink pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label">Replay agreement</span>
            <span className="mono text-[11px] text-faint">tiered router</span>
          </div>
          <div className="mt-2 font-display text-[clamp(2.4rem,3.4vw,3.2rem)] leading-[0.9] tracking-[-0.03em]">
            {tiered.replay_check_matches}
            <span className="text-faint">/{tiered.replay_check_total}</span>
          </div>
          <p className="mt-2 text-[12px] leading-[1.5] text-ink-2">
            Predicted/expected fixture checks match. A functional check, not model accuracy.
          </p>
        </div>

        <div className="border-t border-ink pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label">Critical recall</span>
            <span
              className={`mono text-[11px] ${
                tiered.scored_cases === 0 ? "text-faint" : "text-signal"
              }`}
            >
              {tiered.tp} tp
            </span>
          </div>
          <div className="mt-2 font-display text-[clamp(2.4rem,3.4vw,3.2rem)] leading-[0.9] tracking-[-0.03em]">
            {pct(tiered.recall_pct)}
          </div>
          <p className="mt-2 text-[12px] leading-[1.5] text-ink-2">
            {tiered.positive_cases_scored}/{tiered.positive_cases_total} contradiction fixtures
            scored.{" "}
            {tiered.positive_cases_scored === 0
              ? "Replay predictions are not scored, so no recall is claimed."
              : "Limited to fixtures that produced a scored live prediction."}
          </p>
        </div>

        <div className="border-t border-ink pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label">False positive rate</span>
            <span
              className={`mono text-[11px] ${
                tiered.scored_cases === 0 ? "text-faint" : "text-safe"
              }`}
            >
              {tiered.fp} fp
            </span>
          </div>
          <div className="mt-2 font-display text-[clamp(2.4rem,3.4vw,3.2rem)] leading-[0.9] tracking-[-0.03em]">
            {pct(tiered.fpr_pct)}
          </div>
          <p className="mt-2 text-[12px] leading-[1.5] text-ink-2">
            {tiered.negative_cases_scored}/{tiered.negative_cases_total} clean fixtures scored.{" "}
            {tiered.scored_cases === 0
              ? "No scored clean cases, so no FPR is claimed."
              : "Counted only on scored clean-fixture cases."}
          </p>
        </div>

        <div className="border-t border-ink pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label">Median latency</span>
            <span className="mono text-[11px] text-faint">n={tiered.latency_n}</span>
          </div>
          <div className="mt-2 font-display text-[clamp(2.4rem,3.4vw,3.2rem)] leading-[0.9] tracking-[-0.03em]">
            {ms(tiered.median_latency_ms)}
          </div>
          <p className="mt-2 text-[12px] leading-[1.5] text-ink-2">
            p95 {ms(tiered.p95_latency_ms)} · {latencyScopeLabel(tiered.latency_scope)}.{" "}
            {tiered.latency_scope === "local_replay"
              ? "Replay timings measure local execution, not model inference."
              : "Covers only the scored cases in this artifact."}
          </p>
        </div>
      </section>

      {/* ──────────────────── architecture comparison ──────────────────── */}
      <section className="border-b border-edge py-8" aria-labelledby="arch-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div>
            <h2 id="arch-title" className="text-[15px] font-medium text-ink">
              Architecture comparison
            </h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {cases.length} cases × {configs.length} configurations · executed {meta.mode} ·
              requested {meta.requested_mode}
            </p>
          </div>
          <span className="mono text-[11px] text-faint">schema v{report.schema_version}</span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-ink text-[11px] text-muted">
                <th className="w-[30%] py-2 pr-5 font-medium">Configuration</th>
                <th className="px-3 py-2 text-center font-medium">Mode</th>
                <th className="px-3 py-2 text-center font-medium">Scored</th>
                <th className="px-3 py-2 text-center font-medium">Replay check</th>
                <th className="px-3 py-2 text-center font-medium">FPR</th>
                <th className="px-3 py-2 text-center font-medium">Recall</th>
                <th className="px-3 py-2 text-center font-medium">Precision</th>
                <th className="px-3 py-2 text-center font-medium">Median / p95</th>
                <th className="py-2 pl-3 text-right font-medium">Cost / 1k</th>
              </tr>
            </thead>
            <tbody>
              {configs.map(([key, data]) => {
                const isSelected = key === "tiered_router";
                const scoredNone = data.scored_cases === 0;
                return (
                  <tr
                    key={key}
                    className={`border-b border-edge align-top ${
                      isSelected ? "bg-sheet-2" : ""
                    }`}
                  >
                    <td className="py-4 pr-5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13.5px] font-medium text-ink">{data.name}</span>
                        {isSelected && (
                          <span className="mono text-[10px] uppercase tracking-[0.06em] text-signal">
                            selected
                          </span>
                        )}
                      </div>
                      <p className="mt-1 max-w-[44ch] text-[11.5px] leading-[1.45] text-muted">
                        {data.description.join(" · ")}
                      </p>
                    </td>
                    <td className={`mono px-3 py-4 text-center text-[11px] ${modeTone(data.mode)}`}>
                      {data.mode}
                    </td>
                    <td className="mono px-3 py-4 text-center">
                      <div className="text-ink">{data.scored_cases}</div>
                      <div className="text-[10.5px] text-faint">
                        {data.positive_cases_scored} pos · {data.negative_cases_scored} neg
                      </div>
                    </td>
                    <td className="mono px-3 py-4 text-center">
                      <div className="text-ink">
                        {data.replay_check_matches}/{data.replay_check_total}
                      </div>
                      <div className="text-[10.5px] text-faint">agreement</div>
                    </td>
                    <td
                      className={`mono px-3 py-4 text-center ${
                        scoredNone
                          ? "text-faint"
                          : data.fpr_pct === 0
                            ? "text-safe"
                            : "text-signal"
                      }`}
                    >
                      {pct(data.fpr_pct)}
                    </td>
                    <td
                      className={`mono px-3 py-4 text-center ${
                        scoredNone
                          ? "text-faint"
                          : data.recall_pct === 100
                            ? "text-safe"
                            : "text-warn"
                      }`}
                    >
                      {pct(data.recall_pct)}
                    </td>
                    <td className="mono px-3 py-4 text-center text-ink-2">
                      {pct(data.precision_pct)}
                    </td>
                    <td className="mono px-3 py-4 text-center">
                      <div className="text-ink">{ms(data.median_latency_ms)}</div>
                      <div className="text-[10.5px] text-faint">
                        p95 {ms(data.p95_latency_ms)} · {latencyScopeLabel(data.latency_scope)}
                      </div>
                    </td>
                    <td className="mono py-4 pl-3 text-right">
                      <div className="text-ink">
                        {data.cost_type === "not_applicable_replay"
                          ? "N/A"
                          : usd(data.cost_per_1k_discharges_usd)}
                      </div>
                      <div className="text-[10.5px] text-faint">
                        {costTypeLabel(data.cost_type)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-[92ch] text-[11.5px] leading-[1.6] text-muted">
          Cost is estimated from actual token usage at public rates. It is not a provider invoice
          and is not applicable to replay runs.{" "}
          {costApplicable
            ? `Tiered router is ${pct(tiered.cost_reduction_vs_ultra_pct)} below the Ultra baseline.`
            : "No cost reduction is claimed in replay."}
        </p>
      </section>

      {/* ──────────────────── per-encounter ledger ──────────────────── */}
      <section className="py-8" aria-labelledby="ledger-title">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <h2 id="ledger-title" className="text-[15px] font-medium text-ink">
              Per-encounter fixture ledger
            </h2>
            <p className="mt-0.5 max-w-[80ch] text-[12.5px] text-muted">
              Expected outcomes are authored with the fixtures. Predicted outcomes are shown with
              their execution source and scoring status.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-3" role="group" aria-label="Filter cases">
              {(
                [
                  ["all", `All (${cases.length})`],
                  ["intercept", `Contradiction (${meta.positive_cases})`],
                  ["safe", `Expected safe (${meta.negative_cases})`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setActiveFilter(id)}
                  aria-pressed={activeFilter === id}
                  className={`text-[12px] transition-colors ${
                    activeFilter === id
                      ? "font-medium text-ink underline decoration-signal decoration-1 underline-offset-4"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input
                type="text"
                placeholder="Filter by ID, outcome, source…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Filter cases"
                className="field h-7 w-52 pl-7 pr-2 text-[12px] placeholder:text-faint sm:w-60"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-ink text-[11px] text-muted">
                <th className="w-[92px] py-2 pr-3 font-medium">Encounter</th>
                <th className="w-[96px] px-2 py-2 font-medium">Modality</th>
                <th className="px-2 py-2 font-medium">Fixture scenario</th>
                <th className="w-[104px] px-2 py-2 text-center font-medium">Expected</th>
                <th className="w-[104px] px-2 py-2 text-center font-medium">Predicted</th>
                <th className="w-[108px] px-2 py-2 text-center font-medium">Mode / source</th>
                <th className="w-[96px] px-2 py-2 text-right font-medium">Latency</th>
                <th className="w-[92px] px-2 py-2 text-right font-medium">Cost</th>
                <th className="w-[92px] px-2 py-2 text-center font-medium">Status</th>
                <th className="w-[36px] px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredCases.map((c) => {
                const isIntercept = c.expected_outcome === "CRITICAL_INTERCEPT";
                const isExpanded = expandedId === c.encounter_id;
                const note = FIXTURE_NOTES[c.encounter_id];
                const agrees = caseAgreesWithFixture(c);
                return (
                  <React.Fragment key={c.encounter_id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : c.encounter_id)}
                      className={`cursor-pointer border-b border-edge align-top transition-colors ${
                        isExpanded ? "bg-sheet-2" : "hover:bg-sheet-2/60"
                      }`}
                    >
                      <td className="py-3 pr-3">
                        <div className="flex items-baseline gap-1.5">
                          <span className="mono text-[12px] font-medium text-ink">
                            {c.encounter_id}
                          </span>
                          {c.encounter_id === "ED-104" && (
                            <span className="mono text-[9.5px] uppercase tracking-[0.06em] text-muted">
                              demo
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
                          <span aria-hidden>{note?.modalityIcon ?? "🩻"}</span>
                          <span>{c.expected_contradiction ? "multi" : "single"}</span>
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <div className="truncate text-[12.5px] font-medium text-ink">
                          {note?.title ?? c.encounter_id}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted">
                          {stripPrefix(
                            note?.fixturePlan ?? "Synthetic fixture",
                            "Fixture discharge plan:"
                          )}
                        </div>
                      </td>
                      <td className={`px-2 py-3 text-center text-[11.5px] ${outcomeTone(c.expected_outcome)}`}>
                        {outcomeLabel(c.expected_outcome)}
                      </td>
                      <td className={`px-2 py-3 text-center text-[11.5px] ${outcomeTone(c.predicted_outcome)}`}>
                        {outcomeLabel(c.predicted_outcome)}
                      </td>
                      <td className="px-2 py-3 text-center">
                        <div className={`mono text-[10.5px] ${modeTone(c.case_mode)}`}>
                          {c.case_mode}
                        </div>
                        <div
                          className="truncate text-[10.5px] text-faint"
                          title={c.prediction_source}
                        >
                          {sourceLabel(c.prediction_source)}
                        </div>
                      </td>
                      <td className="mono px-2 py-3 text-right">
                        <div className="text-ink-2">{ms(c.latency_ms)}</div>
                        <div className="text-[10.5px] text-faint">
                          {latencyScopeLabel(c.latency_scope)}
                        </div>
                      </td>
                      <td className="mono px-2 py-3 text-right">
                        <div className="text-ink-2">
                          {c.cost_type === "not_applicable_replay" ? "N/A" : usd(c.cost_usd)}
                        </div>
                        <div className="text-[10.5px] text-faint">
                          {c.cost_type === "not_applicable_replay"
                            ? "replay"
                            : costTypeLabel(c.cost_type)}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center">
                        {c.scored ? (
                          <span
                            className={`text-[10.5px] font-medium ${
                              agrees ? "text-safe" : "text-signal"
                            }`}
                            title="Scored against fixture expectation (not clinical validation)"
                          >
                            {agrees ? "scored ✓" : "scored ✗"}
                          </span>
                        ) : c.predicted_outcome != null ? (
                          <span
                            className="text-[10.5px] text-muted"
                            title="Replay/fixture agreement only; not a scored model prediction"
                          >
                            replay
                          </span>
                        ) : (
                          <span className="text-[10.5px] text-faint">N/A</span>
                        )}
                      </td>
                      <td className="px-1 py-3 text-center text-faint">
                        {isExpanded ? (
                          <ChevronUp className="mx-auto h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="mx-auto h-3.5 w-3.5" />
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="border-b border-edge bg-sheet-2">
                        <td colSpan={10} className="px-4 py-4">
                          <div className="border-l-2 border-signal pl-4">
                            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-baseline">
                              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <span className="text-[13.5px] font-medium text-ink">
                                  {note?.title ?? c.encounter_id}
                                </span>
                                <span
                                  className={`text-[11px] ${
                                    isIntercept ? "text-signal" : "text-safe"
                                  }`}
                                >
                                  {isIntercept ? "contradiction fixture" : "expected-safe fixture"}
                                </span>
                                <span className={`mono text-[11px] ${modeTone(c.case_mode)}`}>
                                  {c.case_mode}
                                </span>
                              </div>

                              {onSelectEncounter && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectEncounter(c.encounter_id);
                                  }}
                                  className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-ink underline decoration-signal decoration-1 underline-offset-4 transition-colors hover:text-signal"
                                >
                                  Open in flight-check
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-3">
                              <div>
                                <dt className="label">Fixture discharge plan</dt>
                                <dd className="mt-1 text-[12px] leading-[1.5] text-ink-2">
                                  {stripPrefix(
                                    note?.fixturePlan ?? "Synthetic fixture",
                                    "Fixture discharge plan:"
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt className="label">Fixture contradiction</dt>
                                <dd
                                  className={`mt-1 text-[12px] leading-[1.5] ${
                                    isIntercept ? "text-signal-ink" : "text-ink-2"
                                  }`}
                                >
                                  {note?.fixtureRisk ?? "No authored contradiction"}
                                </dd>
                              </div>
                              <div>
                                <dt className="label">Reference expectation</dt>
                                <dd className="mt-1 text-[12px] leading-[1.5] text-ink-2">
                                  {stripPrefix(
                                    note?.referenceAction ?? "See fixture definition.",
                                    "Reference expectation:"
                                  )}
                                </dd>
                              </div>
                            </dl>

                            {c.stages.length > 0 && (
                              <div className="mt-4 overflow-x-auto">
                                <table className="w-full min-w-[720px] border-collapse text-left text-[11.5px]">
                                  <thead>
                                    <tr className="border-b border-edge-2 text-[10.5px] text-muted">
                                      <th className="py-1.5 pr-4 font-medium">Stage</th>
                                      <th className="px-3 py-1.5 font-medium">Source</th>
                                      <th className="px-3 py-1.5 font-medium">Model</th>
                                      <th className="px-3 py-1.5 text-right font-medium">Latency</th>
                                      <th className="px-3 py-1.5 text-right font-medium">Tokens</th>
                                      <th className="px-3 py-1.5 text-right font-medium">Cost</th>
                                      <th className="py-1.5 pl-3 font-medium">Note</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.stages.map((s, i) => (
                                      <tr key={`${s.stage}-${i}`} className="border-b border-edge">
                                        <td className="py-1.5 pr-4 text-ink">{s.stage}</td>
                                        <td className="px-3 py-1.5 text-ink-2">
                                          {sourceLabel(s.source)}
                                        </td>
                                        <td className="mono px-3 py-1.5 text-muted">
                                          {s.model_id ?? "—"}
                                        </td>
                                        <td className="mono px-3 py-1.5 text-right text-ink-2">
                                          {ms(s.latency_ms)}
                                        </td>
                                        <td className="mono px-3 py-1.5 text-right text-ink-2">
                                          {s.prompt_tokens == null && s.completion_tokens == null
                                            ? "N/A"
                                            : (s.prompt_tokens ?? 0) + (s.completion_tokens ?? 0)}
                                        </td>
                                        <td className="mono px-3 py-1.5 text-right text-ink-2">
                                          {s.cost_type === "not_applicable_replay"
                                            ? "N/A"
                                            : usd(s.cost_usd)}
                                        </td>
                                        <td className="py-1.5 pl-3 text-muted">{s.note || "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {(c.notes.length > 0 || c.fallback_affected || c.error) && (
                              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11.5px]">
                                {c.fallback_affected && (
                                  <span className="text-warn">fallback affected</span>
                                )}
                                {c.verification_rejected && (
                                  <span className="text-signal">verification rejected</span>
                                )}
                                {c.error && (
                                  <span className="mono text-signal">error: {c.error}</span>
                                )}
                                {c.notes.map((n) => (
                                  <span key={n} className="text-muted">
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

        <footer className="mt-5 space-y-1.5 border-t border-edge pt-4 text-[11.5px] leading-[1.6] text-muted">
          {meta.disclaimers.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </footer>
      </section>
    </div>
  );
}
