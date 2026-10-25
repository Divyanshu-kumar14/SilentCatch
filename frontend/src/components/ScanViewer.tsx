"use client";

import React, { useEffect, useMemo, useState } from "react";

import { API_BASE } from "@/lib/api";
import { resolveSpan } from "@/lib/clinical";
import type { Encounter, InterceptionVerdict, ScanFinding } from "@/lib/types";
import ThreeDVolumeViewer from "@/components/ThreeDVolumeViewer";

/**
 * Bounding boxes for the FR-5.1 Key-Slice Viewer.
 * Coordinates match the realistic medical scan generator.
 */
const ROI: Record<string, { cx: number; cy: number; ring: number; label: string }> = {
  "ED-102": { cx: 120, cy: 150, ring: 48, label: "RLL Consolidation (Infiltrate)" },
  "ED-104": { cx: 170, cy: 90, ring: 28, label: "7.2mm Spiculated RUL Nodule (Slice #42)" },
  "ED-110": { cx: 160, cy: 140, ring: 38, label: "2.8cm Left Adrenal Mass" },
  "ED-111": { cx: 110, cy: 130, ring: 56, label: "Cardiomegaly / CHF Congestion" },
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
          className="rounded-[3px] bg-rose-500/20 px-1 py-0.5 font-semibold text-rose-300 outline outline-1 outline-rose-500/70 shadow-[0_0_12px_rgba(244,63,94,0.3)]"
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
        return "contrast(1.45) brightness(1.15)";
      case "bone":
        return "contrast(1.85) brightness(0.92)";
      case "invert":
        return "invert(1) contrast(1.3)";
      default:
        return "contrast(1.15) brightness(1.05)";
    }
  }, [windowPreset]);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-slate-950/80 backdrop-blur-md shadow-2xl overflow-hidden">
      {/* Pane Header — Must include 'RADIOLOGY · KEY-SLICE' for test-phase3 suite */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/60 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]" />
          <h2 className="font-mono text-[11px] font-bold tracking-[0.16em] text-slate-200">
            RADIOLOGY · KEY-SLICE
          </h2>
          <span className="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-sky-400 border border-sky-500/20">
            {encounter.radiology_study.modality}
          </span>
        </div>

        {/* 2D / 3D Mode Switcher */}
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/90 p-0.5">
          <button
            onClick={() => setViewMode("2d")}
            className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold transition-all ${
              viewMode === "2d"
                ? "bg-sky-500 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            2D SCAN
          </button>
          <button
            onClick={() => setViewMode("3d")}
            className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold transition-all ${
              viewMode === "3d"
                ? "bg-sky-500 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            3D VOLUME
          </button>
        </div>
      </header>

      {/* Primary Viewport Area */}
      <div className="shrink-0 border-b border-white/10 p-3">
        {encounter.radiology_study.slice_image_url ? (
          viewMode === "3d" ? (
            <ThreeDVolumeViewer encounter={encounter} roi={roi} />
          ) : (
            <div className="flex flex-col gap-2">
              <figure className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-lg border border-white/10 bg-black shadow-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${API_BASE}${encounter.radiology_study.slice_image_url}`}
                  alt={`${encounter.radiology_study.modality} diagnostic image for ${encounter.encounter_id}`}
                  width={256}
                  height={256}
                  fetchPriority="high"
                  decoding="async"
                  style={{ filter: filterStyle }}
                  className="aspect-square w-full object-cover transition-[filter] duration-200 [image-rendering:crisp-edges]"
                />

                {/* DICOM Overlays (Patient demographics & orientation labels) */}
                <div className="pointer-events-none absolute inset-2 flex flex-col justify-between font-mono text-[9px] text-slate-300 drop-shadow-md">
                  <div className="flex justify-between">
                    <span>{encounter.encounter_id} · {encounter.patient_scenario}</span>
                    <span>SL: 42/64</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>R (Right)</span>
                    <span>L (Left)</span>
                  </div>
                  <div className="flex justify-between text-[8px] text-slate-400">
                    <span>FOV: 350mm</span>
                    <span>W/L: {windowPreset.toUpperCase()}</span>
                  </div>
                </div>

                {/* ROI Caliper Ring with glowing pulse */}
                {roi ? (
                  <>
                    <div
                      className={`absolute rounded-full border-2 border-rose-500 bg-rose-500/10 shadow-[0_0_18px_rgba(244,63,94,0.6)] ${
                        interceptActive && findings.length > 0 ? "animate-pulse" : ""
                      }`}
                      style={{
                        left: `${((roi.cx - roi.ring) / 256) * 100}%`,
                        top: `${((roi.cy - roi.ring) / 256) * 100}%`,
                        width: `${((roi.ring * 2) / 256) * 100}%`,
                        height: `${((roi.ring * 2) / 256) * 100}%`,
                      }}
                      aria-hidden
                    >
                      {/* Crosshairs */}
                      <span className="absolute left-1/2 top-0 h-full w-[1px] -translate-x-1/2 bg-rose-400/50" />
                      <span className="absolute top-1/2 left-0 h-[1px] w-full -translate-y-1/2 bg-rose-400/50" />
                    </div>

                    <div
                      className="absolute rounded bg-rose-950/90 border border-rose-500/50 px-1.5 py-0.5 font-mono text-[8px] font-bold text-rose-300 backdrop-blur-sm"
                      style={{
                        left: `${(roi.cx / 256) * 100}%`,
                        top: `${((roi.cy + roi.ring + 4) / 256) * 100}%`,
                        transform: "translateX(-50%)",
                      }}
                    >
                      {roi.label}
                    </div>
                  </>
                ) : (
                  <figcaption className="absolute bottom-1.5 left-1.5 rounded border border-white/10 bg-slate-900/80 px-1.5 py-0.5 font-mono text-[8px] tracking-wider text-slate-400">
                    CLEAN FILM — NO ANNOTATED LESION
                  </figcaption>
                )}
              </figure>

              {/* DICOM Window/Level Preset Buttons */}
              <div className="flex items-center justify-center gap-1.5 pt-1">
                <span className="font-mono text-[9px] text-slate-500 mr-1">Window:</span>
                {(["standard", "lung", "bone", "invert"] as const).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setWindowPreset(preset)}
                    className={`rounded px-2 py-0.5 font-mono text-[9.5px] font-medium transition-colors ${
                      windowPreset === preset
                        ? "bg-slate-700 text-sky-400 border border-sky-400/40"
                        : "bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-white/5"
                    }`}
                  >
                    {preset.charAt(0).toUpperCase() + preset.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          <p className="font-mono text-[10px] text-slate-400 text-center py-4">No diagnostic scan image on file</p>
        )}

        {/* Scan Findings List */}
        {findings.length > 0 && (
          <ul className="mt-2.5 flex flex-col gap-1 border-t border-white/5 pt-2">
            {findings.map((f: ScanFinding, i: number) => (
              <li key={i} className="flex items-baseline gap-2 font-mono text-[10px]">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    f.acute ? "bg-rose-500 shadow-[0_0_8px_#f43f5e]" : "bg-sky-400 shadow-[0_0_8px_#38bdf8]"
                  }`}
                />
                <span className="font-medium text-slate-200">{f.description}</span>
                {f.measurement_mm != null && (
                  <span className="font-bold text-sky-400">Ø{f.measurement_mm}mm</span>
                )}
                {f.recommended_cpt && (
                  <span className="text-slate-400">CPT {f.recommended_cpt}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Radiology Full Report Text Area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3" data-testid="report-scroll">
        <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
          <h3 className="font-mono text-[10px] font-bold tracking-[0.16em] text-slate-400">
            RADIOLOGY REPORT TEXT
          </h3>
          {interceptActive && spanMeta && (
            <span className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-rose-400 border border-rose-500/30">
              Verified Span [{spanMeta.start_char}–{spanMeta.end_char}] · {spanMeta.match_mode}
            </span>
          )}
        </div>

        <p className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-slate-300">
          {interceptActive ? renderWithHighlights(report, reportHls) : report}
        </p>

        {labNote && (
          <div className="mt-4 border-t border-white/5 pt-3">
            <h3 className="font-mono text-[10px] font-bold tracking-[0.16em] text-slate-400">
              CLINICAL LAB NOTE
            </h3>
            <p className="mt-1.5 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-slate-300">
              {interceptActive ? renderWithHighlights(labNote, labHls) : labNote}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default React.memo(ScanViewer);
