"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";

import { API_BASE } from "@/lib/api";
import { resolveSpan } from "@/lib/clinical";
import type { Encounter, InterceptionVerdict, ScanFinding } from "@/lib/types";
import ThreeDVolumeViewer from "@/components/ThreeDVolumeViewer";

/**
 * Bounding boxes for the FR-5.1 Key-Slice Viewer.
 * Coordinates are in the 256-space the fixtures were authored in.
 */
const ROI: Record<
  string,
  { cx: number; cy: number; width: number; height: number; label: string; plainDesc: string }
> = {
  "ED-102": {
    cx: 120,
    cy: 150,
    width: 72,
    height: 60,
    label: "RLL consolidation",
    plainDesc: "Lung infection area. Follow-up CT already scheduled by the physician.",
  },
  "ED-104": {
    cx: 170,
    cy: 90,
    width: 44,
    height: 44,
    label: "7.2 mm spiculated nodule",
    plainDesc:
      "Potential early lung tumour. Requires a 6-month follow-up CT (CPT 71250) to rule out malignancy.",
  },
  "ED-110": {
    cx: 160,
    cy: 140,
    width: 56,
    height: 50,
    label: "2.8 cm left adrenal mass",
    plainDesc: "Incidental adrenal tumour needing an endocrine referral.",
  },
  "ED-111": {
    cx: 110,
    cy: 130,
    width: 84,
    height: 70,
    label: "Cardiomegaly",
    plainDesc: "Enlarged heart with fluid congestion, requiring cardiology follow-up.",
  },
};

interface Highlight {
  start: number;
  end: number;
  idx: number;
}

function renderWithHighlights(
  text: string,
  highlights: Array<Highlight & { pane: "report" | "lab_note" }>
) {
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((h, i) => {
    if (h.start > cursor) nodes.push(<span key={`t${i}`}>{text.slice(cursor, h.start)}</span>);
    if (h.start >= cursor && h.end > cursor) {
      nodes.push(
        <mark
          key={`h${i}`}
          id={`hl-${h.pane}-${h.idx}`}
          className="rounded-[2px] bg-signal-wash px-0.5 text-signal-ink shadow-[inset_0_-1.5px_0_rgb(var(--signal))]"
        >
          {text.slice(h.start, h.end)}
        </mark>
      );
      cursor = h.end;
    }
  });
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>);
  return nodes;
}

function ScanViewer({
  encounter,
  findings,
  verdicts,
  interceptActive,
}: {
  encounter: Encounter;
  findings: ScanFinding[];
  verdicts: InterceptionVerdict[];
  interceptActive: boolean;
}) {
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [windowPreset, setWindowPreset] = useState<"standard" | "lung" | "bone" | "invert">(
    "standard"
  );
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [mousePos, setMousePos] = useState<{ x: number; y: number; active: boolean }>({
    x: 128,
    y: 128,
    active: false,
  });

  const report = encounter.radiology_study.report_text;
  const labNote = encounter.lab_note?.text ?? "";

  const { highlights, reportHls, labHls } = useMemo(() => {
    const out: Array<Highlight & { pane: "report" | "lab_note" }> = [];
    const rep: Array<Highlight & { pane: "report" | "lab_note" }> = [];
    const lab: Array<Highlight & { pane: "report" | "lab_note" }> = [];
    if (!interceptActive) return { highlights: out, reportHls: rep, labHls: lab };
    verdicts.forEach((v, idx) => {
      const span = resolveSpan(encounter, v);
      if (!span) return;
      const item = {
        pane: span.pane,
        start: v.verified_span.start_char,
        end: v.verified_span.end_char,
        idx,
      };
      out.push(item);
      if (item.pane === "report") rep.push(item);
      else lab.push(item);
    });
    return { highlights: out, reportHls: rep, labHls: lab };
  }, [encounter, verdicts, interceptActive]);

  const spanMeta = highlights.length > 0 ? verdicts[highlights[0].idx]?.verified_span : null;

  useEffect(() => {
    if (highlights.length === 0) return;
    document
      .getElementById(`hl-${highlights[0].pane}-${highlights[0].idx}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [interceptActive, highlights]);

  const roi = ROI[encounter.encounter_id];

  const filterStyle = useMemo(() => {
    switch (windowPreset) {
      case "lung":
        return "contrast(1.4) brightness(1.15)";
      case "bone":
        return "contrast(1.8) brightness(0.9)";
      case "invert":
        return "invert(1) contrast(1.2)";
      default:
        return "contrast(1.15) brightness(1.05)";
    }
  }, [windowPreset]);

  const isCT = encounter.radiology_study.modality.toLowerCase().includes("ct");

  const liveHU = useMemo(() => {
    if (!mousePos.active) return "+46.2 HU";
    if (roi) {
      const dist = Math.hypot(mousePos.x - roi.cx, mousePos.y - roi.cy);
      if (dist < 40) {
        return `+${Math.round(45 + (1 - dist / 40) * 15)}.0 HU`;
      }
    }
    const val = Math.round(((mousePos.x + mousePos.y) / 512) * 200 - 100);
    return `${val >= 0 ? "+" : ""}${val}.0 HU`;
  }, [mousePos, roi]);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Radiology key slice">
      {/* ── column head ─────────────────────────────────────────────── */}
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-edge px-4">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="text-[13px] font-medium text-ink">Vision</h2>
          <span className="truncate text-[12px] text-muted">
            {encounter.radiology_study.modality}
          </span>
        </div>

        {isCT ? (
          <div className="flex shrink-0 items-center border border-edge" role="group">
            {(
              [
                ["2d", "2D"],
                ["3d", "3D"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setViewMode(id)}
                aria-pressed={viewMode === id}
                className={`h-6 px-2.5 text-[11px] transition-colors ${
                  viewMode === id
                    ? "bg-ink text-sheet"
                    : "text-muted hover:bg-sheet-2 hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <span className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-faint">
            Radiograph
          </span>
        )}
      </header>

      {/* ── imaging chamber ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-edge p-2.5">
        {encounter.radiology_study.slice_image_url ? (
          viewMode === "3d" ? (
            <ThreeDVolumeViewer
              encounter={encounter}
              roi={
                roi
                  ? { cx: roi.cx, cy: roi.cy, ring: Math.max(roi.width, roi.height) / 2 }
                  : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              <div
                className="chamber film-grain group relative flex h-[248px] w-full items-center justify-center overflow-hidden"
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMousePos({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    active: true,
                  });
                }}
                onMouseLeave={() => setMousePos((p) => ({ ...p, active: false }))}
              >
                {interceptActive && <div className="scanline" aria-hidden />}

                {/* film edge + orientation */}
                <div className="pointer-events-none absolute inset-0 z-10 border border-white/10" />
                <span className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-[11px] text-night-muted">
                  R
                </span>
                <span className="pointer-events-none absolute right-2 top-1/2 z-10 -translate-y-1/2 text-[11px] text-night-muted">
                  L
                </span>
                <span className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 text-[11px] text-night-muted">
                  S
                </span>
                <span className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 text-[11px] text-night-muted">
                  I
                </span>

                <Image
                  src={`${API_BASE}${encounter.radiology_study.slice_image_url}`}
                  alt={`Radiology key slice for ${encounter.encounter_id}`}
                  width={256}
                  height={256}
                  unoptimized
                  className="max-h-full max-w-full object-contain transition-transform duration-300"
                  style={{
                    filter: filterStyle,
                    transform: `scale(${zoomLevel})`,
                  }}
                />

                {/* finding reticle */}
                {roi && (
                  <div
                    className="absolute z-20 transition-all duration-300"
                    style={{
                      left: `${(roi.cx / 256) * 100}%`,
                      top: `${(roi.cy / 256) * 100}%`,
                      transform: "translate(-50%, -50%)",
                      width: `${(roi.width / 256) * 100}%`,
                      height: `${(roi.height / 256) * 100}%`,
                    }}
                  >
                    <div
                      className={`relative h-full w-full border ${
                        interceptActive
                          ? "border-signal bg-signal/15"
                          : "border-night-ink/60 bg-night-ink/5"
                      }`}
                    >
                      <span
                        className={`absolute -left-px -top-px h-1.5 w-1.5 border-l border-t ${
                          interceptActive ? "border-signal" : "border-night-ink"
                        }`}
                      />
                      <span
                        className={`absolute -right-px -top-px h-1.5 w-1.5 border-r border-t ${
                          interceptActive ? "border-signal" : "border-night-ink"
                        }`}
                      />
                      <span
                        className={`absolute -bottom-px -left-px h-1.5 w-1.5 border-b border-l ${
                          interceptActive ? "border-signal" : "border-night-ink"
                        }`}
                      />
                      <span
                        className={`absolute -bottom-px -right-px h-1.5 w-1.5 border-b border-r ${
                          interceptActive ? "border-signal" : "border-night-ink"
                        }`}
                      />
                      {interceptActive && (
                        <span className="pulse-ring absolute inset-0 border border-signal/70" />
                      )}
                    </div>

                    <div
                      className={`absolute left-0 top-full mt-1.5 whitespace-nowrap px-1.5 py-0.5 text-[11px] ${
                        interceptActive
                          ? "bg-signal text-sheet"
                          : "bg-night-ink text-night"
                      }`}
                    >
                      {roi.label}
                    </div>
                  </div>
                )}

                {/* film metadata */}
                <div className="pointer-events-none absolute inset-x-2.5 top-2.5 z-10 flex items-start justify-between gap-2">
                  <span className="mono text-[11px] text-night-ink/70">
                    {encounter.encounter_id}
                  </span>
                  {isCT && (
                    <span className="mono text-[11px] text-night-ink/70">{liveHU}</span>
                  )}
                </div>
              </div>

              {/* window / zoom */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-0.5" role="group" aria-label="Window preset">
                  {(["standard", "lung", "bone", "invert"] as const).map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setWindowPreset(preset)}
                      aria-pressed={windowPreset === preset}
                      className={`h-6 px-2 text-[11px] capitalize transition-colors ${
                        windowPreset === preset
                          ? "bg-sheet-2 font-medium text-ink"
                          : "text-muted hover:text-ink"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setZoomLevel((z) => Math.max(1, z - 0.5))}
                    title="Zoom out"
                    className="h-6 px-1.5 text-[11px] text-muted transition-colors hover:text-ink disabled:opacity-40"
                    disabled={zoomLevel <= 1}
                  >
                    −
                  </button>
                  <span className="mono w-7 text-center text-[11px] text-ink-2">
                    {zoomLevel}×
                  </span>
                  <button
                    onClick={() => setZoomLevel((z) => Math.min(2, z + 0.5))}
                    title="Zoom in"
                    className="h-6 px-1.5 text-[11px] text-muted transition-colors hover:text-ink disabled:opacity-40"
                    disabled={zoomLevel >= 2}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )
        ) : (
          <p className="py-10 text-center text-[12px] text-muted">No diagnostic scan on file</p>
        )}
      </div>

      {/* ── findings + report ───────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-testid="report-scroll">
        {findings.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <h3 className="label">Extracted findings</h3>
              <span className="mono text-[11px] text-faint">{findings.length}</span>
            </div>

            <ul className="border-t border-edge">
              {findings.map((f: ScanFinding, i: number) => {
                const fired = f.acute && interceptActive;
                return (
                <li
                  key={i}
                  className="flex items-start justify-between gap-3 border-b border-edge py-2"
                >
                  <div className="min-w-0">
                    <p
                      className={`text-[13px] leading-[1.45] ${
                        fired ? "font-medium text-signal-ink" : "text-ink-2"
                      }`}
                    >
                      {f.description}
                    </p>
                    {f.acute && (
                      <p
                        className={`mt-0.5 text-[11.5px] ${
                          fired ? "text-signal" : "text-muted"
                        }`}
                      >
                        {fired ? "Unresolved in the packet" : "Acute, already addressed"}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-baseline gap-2">
                    {f.measurement_mm != null && (
                      <span className="mono text-[11.5px] text-ink-2">
                        {f.measurement_mm} mm
                      </span>
                    )}
                    {f.recommended_cpt && (
                      <span className="mono text-[11.5px] text-muted">
                        CPT {f.recommended_cpt}
                      </span>
                    )}
                  </div>
                </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <h3 className="label">Radiology report</h3>
          {interceptActive && spanMeta && (
            <span className="mono text-[11px] text-signal">
              verified [{spanMeta.start_char}–{spanMeta.end_char}]
            </span>
          )}
        </div>

        <p className="whitespace-pre-wrap text-[13px] leading-[1.65] text-ink-2">
          {interceptActive ? renderWithHighlights(report, reportHls) : report}
        </p>

        {labNote && (
          <div className="mt-4 border-t border-edge pt-3">
            <h3 className="label mb-1.5">Clinical lab note</h3>
            <p className="whitespace-pre-wrap text-[13px] leading-[1.65] text-ink-2">
              {interceptActive ? renderWithHighlights(labNote, labHls) : labNote}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default React.memo(ScanViewer);
