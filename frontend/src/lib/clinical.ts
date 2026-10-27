/**
 * Client-side clinical math + rule mirrors — must agree with the backend:
 * - Kinematics: backend/engine/kinematic_labs.py (OLS, rising-only AKI bands)
 * - Patch application: span_guard.assert_absent semantics (exact name match)
 * - Span resolution: span_guard.verify_quote P1 normalization (offsets must
 *   land in the SAME original text the guard proved them against).
 *
 * The UI never re-decides SILENT_PASS/intercept — the audit stream owns truth.
 * This module only (a) previews instant effects of sandbox edits and (b) maps
 * wire data onto panes.
 */

import type {
  Encounter,
  FollowUpOrder,
  InterceptionVerdict,
  KinematicSlope,
  LabPoint,
  Prescription,
  SlopeStatus,
  LabNote,
} from "./types";

// ---------------------------------------------------------------- kinematics

const MIN_TIME_SPAN_H = 2.0;
const AKI_ABS_DELTA = 0.3; // KDIGO stage-1 absolute criterion (48h window)
const AKI_STAGE_BANDS: ReadonlyArray<[string, number, number]> = [
  ["KINETIC_AKI_STAGE_3", 3.0, Number.POSITIVE_INFINITY],
  ["KINETIC_AKI_STAGE_2", 2.0, 3.0],
  ["KINETIC_AKI_STAGE_1", 1.5, 2.0],
];
const EGFR_DECLINE_SLOPE_PER_DAY = -10.0;
const HEMOGLOBIN_DROP = -1.5;
const PLATELET_PCT_DROP = -30.0;

export const SUPPORTED_ANALYTES = [
  "creatinine_mg_dl",
  "egfr_ml_min",
  "hemoglobin_g_dl",
  "potassium_mmol_l",
  "platelets",
] as const;

export const ANALYTE_LABELS: Record<string, string> = {
  creatinine_mg_dl: "Creatinine",
  egfr_ml_min: "eGFR",
  hemoglobin_g_dl: "Hemoglobin",
  potassium_mmol_l: "Potassium",
  platelets: "Platelets",
};

export const ANALYTE_UNIT: Record<string, string> = {
  creatinine_mg_dl: "mg/dL",
  egfr_ml_min: "mL/min",
  hemoglobin_g_dl: "g/dL",
  potassium_mmol_l: "mmol/L",
  platelets: "K/µL",
};

/** PRD FR-5.3 bound is stated for creatinine-type fields (0.1–25.0 checkbox verbatim);
 * other analytes get clinically sane ranges so "edit any lab value" stays true. */
export const ANALYTE_BOUNDS: Record<string, { min: number; max: number }> = {
  creatinine_mg_dl: { min: 0.1, max: 25.0 },
  egfr_ml_min: { min: 1, max: 200 },
  hemoglobin_g_dl: { min: 1, max: 30 },
  potassium_mmol_l: { min: 1, max: 15 },
  platelets: { min: 1, max: 1000 },
};

export function analyteBounds(analyte: string): { min: number; max: number } | null {
  return ANALYTE_BOUNDS[analyte] ?? null;
}

/** Numeric parse + per-analyte bound check; NaN / empty / out-of-range all reject. */
export function isValidLabValue(analyte: string, raw: string | number): boolean {
  const bounds = ANALYTE_BOUNDS[analyte];
  if (!bounds) return false;
  const str = String(raw).trim();
  if (!/^\d*\.?\d*$/.test(str)) return false; // digits only — "abc" rejected
  const value = Number(str);
  if (!Number.isFinite(value)) return false;
  return value >= bounds.min && value <= bounds.max;
}

function olsSlopePerHour(points: LabPoint[]): number {
  const n = points.length;
  const meanT = points.reduce((acc, p) => acc + p.timestamp_hr, 0) / n;
  const meanY = points.reduce((acc, p) => acc + p.value, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const dt = p.timestamp_hr - meanT;
    num += dt * (p.value - meanY);
    den += dt * dt;
  }
  return den === 0 ? 0 : num / den;
}

function deriveFlags(analyte: string, slope: KinematicSlope): string[] {
  const first = slope.first_value ?? 0;
  const last = slope.last_value ?? 0;
  const absDelta = last - first;
  const ratio = first !== 0 ? last / first : 0;
  const pct = first !== 0 ? (absDelta / first) * 100 : 0;

  if (analyte === "creatinine_mg_dl") {
    // Rising trajectory only — recovering kidneys (ED-103) must stay silent.
    if (absDelta >= AKI_ABS_DELTA) {
      for (const [flag, lo, hi] of AKI_STAGE_BANDS) {
        if (lo <= ratio && ratio < hi) return [flag];
      }
    }
    if (ratio >= 3.0) return ["KINETIC_AKI_STAGE_3"];
  } else if (
    analyte === "egfr_ml_min" &&
    (slope.slope_per_day ?? 0) <= EGFR_DECLINE_SLOPE_PER_DAY
  ) {
    return ["KINETIC_EGFR_DECLINE"];
  } else if (analyte === "hemoglobin_g_dl" && absDelta <= HEMOGLOBIN_DROP) {
    return ["OCCULT_HEMORRHAGE_SLOPE"];
  } else if (analyte === "platelets" && pct <= PLATELET_PCT_DROP) {
    return ["OCCULT_HEMORRHAGE_SLOPE"];
  } else if (analyte === "potassium_mmol_l" && (last >= 5.2 && pct >= 20.0)) {
    return ["KINETIC_HYPERKALEMIA_SLOPE"];
  }
  return [];
}

/** Instant recompute of one analyte's slope after a sandbox edit (FR-5.3). */
export function analyzeAnalyte(analyte: string, pointsIn: LabPoint[]): KinematicSlope {
  const points = [...pointsIn]
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.timestamp_hr - b.timestamp_hr);
  const base = {
    analyte,
    slope_per_hour: null,
    slope_per_day: null,
    pct_delta_from_baseline: null,
    abs_delta: null,
    first_value: null,
    last_value: null,
    flags: [] as string[],
  };
  if (points.length === 0) return { ...base, status: "INSUFFICIENT_TIME_SERIES", n_points: 0 };

  const slope: KinematicSlope = { ...base, status: "VALID", n_points: points.length };
  slope.first_value = points[0].value;
  slope.last_value = points[points.length - 1].value;
  const spanH = Math.abs(points[points.length - 1].timestamp_hr - points[0].timestamp_hr);
  if (points.length < 2 || spanH < MIN_TIME_SPAN_H || slope.first_value === 0) {
    // PRD edge: no slope possible -> suppress every kinetic alert (fail silent).
    slope.status = "INSUFFICIENT_TIME_SERIES" as SlopeStatus;
    slope.slope_per_hour = points.length >= 2 ? olsSlopePerHour(points) : null;
    return slope;
  }
  slope.slope_per_hour = olsSlopePerHour(points);
  slope.slope_per_day = slope.slope_per_hour * 24.0;
  slope.abs_delta = slope.last_value - slope.first_value;
  slope.pct_delta_from_baseline = (slope.abs_delta / slope.first_value) * 100.0;
  slope.flags = deriveFlags(analyte, slope);
  return slope;
}

export function analyzeSerialLabs(
  serialLabs: Record<string, LabPoint[]>
): Record<string, KinematicSlope> {
  const out: Record<string, KinematicSlope> = {};
  for (const analyte of SUPPORTED_ANALYTES) {
    const points = serialLabs[analyte];
    if (points && points.length > 0) out[analyte] = analyzeAnalyte(analyte, points);
  }
  return out;
}

export function flatFlags(slopes: Record<string, KinematicSlope>): string[] {
  const seen: string[] = [];
  for (const s of Object.values(slopes)) {
    for (const f of s.flags) if (!seen.includes(f)) seen.push(f);
  }
  return seen;
}

// ---------------------------------------------------------------- patch loop

/** Stable identity for an applied patch (indexes can drift between re-runs). */
export function patchKey(v: InterceptionVerdict): string {
  const p = v.discharge_patch;
  return [
    v.kind,
    p.add_follow_up_order?.cpt_code ?? "",
    p.add_prescription?.drug_name ?? "",
    p.remove_drug_name ?? "",
  ].join("|");
}

/** Immutably apply one verdict's discharge_patch (FR-5.2 "mutating in place"). */
export function applyPatch(
  encounter: Encounter,
  patch: {
    remove_drug_name?: string | null;
    add_prescription?: Prescription | null;
    add_follow_up_order?: FollowUpOrder | null;
  }
): Encounter {
  const next: Encounter = structuredClone(encounter);
  const packet = next.draft_discharge_packet;
  const needle = patch.remove_drug_name?.trim().toLowerCase() ?? "";

  if (needle) {
    // span_guard.assert_absent match rule: substring, case-insensitive.
    packet.prescriptions = packet.prescriptions.filter(
      (rx) => !rx.drug_name.trim().toLowerCase().includes(needle)
    );
  }
  if (patch.add_prescription) {
    packet.prescriptions = [...packet.prescriptions, patch.add_prescription];
  }
  if (patch.add_follow_up_order) {
    packet.follow_up_orders = [...packet.follow_up_orders, patch.add_follow_up_order];
  }
  return next;
}

// ---------------------------------------------------------------- span → pane

/** span_guard P1 normalization, mirrored with the INSIDE kept for honest compare. */
function normalizeForCompare(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type SpanPane = "report" | "lab_note";

export interface ResolvedSpan {
  pane: SpanPane;
  text: string; // original-text slice rendered before/after the highlight
}

/** Find which source text the guard-proved offsets belong to. Deterministic:
 * slice both texts and compare the normalized slice to the normalized quote. */
export function resolveSpan(
  encounter: Encounter,
  verdict: InterceptionVerdict
): ResolvedSpan | null {
  const { start_char: s, end_char: e } = verdict.verified_span;
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s || e > 1e7) return null;

  const report = encounter.radiology_study.report_text;
  const slices: Array<{ pane: SpanPane; text: string }> = [
    { pane: "report", text: report.slice(s, e) },
  ];
  const labNote: LabNote | null | undefined = encounter.lab_note;
  if (labNote?.text) slices.push({ pane: "lab_note", text: labNote.text.slice(s, e) });

  const quoted = normalizeForCompare(verdict.source_quote);
  for (const slice of slices) {
    if (slice.text && normalizeForCompare(slice.text) === quoted) return slice;
  }
  return null;
}

// ---------------------------------------------------------------- labels

export function kindLabel(kind: string): string {
  switch (kind) {
    case "INCIDENTAL_FINDING_DROP":
      return "Incidental finding dropped";
    case "KINETIC_MED_COLLISION":
      return "Lab-velocity drug collision";
    default:
      return kind;
  }
}

/** Compact human-readable model badge for telemetry footer. */
export function shortModel(modelId?: string | null): string {
  if (!modelId) return "";
  const lower = modelId.toLowerCase();
  if (lower.includes("super-vl")) return "Super-VL 120B";
  if (lower.includes("nano")) return "Nano 30B";
  if (lower.includes("ultra")) return "Ultra 550B";
  if (lower.includes("super-120b")) return "Super 120B";
  if (lower.includes("tavily")) return "Tavily Guidelines";
  const tail = modelId.split("/").pop() ?? modelId;
  return tail.length <= 16 ? tail : `${tail.slice(0, 10)}…`;
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(0)}%`;
}
