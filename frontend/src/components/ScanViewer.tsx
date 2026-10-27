"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Layers,
  ZoomIn,
  ZoomOut,
  Scan,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

import { API_BASE } from "@/lib/api";
import { resolveSpan } from "@/lib/clinical";
import type { Encounter, InterceptionVerdict, ScanFinding } from "@/lib/types";
import ThreeDVolumeViewer from "@/components/ThreeDVolumeViewer";

/**
 * Bounding boxes for the FR-5.1 Key-Slice Viewer.
 */
const ROI: Record<string, { cx: number; cy: number; width: number; height: number; label: string; plainDesc: string }> = {
  "ED-102": {
    cx: 120,
    cy: 150,
    width: 72,
    height: 60,
    label: "RLL Consolidation (Pneumonia)",
    plainDesc: "Lung infection area. Follow-up CT already scheduled by physician.",
  },
  "ED-104": {
    cx: 170,
    cy: 90,
    width: 44,
    height: 44,
    label: "7.2mm Spiculated Lung Nodule",
    plainDesc: "⚠️ Potential early lung tumor! Requires 6-month follow-up CT (CPT 71250) to rule out malignancy.",
  },
  "ED-110": {
    cx: 160,
    cy: 140,
    width: 56,
    height: 50,
    label: "2.8cm Left Adrenal Mass",
    plainDesc: "Incidental adrenal tumor needing endocrine referral.",
  },
  "ED-111": {
    cx: 110,
    cy: 130,
    width: 84,
    height: 70,
    label: "Cardiomegaly (Enlarged Heart)",
    plainDesc: "Fluid congestion in heart requiring cardiology follow-up.",
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
          className="rounded px-1.5 py-0.5 font-medium text-rose-300 bg-rose-500/25 border border-rose-500/50 shadow-sm"
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
  const [windowPreset, setWindowPreset] = useState<"standard" | "lung" | "bone" | "invert">("standard");
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

  // Live HU estimation
  const liveHU = useMemo(() => {
    if (!mousePos.active) return "+46.2 HU [Tissue]";
    if (roi) {
      const dist = Math.hypot(mousePos.x - roi.cx, mousePos.y - roi.cy);
      if (dist < 40) {
        return `+${Math.round(45 + (1 - dist / 40) * 15)}.0 HU [Nodule]`;
      }
    }
    const val = Math.round(((mousePos.x + mousePos.y) / 512) * 200 - 100);
    return `${val >= 0 ? "+" : ""}${val}.0 HU`;
  }, [mousePos, roi]);

  return (
    <section className="glass-pane flex h-full min-h-0 flex-col rounded-2xl overflow-hidden border border-white/[0.08] shadow-2xl">
      {/* ----------------- HEADER ----------------- */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-slate-900/60 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
            <Scan className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight text-white">
                RADIOLOGY · KEY-SLICE
              </h2>
              <span className="rounded bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-xs font-semibold text-sky-300">
                1. Vision Input
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {encounter.radiology_study.modality}
            </p>
          </div>
        </div>

        {/* 2D / 3D Toggle */}
        {isCT ? (
          <div className="flex items-center rounded-lg border border-white/10 bg-slate-950/60 p-0.5">
            <button
              onClick={() => setViewMode("2d")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                viewMode === "2d"
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm font-semibold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              2D Scan
            </button>
            <button
              onClick={() => setViewMode("3d")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                viewMode === "3d"
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm font-semibold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Layers className="h-3 w-3" />
              3D Volume
            </button>
          </div>
        ) : (
          <span className="rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1 text-xs font-medium text-slate-400">
            2D Radiograph
          </span>
        )}
      </header>

      {/* ----------------- SCAN VIEWPORT ----------------- */}
      <div className="flex shrink-0 flex-col border-b border-white/[0.08] bg-slate-950/90 p-4">
        {encounter.radiology_study.slice_image_url ? (
          viewMode === "3d" ? (
            <ThreeDVolumeViewer
              encounter={encounter}
              roi={roi ? { cx: roi.cx, cy: roi.cy, ring: Math.max(roi.width, roi.height) / 2 } : undefined}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {/* Scan Frame */}
              <div
                className="group relative flex h-52 w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black shadow-inner"
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
                {/* Laser Scanline during active phase */}
                {interceptActive && <div className="laser-scan-line" />}

                {/* Corner Medical Markers */}
                <div className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 border-l-2 border-t-2 border-slate-600" />
                <div className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 border-r-2 border-t-2 border-slate-600" />
                <div className="pointer-events-none absolute bottom-2.5 left-2.5 h-3.5 w-3.5 border-b-2 border-l-2 border-slate-600" />
                <div className="pointer-events-none absolute bottom-2.5 right-2.5 h-3.5 w-3.5 border-b-2 border-r-2 border-slate-600" />

                {/* Orientation Markers */}
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-slate-400">
                  R
                </span>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-slate-400">
                  L
                </span>
                <span className="pointer-events-none absolute top-2.5 left-1/2 -translate-x-1/2 font-mono text-xs font-bold text-slate-400">
                  S
                </span>
                <span className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 font-mono text-xs font-bold text-slate-400">
                  I
                </span>

                {/* DICOM Scan Image */}
                <Image
                  src={`${API_BASE}${encounter.radiology_study.slice_image_url}`}
                  alt="Radiology Study Scan"
                  width={256}
                  height={256}
                  unoptimized
                  className="max-h-full max-w-full object-contain transition-transform duration-300"
                  style={{
                    filter: filterStyle,
                    transform: `scale(${zoomLevel})`,
                  }}
                />

                {/* Clinical Finding Bounding Reticle */}
                {roi && (
                  <div
                    className="absolute transition-all duration-300 cursor-pointer pointer-events-auto"
                    style={{
                      left: `${(roi.cx / 256) * 100}%`,
                      top: `${(roi.cy / 256) * 100}%`,
                      transform: "translate(-50%, -50%)",
                      width: `${(roi.width / 256) * 100}%`,
                      height: `${(roi.height / 256) * 100}%`,
                    }}
                  >
                    <div
                      className={`h-full w-full rounded border-2 transition-colors ${
                        interceptActive
                          ? "border-rose-500 bg-rose-500/15 shadow-lg shadow-rose-950/40"
                          : "border-sky-400 bg-sky-400/15 shadow-lg shadow-sky-950/40"
                      }`}
                    >
                      <div className="absolute -top-1.5 -left-1.5 h-2 w-2 border-l-2 border-t-2 border-white" />
                      <div className="absolute -top-1.5 -right-1.5 h-2 w-2 border-r-2 border-t-2 border-white" />
                      <div className="absolute -bottom-1.5 -left-1.5 h-2 w-2 border-l-2 border-b-2 border-white" />
                      <div className="absolute -bottom-1.5 -right-1.5 h-2 w-2 border-r-2 border-b-2 border-white" />
                    </div>

                    {/* Intuitive Finding Pill */}
                    <div
                      className={`absolute top-full left-1/2 -translate-x-1/2 mt-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold shadow-lg backdrop-blur-md transition-all ${
                        interceptActive
                          ? "bg-rose-950/95 text-rose-200 border border-rose-500/50"
                          : "bg-slate-900/95 text-sky-200 border border-sky-500/50"
                      }`}
                    >
                      {roi.label}
                    </div>
                  </div>
                )}

                {/* Clean Context Overlays */}
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 text-xs font-medium text-slate-300">
                  <span className="rounded bg-black/70 px-2 py-0.5 border border-white/15 font-bold text-white shadow">
                    {encounter.encounter_id}
                  </span>
                  <span className="text-slate-300 font-medium">
                    {encounter.radiology_study.modality.split(",")[0]}
                  </span>
                </div>

                {isCT && (
                  <div className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-2 font-mono text-xs text-slate-400">
                    <span className="rounded bg-black/70 px-2 py-0.5 border border-white/10 text-sky-300 font-semibold shadow">
                      {liveHU}
                    </span>
                  </div>
                )}
              </div>

              {/* Viewport Control Bar */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-400 mr-1">Window:</span>
                  {(["standard", "lung", "bone", "invert"] as const).map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setWindowPreset(preset)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                        windowPreset === preset
                          ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold"
                          : "bg-white/5 text-slate-400 hover:text-white border border-white/5"
                      }`}
                    >
                      {preset.charAt(0).toUpperCase() + preset.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Zoom */}
                <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
                  <button
                    onClick={() => setZoomLevel((z) => Math.max(1, z - 0.5))}
                    title="Zoom Out"
                    className="p-1 rounded text-slate-400 hover:text-white transition-colors"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <span className="font-mono text-xs text-sky-400 px-1.5 font-semibold">
                    {zoomLevel}x
                  </span>
                  <button
                    onClick={() => setZoomLevel((z) => Math.min(2, z + 0.5))}
                    title="Zoom In"
                    className="p-1 rounded text-slate-400 hover:text-white transition-colors"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )
        ) : (
          <p className="text-xs text-slate-400 text-center py-8">No diagnostic scan on file</p>
        )}
      </div>

      {/* ----------------- REPORT & EXTRACTED FINDINGS ----------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4" data-testid="report-scroll">
        {/* Structured Findings List with Plain English Explanations */}
        {findings.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider flex items-center justify-between">
              <span>Identified Scan Findings</span>
              <span className="text-slate-400 normal-case font-normal text-xs">
                {findings.length} extracted
              </span>
            </h3>
            <div className="flex flex-col gap-2">
              {findings.map((f: ScanFinding, i: number) => (
                <div
                  key={i}
                  className={`flex items-start justify-between gap-3 rounded-xl border p-2.5 text-xs transition-colors ${
                    f.acute
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                      : "border-white/5 bg-slate-900/40 text-slate-200"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {f.acute ? (
                      <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-semibold block">{f.description}</span>
                      {f.acute && (
                        <p className="text-xs text-rose-300/90 mt-0.5">
                          ⚠️ Needs follow-up order in discharge packet!
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {f.measurement_mm != null && (
                      <span className="font-mono text-xs font-bold text-sky-300 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-800/40">
                        Ø{f.measurement_mm}mm
                      </span>
                    )}
                    {f.recommended_cpt && (
                      <span className="font-mono rounded bg-white/5 border border-white/10 px-2 py-0.5 text-xs text-slate-300">
                        CPT {f.recommended_cpt}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
          <h3 className="text-xs font-bold tracking-wider text-slate-300 uppercase">
            RADIOLOGY REPORT TEXT
          </h3>
          {interceptActive && spanMeta && (
            <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-300 border border-rose-500/30">
              Verified Span [{spanMeta.start_char}–{spanMeta.end_char}]
            </span>
          )}
        </div>

        <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-300 font-normal">
          {interceptActive ? renderWithHighlights(report, reportHls) : report}
        </p>

        {labNote && (
          <div className="mt-4 border-t border-white/[0.08] pt-3">
            <h3 className="text-xs font-bold tracking-wider text-slate-300 uppercase">
              CLINICAL LAB NOTE
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-300 font-normal">
              {interceptActive ? renderWithHighlights(labNote, labHls) : labNote}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default React.memo(ScanViewer);
