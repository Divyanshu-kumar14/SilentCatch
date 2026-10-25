"use client";

import React, { useMemo, useState } from "react";

import {
  ANALYTE_BOUNDS,
  ANALYTE_LABELS,
  ANALYTE_UNIT,
} from "@/lib/clinical";
import type { KinematicSlope, LabPoint } from "@/lib/types";

const LEGEND: Record<string, string> = {
  KINETIC_AKI_STAGE_1: "AKI STAGE 1 · Δ≥0.3 OR ×1.5–1.9 (KDIGO)",
  KINETIC_AKI_STAGE_2: "AKI STAGE 2 · ×2.0–2.9 (KDIGO)",
  KINETIC_AKI_STAGE_3: "AKI STAGE 3 · ≥×3.0 (KDIGO)",
  KINETIC_EGFR_DECLINE: "eGFR DECLINE ≤ −10/day",
  OCCULT_HEMORRHAGE_SLOPE: "OCCULT HEMORRHAGE SLOPE",
};

const ANALYTE_ORDER = [
  "creatinine_mg_dl",
  "egfr_ml_min",
  "hemoglobin_g_dl",
  "potassium_mmol_l",
  "platelets",
] as const;

const W = 320;
const H = 108;
const PAD_L = 10;
const PAD_R = 34;
const PAD_T = 12;
const PAD_B = 20;

const SparkCanvas = React.memo(function SparkCanvas({
  points,
  slope,
}: {
  points: LabPoint[];
  slope: KinematicSlope;
}) {
  const geom = useMemo(() => {
    const values = points.map((p) => p.value);
    const bounds: number[] = [...values];
    for (const p of points) {
      if (p.ref_min != null && p.ref_max != null) {
        bounds.push(p.ref_min, p.ref_max);
      }
    }
    let lo = Math.min(...bounds);
    let hi = Math.max(...bounds);
    if (lo === hi) {
      lo -= 0.5;
      hi += 0.5;
    }
    const padY = (hi - lo) * 0.12;
    lo -= padY;
    hi += padY;
    const times = points.map((p) => p.timestamp_hr);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const sx = (t: number) =>
      tMin === tMax ? (PAD_L + 20) : PAD_L + ((t - tMin) / (tMax - tMin)) * (W - PAD_L - PAD_R);
    const sy = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
    return { lo, hi, tMin, tMax, sx, sy };
  }, [points]);

  const flagged = slope.flags.length > 0;
  const stroke = flagged ? "var(--red)" : "var(--cyan-dim)";
  const first = points[0];
  const band = points.find((p) => p.ref_min != null && p.ref_max != null);

  const poly = points
    .map((p) => `${geom.sx(p.timestamp_hr).toFixed(1)},${geom.sy(p.value).toFixed(1)}`)
    .join(" ");

  // Slope vector: from first point along the OLS slope to the last point's time.
  const olsH = slope.slope_per_hour ?? 0;
  const lastT = geom.tMax;
  const firstT = geom.tMin;
  const vecEnd = {
    t: lastT,
    v: slope.status === "VALID" && slope.first_value != null
      ? slope.first_value + olsH * (lastT - firstT)
      : (first?.value ?? 0),
  };
  const arrowTip = { x: geom.sx(vecEnd.t), y: geom.sy(vecEnd.v) };
  const arrowTail = { x: geom.sx(firstT), y: geom.sy(first?.value ?? 0) };
  const ang = Math.atan2(arrowTip.y - arrowTail.y, arrowTip.x - arrowTail.x);
  const tipX = arrowTip.x;
  const tipY = arrowTip.y;
  const wing = 5;
  const arrow = `${tipX},${tipY} ${tipX - wing * Math.cos(ang - 0.4)},${tipY - wing * Math.sin(ang - 0.4)} ${tipX - wing * Math.cos(ang + 0.4)},${tipY - wing * Math.sin(ang + 0.4)}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full"
      role="img"
      aria-label={`Sparkline for ${slope.analyte}; slope ${slope.slope_per_day?.toFixed(3) ?? "n/a"} per day`}
    >
      {band?.ref_min != null && band.ref_max != null && (
        <g>
          <rect
            x={PAD_L}
            y={geom.sy(band.ref_max)}
            width={W - PAD_L - PAD_R}
            height={Math.max(2, geom.sy(band.ref_min) - geom.sy(band.ref_max))}
            fill="var(--green-dim)"
            opacity={0.25}
          />
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={geom.sy(band.ref_max)}
            y2={geom.sy(band.ref_max)}
            stroke="var(--green-dim)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          <text x={W - PAD_R + 4} y={geom.sy(band.ref_max) + 3} fontSize={7.5} fill="var(--green)" fontFamily="var(--font-geist-mono)">
            {band.ref_max}
          </text>
          <text x={W - PAD_R + 4} y={geom.sy(band.ref_min) + 3} fontSize={7.5} fill="var(--green)" fontFamily="var(--font-geist-mono)">
            {band.ref_min}
          </text>
        </g>
      )}

      <polyline
        points={poly}
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={geom.sx(p.timestamp_hr)}
          cy={geom.sy(p.value)}
          r={2.4}
          fill={flagged ? "var(--red)" : "var(--cyan)"}
        />
      ))}

      {slope.status === "VALID" && points.length >= 2 && (
        <>
          <line
            x1={arrowTail.x}
            y1={arrowTail.y}
            x2={tipX}
            y2={tipY}
            stroke={flagged ? "var(--red)" : "var(--text-faint)"}
            strokeWidth={flagged ? 1.4 : 1}
          />
          <polygon points={arrow} fill={flagged ? "var(--red)" : "var(--text-faint)"} />
        </>
      )}

      {points.map((p, i) => (
        <text
          key={`t${i}`}
          x={geom.sx(p.timestamp_hr)}
          y={H - 6}
          fontSize={7.5}
          textAnchor="middle"
          fill="var(--text-faint)"
          fontFamily="var(--font-geist-mono)"
        >
          T{p.timestamp_hr >= 0 ? "+" : "−"}
          {Math.abs(p.timestamp_hr)}h
        </text>
      ))}
    </svg>
  );
});

interface AnalyteCardProps {
  analyte: string;
  slope: KinematicSlope | undefined;
  points: LabPoint[];
  interceptActive: boolean;
  edits: Record<string, string>;
  errs: Record<string, string>;
  onChange: (analyte: string, idx: number, raw: string) => void;
  onBlur: (key: string) => void;
}

const AnalyteCard = React.memo(function AnalyteCard({
  analyte,
  slope,
  points,
  interceptActive,
  edits,
  errs,
  onChange,
  onBlur,
}: AnalyteCardProps) {
  const flagged = (slope?.flags?.length ?? 0) > 0 && interceptActive;
  const bounds = ANALYTE_BOUNDS[analyte];
  let analyteErr = "";
  for (const [key, msg] of Object.entries(errs)) {
    if (key.startsWith(`${analyte}:`) && msg) {
      analyteErr = msg;
      break;
    }
  }

  return (
    <article
      className={`rounded-sm border bg-pane-raised px-2 pt-1.5 pb-2 ${
        flagged ? "border-intercept-dim" : "border-border"
      }`}
    >
      <div className="flex items-baseline justify-between px-1">
        <h3 className="font-mono text-[10.5px] font-semibold tracking-wider text-text">
          {ANALYTE_LABELS[analyte]}
          <span className="ml-1.5 text-[8.5px] font-normal text-text-faint">
            {ANALYTE_UNIT[analyte]}
          </span>
        </h3>
        <div className="flex items-baseline gap-2">
          {slope?.pct_delta_from_baseline != null && (
            <span
              className={`font-mono text-[10px] font-semibold ${
                slope.pct_delta_from_baseline > 15
                  ? "text-intercept"
                  : slope.pct_delta_from_baseline < -15
                    ? "text-warn"
                    : "text-text-dim"
              }`}
            >
              Δ{slope.pct_delta_from_baseline > 0 ? "+" : ""}
              {slope.pct_delta_from_baseline.toFixed(0)}%
            </span>
          )}
          <span className="font-mono text-[8.5px] text-text-faint">
            {slope?.slope_per_hour != null
              ? `slope ${slope.slope_per_hour >= 0 ? "+" : ""}${(slope.slope_per_hour * 24).toFixed(3)}/d`
              : "no slope"}
          </span>
        </div>
      </div>

      {slope && <SparkCanvas points={points} slope={slope} />}

      {flagged && slope && (
        <div className="mx-1 mb-1 flex flex-wrap gap-1">
          {slope.flags.map((f) => (
            <span
              key={f}
              className="rounded-sm border border-intercept-dim bg-intercept/10 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold tracking-wide text-intercept"
            >
              {LEGEND[f] ?? f}
            </span>
          ))}
        </div>
      )}

      <div className="mx-1 flex flex-wrap items-center gap-1.5">
        {points.map((p, i) => {
          const key = `${analyte}:${i}`;
          const display = edits[key] ?? String(p.value);
          const error = errs[key];
          return (
            <label key={key} className="flex items-center gap-1">
              <span className="font-mono text-[8.5px] text-text-faint">
                T{p.timestamp_hr >= 0 ? "+" : "−"}
                {Math.abs(p.timestamp_hr)}
              </span>
              <input
                inputMode="decimal"
                value={display}
                onChange={(e) => onChange(analyte, i, e.target.value)}
                onBlur={() => onBlur(key)}
                aria-label={`${ANALYTE_LABELS[analyte]} value at T${p.timestamp_hr}h`}
                className={`w-16 rounded-sm border bg-bg px-1.5 py-0.5 font-mono text-[11px] text-text outline-none transition-colors ${
                  error
                    ? "border-intercept text-intercept"
                    : "border-border-strong focus:border-live"
                }`}
              />
            </label>
          );
        })}
      </div>
      <p className="mx-1 mt-1 h-3 font-mono text-[8.5px] text-intercept" role="alert">
        {analyteErr}
      </p>
      {bounds && !analyteErr && (
        <p className="mx-1 font-mono text-[8px] tracking-wider text-text-faint">
          sandbox bounds {bounds.min}–{bounds.max}
        </p>
      )}
    </article>
  );
});

function LabSparkline({
  slopes,
  serialLabs,
  flags,
  onEdit,
  interceptActive,
}: {
  slopes: Record<string, KinematicSlope>;
  serialLabs: Record<string, LabPoint[]>;
  flags: string[];
  onEdit: (analyte: string, idx: number, raw: string) => string | null;
  interceptActive: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});

  const analytes = useMemo(
    () => ANALYTE_ORDER.filter((a) => Boolean(serialLabs[a]?.length)),
    [serialLabs]
  );

  const handleChange = (analyte: string, idx: number, raw: string) => {
    const key = `${analyte}:${idx}`;
    setEdits((prev) => ({ ...prev, [key]: raw }));
    const rejected = onEdit(analyte, idx, raw);
    setErrs((prev) => ({ ...prev, [key]: rejected ?? "" }));
  };

  const handleBlur = (key: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <section className="flex min-h-0 flex-col border border-border bg-pane">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.2em] text-text-dim">
          48-HOUR LAB VELOCITY
        </h2>
        <div className="flex items-center gap-1.5">
          {flags.length > 0 && interceptActive && (
            <span className="rounded-[2px] border border-intercept-dim bg-intercept/10 px-1.5 py-0.2 font-mono text-[8.5px] font-semibold text-intercept">
              {flags.length} ALARM{flags.length > 1 ? "S" : ""}
            </span>
          )}
          <span className="font-mono text-[9px] text-text-faint">
            static band vs kinetic slope
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="labs-scroll">
        {analytes.length === 0 && (
          <p className="font-mono text-[10px] text-text-faint">no serial labs on file</p>
        )}
        <div className="flex flex-col gap-3">
          {analytes.map((analyte) => (
            <AnalyteCard
              key={analyte}
              analyte={analyte}
              slope={slopes[analyte]}
              points={serialLabs[analyte]}
              interceptActive={interceptActive}
              edits={edits}
              errs={errs}
              onChange={handleChange}
              onBlur={handleBlur}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default React.memo(LabSparkline);
