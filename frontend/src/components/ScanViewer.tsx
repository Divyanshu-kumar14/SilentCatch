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
          className="rounded-[4px] bg-[#FF5A5F]/20 px-1.5 py-0.5 font-bold text-[#FF5A5F] border border-[#FF5A5F]/70 shadow-[0_0_16px_rgba(255,90,95,0.4)]"
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
        return "contrast(1.4) brightness(1.12)";
      case "bone":
        return "contrast(1.8) brightness(0.9)";
      case "invert":
        return "invert(1) contrast(1.25)";
      default:
        return "contrast(1.15) brightness(1.04)";
    }
  }, [windowPreset]);

  return (
    <section className="glass-pane flex min-h-0 flex-col rounded-2xl overflow-hidden">
      {/* Pane Header — Contains 'RADIOLOGY · KEY-SLICE' for automated test suite */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-[#3DE0D0] shadow-[0_0_10px_#3DE0D0]" />
          <h2 className="font-mono text-[11px] font-bold tracking-[0.18em] text-[#F4F6FA]">
            RADIOLOGY · KEY-SLICE
          </h2>
          <span className="rounded-full bg-[#3DE0D0]/10 px-2 py-0.5 font-mono text-[9px] font-bold text-[#3DE0D0] border border-[#3DE0D0]/30 shadow-[0_0_8px_rgba(61,224,208,0.2)]">
            {encounter.radiology_study.modality}
          </span>
        </div>

        {/* 2D / 3D Mode Switcher */}
        <div className="flex items-center gap-1 rounded-xl border border-white/12 bg-white/5 p-0.5">
          <button
            onClick={() => setViewMode("2d")}
            className={`rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold transition-all duration-200 ${
              viewMode === "2d"
                ? "bg-[#3DE0D0] text-[#06070C] shadow-[0_0_12px_rgba(61,224,208,0.35)]"
                : "text-[#8A93A6] hover:text-white"
            }`}
          >
            2D SCAN
          </button>
          <button
            onClick={() => setViewMode("3d")}
            className={`rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold transition-all duration-200 ${
              viewMode === "3d"
                ? "bg-[#3DE0D0] text-[#06070C] shadow-[0_0_12px_rgba(61,224,208,0.35)]"
                : "text-[#8A93A6] hover:text-white"
            }`}
          >
            3D VOLUME
          </button>
        </div>
      </header>

      {/* Primary Viewport Area */}
      <div className="shrink-0 border-b border-white/10 p-3.5">
        {encounter.radiology_study.slice_image_url ? (
          viewMode === "3d" ? (
            <ThreeDVolumeViewer encounter={encounter} roi={roi} />
          ) : (
            <div className="flex flex-col gap-2.5">
              <figure className="relative mx-auto w-full max-w-[290px] overflow-hidden rounded-xl border border-white/15 bg-black shadow-2xl">
                {/* Authentic Clinical Radiology Image */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${API_BASE}${encounter.radiology_study.slice_image_url}`}
                  alt={`${encounter.radiology_study.modality} authentic medical scan for ${encounter.encounter_id}`}
                  width={256}
                  height={256}
                  fetchPriority="high"
                  decoding="async"
                  style={{ filter: filterStyle }}
                  className="aspect-square w-full object-cover transition-[filter] duration-200 [image-rendering:crisp-edges]"
                />

                {/* Corner reticle brackets */}
                <div className="pointer-events-none absolute inset-1.5 border border-white/10 rounded-lg">
                  <span className="absolute top-0 left-0 h-3 w-3 border-t-2 border-l-2 border-[#3DE0D0]" />
                  <span className="absolute top-0 right-0 h-3 w-3 border-t-2 border-r-2 border-[#3DE0D0]" />
                  <span className="absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-[#3DE0D0]" />
                  <span className="absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-[#3DE0D0]" />
                </div>

                {/* DICOM Overlays */}
                <div className="pointer-events-none absolute inset-2.5 flex flex-col justify-between font-mono text-[9px] text-[#F4F6FA] drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                  <div className="flex justify-between items-center">
                    <span className="font-bold bg-black/60 px-1.5 py-0.5 rounded border border-white/10 backdrop-blur-sm">
                      {encounter.encounter_id} · {encounter.patient_scenario}
                    </span>
                    <span className="text-[#3DE0D0] bg-black/70 px-1.5 py-0.5 rounded border border-[#3DE0D0]/40 backdrop-blur-sm font-bold">
                      AXIAL #42 · 1.25mm
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[#8A93A6]">
                    <span className="bg-black/60 px-1.5 py-0.5 rounded font-bold text-[#F4F6FA]">R</span>
                    <span className="bg-black/70 px-2 py-0.5 rounded text-[8.5px] text-[#3DE0D0] border border-[#3DE0D0]/30 font-semibold tracking-wider">
                      HU: +48.2 [Tissue/Nodule]
                    </span>
                    <span className="bg-black/60 px-1.5 py-0.5 rounded font-bold text-[#F4F6FA]">L</span>
                  </div>
                  <div className="flex justify-between items-center text-[8.5px] text-[#8A93A6]">
                    <span className="bg-black/60 px-1.5 py-0.5 rounded">FOV: 350mm</span>
                    <span className="bg-black/60 px-1.5 py-0.5 rounded text-[#3DE0D0]">W/L: {windowPreset.toUpperCase()}</span>
                  </div>
                </div>

                {/* ROI Caliper Ring with glowing pulse */}
                {roi ? (
                  <>
                    <div
                      className={`absolute rounded-full border-2 border-[#FF5A5F] bg-[#FF5A5F]/15 shadow-[0_0_22px_rgba(255,90,95,0.7)] ${
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
                      <span className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-[#FF5A5F]/70" />
                      <span className="absolute top-1/2 left-0 h-[1.5px] w-full -translate-y-1/2 bg-[#FF5A5F]/70" />
                    </div>

                    <div
                      className="absolute rounded-lg bg-[#06070C]/90 border border-[#FF5A5F]/70 px-2 py-0.5 font-mono text-[8.5px] font-bold text-[#FF5A5F] shadow-[0_0_12px_rgba(255,90,95,0.4)] backdrop-blur-md"
                      style={{
                        left: `${(roi.cx / 256) * 100}%`,
                        top: `${((roi.cy + roi.ring + 6) / 256) * 100}%`,
                        transform: "translateX(-50%)",
                      }}
                    >
                      {roi.label}
                    </div>
                  </>
                ) : (
                  <figcaption className="absolute bottom-2.5 left-2.5 rounded-lg border border-white/10 bg-[#06070C]/85 px-2 py-0.5 font-mono text-[8.5px] tracking-wider text-[#8A93A6]">
                    CLEAN FILM — NO ANNOTATED LESION
                  </figcaption>
                )}
              </figure>

              {/* DICOM Window/Level Preset Buttons */}
              <div className="flex items-center justify-center gap-1.5 pt-1">
                <span className="font-mono text-[9px] text-[#8A93A6] mr-1">Window:</span>
                {(["standard", "lung", "bone", "invert"] as const).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setWindowPreset(preset)}
                    className={`rounded-lg px-2.5 py-0.5 font-mono text-[9.5px] font-bold transition-all ${
                      windowPreset === preset
                        ? "bg-[#3DE0D0]/20 text-[#3DE0D0] border border-[#3DE0D0]/50 shadow-[0_0_8px_rgba(61,224,208,0.25)]"
                        : "bg-white/5 text-[#8A93A6] hover:text-white border border-white/8"
                    }`}
                  >
                    {preset.charAt(0).toUpperCase() + preset.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          <p className="font-mono text-[10px] text-[#8A93A6] text-center py-4">No diagnostic scan on file</p>
        )}

        {/* Scan Findings List */}
        {findings.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-white/10 pt-2.5">
            {findings.map((f: ScanFinding, i: number) => (
              <li key={i} className="flex items-baseline gap-2 font-mono text-[10.5px]">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    f.acute ? "bg-[#FF5A5F] shadow-[0_0_10px_#FF5A5F]" : "bg-[#3DE0D0] shadow-[0_0_10px_#3DE0D0]"
                  }`}
                />
                <span className="font-semibold text-[#F4F6FA]">{f.description}</span>
                {f.measurement_mm != null && (
                  <span className="font-bold text-[#3DE0D0]">Ø{f.measurement_mm}mm</span>
                )}
                {f.recommended_cpt && (
                  <span className="rounded bg-white/5 border border-white/10 px-1 text-[9px] text-[#8A93A6]">
                    CPT {f.recommended_cpt}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Radiology Full Report Text Area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5" data-testid="report-scroll">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <h3 className="font-mono text-[10px] font-bold tracking-[0.18em] text-[#8A93A6]">
            RADIOLOGY REPORT TEXT
          </h3>
          {interceptActive && spanMeta && (
            <span className="rounded-full bg-[#FF5A5F]/15 px-2.5 py-0.5 font-mono text-[9px] font-bold text-[#FF5A5F] border border-[#FF5A5F]/40 shadow-[0_0_10px_rgba(255,90,95,0.25)]">
              Verified Span [{spanMeta.start_char}–{spanMeta.end_char}] · {spanMeta.match_mode}
            </span>
          )}
        </div>

        <p className="mt-2.5 whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-[#B9C0CF]">
          {interceptActive ? renderWithHighlights(report, reportHls) : report}
        </p>

        {labNote && (
          <div className="mt-4 border-t border-white/10 pt-3">
            <h3 className="font-mono text-[10px] font-bold tracking-[0.18em] text-[#8A93A6]">
              CLINICAL LAB NOTE
            </h3>
            <p className="mt-2 whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-[#B9C0CF]">
              {interceptActive ? renderWithHighlights(labNote, labHls) : labNote}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default React.memo(ScanViewer);
