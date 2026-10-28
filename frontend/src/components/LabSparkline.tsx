"use client";

import React, { useId, useMemo, useState } from "react";

import {
  ANALYTE_BOUNDS,
  ANALYTE_LABELS,
  ANALYTE_UNIT,
} from "@/lib/clinical";
import type { KinematicSlope, LabPoint } from "@/lib/types";

const LEGEND: Record<string, string> = {
  KINETIC_AKI_STAGE_1: "AKI stage 1 · rapid kidney stress",
  KINETIC_AKI_STAGE_2: "AKI stage 2 · doubled baseline (KDIGO)",
  KINETIC_AKI_STAGE_3: "AKI stage 3 · severe kidney failure (KDIGO)",
  KINETIC_EGFR_DECLINE: "Rapid filtration decline (eGFR drop)",
  OCCULT_HEMORRHAGE_SLOPE: "Occult bleeding · rapid haemoglobin drop",
};

const ANALYTE_ORDER = [
  "creatinine_mg_dl",
  "egfr_ml_min",
  "hemoglobin_g_dl",
  "potassium_mmol_l",
  "platelets",
] as const;

const NOTE: Record<string, string> = {
  creatinine_mg_dl: "Kidney waste filtration marker",
  egfr_ml_min: "Estimated glomerular filtration rate",
  hemoglobin_g_dl: "Oxygen-carrying capacity of blood",
  potassium_mmol_l: "Cardiac rhythm electrolyte",
  platelets: "Clotting cell count",
};

const W = 360;
const H = 126;
const PAD_L = 14;
const PAD_R = 54;
const PAD_T = 14;
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
    const padY = (hi - lo) * 0.15;
    lo -= padY;
    hi += padY;
    const times = points.map((p) => p.timestamp_hr);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const sx = (t: number) =>
      tMin === tMax ? PAD_L + 30 : PAD_L + ((t - tMin) / (tMax - tMin)) * (W - PAD_L - PAD_R);
    const sy = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
    return { lo, hi, tMin, tMax, sx, sy };
  }, [points]);

  const flagged = slope.flags.length > 0;
  const strokeColor = flagged ? "#B0232A" : "#2F3236";
  const band = points.find((p) => p.ref_min != null && p.ref_max != null);

  const pathD = useMemo(() => {
    if (points.length < 2) return "";
    let d = `M ${geom.sx(points[0].timestamp_hr).toFixed(1)} ${geom.sy(points[0].value).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const prevX = geom.sx(points[i - 1].timestamp_hr);
      const prevY = geom.sy(points[i - 1].value);
      const curX = geom.sx(points[i].timestamp_hr);
      const curY = geom.sy(points[i].value);
      const midX = (prevX + curX) / 2;
      d += ` C ${midX.toFixed(1)} ${prevY.toFixed(1)}, ${midX.toFixed(1)} ${curY.toFixed(1)}, ${curX.toFixed(1)} ${curY.toFixed(1)}`;
    }
    return d;
  }, [points, geom]);

  const areaD = useMemo(() => {
    if (points.length < 2) return "";
    const bottomY = (H - PAD_B).toFixed(1);
    const firstX = geom.sx(points[0].timestamp_hr).toFixed(1);
    const lastX = geom.sx(points[points.length - 1].timestamp_hr).toFixed(1);
    return `${pathD} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  }, [pathD, points, geom]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full overflow-visible"
      role="img"
      aria-label={`Sparkline for ${slope.analyte}; slope ${slope.slope_per_day?.toFixed(3) ?? "n/a"} per day`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={0.16} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* printed reference range */}
      {band?.ref_min != null && band.ref_max != null && (
        <g>
          <rect
            x={PAD_L}
            y={geom.sy(band.ref_max)}
            width={W - PAD_L - PAD_R}
            height={Math.max(2, geom.sy(band.ref_min) - geom.sy(band.ref_max))}
            fill="#DCD6C8"
            opacity={0.4}
          />
          {[band.ref_max, band.ref_min].map((v, i) => (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={geom.sy(v)}
                y2={geom.sy(v)}
                stroke="#C6BFAD"
                strokeDasharray="2 3"
                strokeWidth={1}
              />
              <text
                x={W - PAD_R + 5}
                y={geom.sy(v) + 3}
                fill="#8C8A82"
                fontSize="9.5"
                fontFamily="var(--font-geist-mono), monospace"
              >
                {v}
              </text>
            </g>
          ))}
        </g>
      )}

      {areaD && <path d={areaD} fill={`url(#${gradientId})`} />}

      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {points.map((p, i) => {
        const cx = geom.sx(p.timestamp_hr);
        const cy = geom.sy(p.value);
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={3.6} fill="#FAF9F5" stroke={strokeColor} strokeWidth={1.6} />
            <circle cx={cx} cy={cy} r={1.3} fill={strokeColor} />
            <text
              x={cx}
              y={H - 5}
              textAnchor="middle"
              fill="#8C8A82"
              fontSize="9.5"
              fontFamily="var(--font-geist-mono), monospace"
            >
              {p.timestamp_hr >= 0 ? "+" : "−"}
              {Math.abs(p.timestamp_hr)}h
            </text>
          </g>
        );
      })}
    </svg>
  );
});

const AnalyteRow = React.memo(function AnalyteRow({
  analyte,
  slope,
  points,
  interceptActive,
  edits,
  errs,
  onChange,
  onBlur,
}: {
  analyte: string;
  slope: KinematicSlope | undefined;
  points: LabPoint[];
  interceptActive: boolean;
  edits: Record<string, string>;
  errs: Record<string, string>;
  onChange: (analyte: string, idx: number, raw: string) => void;
  onBlur: (key: string) => void;
}) {
  if (!points?.length || !slope) return null;

  const flagged = slope.flags.length > 0;
  const isDangerous = flagged && interceptActive;
  const bounds = ANALYTE_BOUNDS[analyte];
  const analyteErr = Object.entries(errs).find(([k]) => k.startsWith(`${analyte}:`))?.[1] ?? "";

  const deltaPct =
    slope.status === "VALID" && slope.pct_delta_from_baseline != null
      ? `${slope.pct_delta_from_baseline >= 0 ? "+" : ""}${slope.pct_delta_from_baseline.toFixed(0)}%`
      : "";

  return (
    <article
      className={`border-b border-edge py-3 ${isDangerous ? "bg-signal-wash" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-ink">
            {ANALYTE_LABELS[analyte] ?? analyte}
            <span className="ml-1.5 text-[11.5px] font-normal text-muted">
              {ANALYTE_UNIT[analyte]}
            </span>
          </h3>
          <p className="mt-0.5 text-[12px] text-muted">{NOTE[analyte] ?? "Serial laboratory parameter"}</p>
        </div>

        <div className="flex shrink-0 items-baseline gap-2.5">
          {deltaPct && (
            <span
              className={`mono text-[13px] font-medium ${
                isDangerous ? "text-signal" : "text-ink-2"
              }`}
            >
              {deltaPct}
            </span>
          )}
          {slope.slope_per_day != null && (
            <span className="mono text-[11px] text-faint">
              {Math.abs(slope.slope_per_day) < 0.001
                ? "flat"
                : `${slope.slope_per_day >= 0 ? "+" : ""}${slope.slope_per_day.toFixed(2)}/day`}
            </span>
          )}
        </div>
      </div>

      <div className="mt-1.5">
        <SparkCanvas points={points} slope={slope} />
      </div>

      {flagged ? (
        <div className="mt-1.5 flex items-start gap-2 border-l-2 border-signal pl-2.5">
          <p className="text-[12.5px] leading-[1.45] text-signal-ink">
            <span className="font-medium">{LEGEND[slope.flags[0]] ?? slope.flags[0]}.</span>{" "}
            <span className="text-ink-2">
              {slope.pct_delta_from_baseline != null
                ? `The gate reads velocity, not the printed range: this trend moved ${Math.abs(
                    slope.pct_delta_from_baseline
                  ).toFixed(0)}% across the observation window.`
                : "The gate reads velocity across the observation window, not a single printed value."}
            </span>
          </p>
        </div>
      ) : (
        <p className="mt-1.5 border-l-2 border-edge-2 pl-2.5 text-[12.5px] leading-[1.45] text-muted">
          Flat across the 48-hour observation window. No occult organ distress detected.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {points.map((p, i) => {
          const key = `${analyte}:${i}`;
          const display = edits[key] ?? String(p.value);
          const error = errs[key];
          return (
            <label key={key} className="flex items-center gap-1.5">
              <span className="mono text-[11px] text-faint">
                {p.timestamp_hr >= 0 ? "+" : "−"}
                {Math.abs(p.timestamp_hr)}h
              </span>
              <input
                inputMode="decimal"
                value={display}
                onChange={(e) => onChange(analyte, i, e.target.value)}
                onBlur={() => onBlur(key)}
                aria-label={`${ANALYTE_LABELS[analyte]} value at T${p.timestamp_hr}h`}
                aria-invalid={Boolean(error)}
                className={`field mono w-14 px-1.5 py-0.5 text-[12px] ${
                  error ? "!border-signal text-signal-ink" : ""
                }`}
              />
            </label>
          );
        })}

        {bounds && !analyteErr && (
          <span className="mono ml-auto text-[10.5px] text-faint">
            {bounds.min}–{bounds.max}
          </span>
        )}
      </div>

      {analyteErr && (
        <p className="mono mt-1 text-[11px] text-signal" role="alert">
          {analyteErr}
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
    <section className="flex h-full min-h-0 flex-col" aria-label="48-hour lab velocity">
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-edge px-4">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="text-[13px] font-medium text-ink">Kinetics</h2>
          <span className="truncate text-[12px] text-muted">48-hour velocity</span>
        </div>

        {flags.length > 0 && interceptActive && (
          <span className="mono shrink-0 text-[11px] text-signal">
            {flags.length} alarm{flags.length > 1 ? "s" : ""}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4" data-testid="labs-scroll">
        {analytes.length === 0 && (
          <p className="py-10 text-center text-[12px] text-muted">No serial labs on file</p>
        )}

        {analytes.map((analyte) => (
          <AnalyteRow
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

        <div className="mt-auto border border-edge bg-sheet-2 p-3 pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[12px] font-medium text-ink">Trajectory simulator</h3>
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-faint">
              editable
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-[1.5] text-muted">
            Change the second creatinine reading to see the KDIGO stage-1 gate fire before the
            printed static threshold does.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              onClick={() => handleChange("creatinine_mg_dl", 1, "1.16")}
              className="h-7 border border-signal/40 bg-signal-wash px-2.5 text-[11.5px] font-medium text-signal-ink transition-colors hover:bg-signal hover:text-sheet"
            >
              +87% surge · 1.16
            </button>
            <button
              onClick={() => handleChange("creatinine_mg_dl", 1, "2.40")}
              className="h-7 border border-signal/40 bg-signal-wash px-2.5 text-[11.5px] font-medium text-signal-ink transition-colors hover:bg-signal hover:text-sheet"
            >
              Severe spike · 2.40
            </button>
            <button
              onClick={() => handleChange("creatinine_mg_dl", 1, "0.78")}
              className="h-7 border border-edge-2 px-2.5 text-[11.5px] text-ink-2 transition-colors hover:border-ink hover:text-ink"
            >
              Reset · 0.78
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default React.memo(LabSparkline);
