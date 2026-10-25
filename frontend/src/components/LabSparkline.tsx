"use client";

import React, { useId, useMemo, useState } from "react";

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
const H = 104;
const PAD_L = 12;
const PAD_R = 36;
const PAD_T = 12;
const PAD_B = 22;

const SparkCanvas = React.memo(function SparkCanvas({
  points,
  slope,
}: {
  points: LabPoint[];
  slope: KinematicSlope;
}) {
  const gradientId = useId();
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
    const padY = (hi - lo) * 0.14;
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
  const stroke = flagged ? "#FF5A5F" : "#3DE0D0";
  const first = points[0];
  const band = points.find((p) => p.ref_min != null && p.ref_max != null);

  const polyPoints = points
    .map((p) => `${geom.sx(p.timestamp_hr).toFixed(1)},${geom.sy(p.value).toFixed(1)}`)
    .join(" ");

  // Gradient area fill points
  const areaPoints = [
    `${geom.sx(points[0].timestamp_hr).toFixed(1)},${(H - PAD_B).toFixed(1)}`,
    polyPoints,
    `${geom.sx(points[points.length - 1].timestamp_hr).toFixed(1)},${(H - PAD_B).toFixed(1)}`,
  ].join(" ");

  // Slope vector: from first point along the OLS slope to the last point's time
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
      className="block w-full overflow-visible"
      role="img"
      aria-label={`Sparkline for ${slope.analyte}; slope ${slope.slope_per_day?.toFixed(3) ?? "n/a"} per day`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={flagged ? "#FF5A5F" : "#3DE0D0"} stopOpacity={0.28} />
          <stop offset="100%" stopColor={flagged ? "#FF5A5F" : "#3DE0D0"} stopOpacity={0.0} />
        </linearGradient>
      </defs>

      {/* Normal Reference Range Band */}
      {band?.ref_min != null && band.ref_max != null && (
        <g>
          <rect
            x={PAD_L}
            y={geom.sy(band.ref_max)}
            width={W - PAD_L - PAD_R}
            height={Math.max(2, geom.sy(band.ref_min) - geom.sy(band.ref_max))}
            fill="#3DE0D0"
            opacity={0.12}
            rx={2}
          />
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={geom.sy(band.ref_max)}
            y2={geom.sy(band.ref_max)}
            stroke="#3DE0D0"
            strokeDasharray="3 3"
            strokeWidth={0.8}
            opacity={0.6}
          />
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={geom.sy(band.ref_min)}
            y2={geom.sy(band.ref_min)}
            stroke="#3DE0D0"
            strokeDasharray="3 3"
            strokeWidth={0.8}
            opacity={0.6}
          />
          <text x={W - PAD_R + 4} y={geom.sy(band.ref_max) + 3} fontSize={7.5} fill="#3DE0D0" fontFamily="var(--font-geist-mono)">
            {band.ref_max}
          </text>
          <text x={W - PAD_R + 4} y={geom.sy(band.ref_min) + 3} fontSize={7.5} fill="#3DE0D0" fontFamily="var(--font-geist-mono)">
            {band.ref_min}
          </text>
        </g>
      )}

      {/* Filled Area Gradient Under Curve */}
      <polygon points={areaPoints} fill={`url(#${gradientId})`} />

      {/* Main Curve Line */}
      <polyline
        points={polyPoints}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data Points */}
      {points.map((p, i) => {
        const isLast = i === points.length - 1;
        return (
          <g key={i}>
            {isLast && (
              <circle
                cx={geom.sx(p.timestamp_hr)}
                cy={geom.sy(p.value)}
                r={5}
                fill={flagged ? "#FF5A5F" : "#3DE0D0"}
                opacity={0.3}
                className="animate-ping"
              />
            )}
            <circle
              cx={geom.sx(p.timestamp_hr)}
              cy={geom.sy(p.value)}
              r={isLast ? 3.2 : 2.4}
              fill={flagged ? "#FF5A5F" : "#3DE0D0"}
              stroke="#06070C"
              strokeWidth={1.2}
            />
          </g>
        );
      })}

      {/* OLS Slope Vector Arrow */}
      {slope.status === "VALID" && points.length >= 2 && (
        <>
          <line
            x1={arrowTail.x}
            y1={arrowTail.y}
            x2={tipX}
            y2={tipY}
            stroke={flagged ? "#FF5A5F" : "#8A93A6"}
            strokeWidth={flagged ? 1.5 : 1}
            strokeDasharray={flagged ? "none" : "3 2"}
          />
          <polygon points={arrow} fill={flagged ? "#FF5A5F" : "#8A93A6"} />
        </>
      )}

      {/* Timestamp labels */}
      {points.map((p, i) => (
        <text
          key={`t${i}`}
          x={geom.sx(p.timestamp_hr)}
          y={H - 5}
          fontSize={7.5}
          textAnchor="middle"
          fill="#8A93A6"
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
      className={`rounded-xl border p-3 transition-all duration-200 ${
        flagged
          ? "border-[#FF5A5F]/70 bg-gradient-to-b from-[#FF5A5F]/20 via-[#0A0D16]/90 to-[#06070C]/90 shadow-[0_0_20px_rgba(255,90,95,0.25)]"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-baseline justify-between px-1">
        <h3 className="font-mono text-[11px] font-bold tracking-wider text-[#F4F6FA]">
          {ANALYTE_LABELS[analyte]}
          <span className="ml-1.5 text-[9px] font-normal text-[#8A93A6]">
            {ANALYTE_UNIT[analyte]}
          </span>
        </h3>
        <div className="flex items-baseline gap-2">
          {slope?.pct_delta_from_baseline != null && (
            <span
              className={`font-mono text-[10.5px] font-bold ${
                slope.pct_delta_from_baseline > 15
                  ? "text-[#FF5A5F]"
                  : slope.pct_delta_from_baseline < -15
                    ? "text-[#FFB84D]"
                    : "text-[#8A93A6]"
              }`}
            >
              Δ{slope.pct_delta_from_baseline > 0 ? "+" : ""}
              {slope.pct_delta_from_baseline.toFixed(0)}%
            </span>
          )}
          <span className="font-mono text-[9px] text-[#8A93A6]">
            {slope?.slope_per_hour != null
              ? `slope ${slope.slope_per_hour >= 0 ? "+" : ""}${(slope.slope_per_hour * 24).toFixed(3)}/d`
              : "no slope"}
          </span>
        </div>
      </div>

      {slope && <SparkCanvas points={points} slope={slope} />}

      {flagged && slope && (
        <div className="mx-1 mt-1.5 mb-2 flex flex-wrap gap-1">
          {slope.flags.map((f) => (
            <span
              key={f}
              className="rounded-full border border-[#FF5A5F]/60 bg-[#FF5A5F]/15 px-2.5 py-0.5 font-mono text-[9px] font-bold tracking-wide text-[#FF5A5F] shadow-[0_0_8px_rgba(255,90,95,0.3)]"
            >
              {LEGEND[f] ?? f}
            </span>
          ))}
        </div>
      )}

      {/* Sandbox Inputs */}
      <div className="mx-1 mt-1 flex flex-wrap items-center gap-2">
        {points.map((p, i) => {
          const key = `${analyte}:${i}`;
          const display = edits[key] ?? String(p.value);
          const error = errs[key];
          return (
            <label key={key} className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-black/40 px-2 py-1">
              <span className="font-mono text-[9px] text-[#8A93A6]">
                T{p.timestamp_hr >= 0 ? "+" : "−"}
                {Math.abs(p.timestamp_hr)}
              </span>
              <input
                inputMode="decimal"
                value={display}
                onChange={(e) => onChange(analyte, i, e.target.value)}
                onBlur={() => onBlur(key)}
                aria-label={`${ANALYTE_LABELS[analyte]} value at T${p.timestamp_hr}h`}
                className={`w-14 rounded border bg-[#06070C]/90 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white outline-none transition-all ${
                  error
                    ? "border-[#FF5A5F] text-[#FF5A5F] shadow-[0_0_10px_rgba(255,90,95,0.4)]"
                    : "border-white/12 focus:border-[#3DE0D0] focus:ring-1 focus:ring-[#3DE0D0]/50"
                }`}
              />
            </label>
          );
        })}
      </div>

      <p className="mx-1 mt-1.5 h-3 font-mono text-[9px] font-bold text-[#FF5A5F]" role="alert">
        {analyteErr}
      </p>

      {bounds && !analyteErr && (
        <p className="mx-1 font-mono text-[8.5px] tracking-wider text-[#8A93A6]">
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
    <section className="glass-pane flex min-h-0 flex-col rounded-2xl overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-[#3DE0D0] shadow-[0_0_10px_#3DE0D0]" />
          <h2 className="font-mono text-[11px] font-bold tracking-[0.18em] text-[#F4F6FA]">
            48-HOUR LAB VELOCITY
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {flags.length > 0 && interceptActive && (
            <span className="rounded-full bg-[#FF5A5F]/15 border border-[#FF5A5F]/50 px-2.5 py-0.5 font-mono text-[9px] font-bold text-[#FF5A5F] shadow-[0_0_10px_rgba(255,90,95,0.25)]">
              {flags.length} ALARM{flags.length > 1 ? "S" : ""}
            </span>
          )}
          <span className="font-mono text-[9px] text-[#8A93A6]">
            static band vs kinetic slope
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5" data-testid="labs-scroll">
        {analytes.length === 0 && (
          <p className="font-mono text-[10px] text-[#8A93A6] text-center py-4">No serial labs on file</p>
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
