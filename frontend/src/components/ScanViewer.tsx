"use client";

import { useEffect, useMemo } from "react";

import { API_BASE } from "@/lib/api";
import { resolveSpan } from "@/lib/clinical";
import type { Encounter, InterceptionVerdict, ScanFinding } from "@/lib/types";

/**
 * Bounding boxes for the FR-5.1 Key-Slice Viewer.
 * Coordinates are NOT invented: they mirror the deterministic fixture generator
 * (backend/fixtures/generate_images.py) which draws each lesion at a seeded
 * position with an annotation ring at radius+24 on the 256×256 canvas. Films
 * the generator leaves clean show an honest "no annotated ROI" note instead.
 */
const ROI: Record<string, { cx: number; cy: number; ring: number }> = {
  "ED-102": { cx: 120, cy: 150, ring: 50 }, // r=26 consolidation + 24 ring
  "ED-104": { cx: 170, cy: 90, ring: 28 }, // r=4 nodule + 24 ring
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
          className="rounded-[2px] bg-intercept/15 px-0.5 font-semibold text-text outline outline-1 outline-intercept/70"
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

export default function ScanViewer({
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
  const report = encounter.radiology_study.report_text;
  const labNote = encounter.lab_note?.text ?? "";

  const highlights = useMemo(() => {
    const out: Array<Highlight & { pane: "report" | "lab_note" }> = [];
    if (!interceptActive) return out;
    verdicts.forEach((v, idx) => {
      const span = resolveSpan(encounter, v);
      if (!span) return;
      out.push({
        pane: span.pane,
        start: v.verified_span.start_char,
        end: v.verified_span.end_char,
        idx,
      });
    });
    return out;
  }, [encounter, verdicts, interceptActive]);

  // Round-trip proof: the offsets the guard produced must slice back to the
  // quote in exactly one pane. Mismatches never happen on stream truth; if a
  // future run violated that, we'd still render, just without the highlight.
  const reportHls = highlights.filter((h) => h.pane === "report");
  const labHls = highlights.filter((h) => h.pane === "lab_note");
  const spanMeta =(highlights.length > 0
    ? verdicts[highlights[0].idx]?.verified_span
    : null);

  // Bring the first red-line anchor into view once the verdict lands.
  useEffect(() => {
    if (highlights.length === 0) return;
    document
      .getElementById(`hl-${highlights[0].pane}-${highlights[0].idx}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interceptActive]);

  const roi = ROI[encounter.encounter_id];

  return (
    <section className="flex min-h-0 flex-col border border-border bg-pane">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.2em] text-text-dim">
          RADIOLOGY · KEY-SLICE
        </h2>
        <span className="font-mono text-[9px] text-text-faint">
          {encounter.radiology_study.modality}
        </span>
      </header>

      <div className="shrink-0 border-b border-border px-3 pb-2 pt-3">
        {encounter.radiology_study.slice_image_url ? (
          <figure className="relative mx-auto w-full max-w-[300px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${API_BASE}${encounter.radiology_study.slice_image_url}`}
              alt={`Synthetic ${encounter.radiology_study.modality} key slice for ${encounter.encounter_id}`}
              width={256}
              height={256}
              className="w-full bg-[#0d1218] [image-rendering:pixelated]"
            />
            {roi ? (
              <div
                className={`absolute border border-live bg-live/5 ${
                  interceptActive && findings.length > 0 ? "roi-pulse outline outline-1 outline-live/60" : ""
                }`}
                style={{
                  left: `${((roi.cx - roi.ring) / 256) * 100}%`,
                  top: `${((roi.cy - roi.ring) / 256) * 100}%`,
                  width: `${((roi.ring * 2) / 256) * 100}%`,
                  height: `${((roi.ring * 2) / 256) * 100}%`,
                }}
                aria-hidden
              />
            ) : (
              <figcaption className="absolute bottom-1.5 left-1.5 border border-border bg-bg/80 px-1.5 py-0.5 font-mono text-[8px] tracking-wider text-text-faint">
                CLEAN FILM — NO ANNOTATED ROI
              </figcaption>
            )}
          </figure>
        ) : (
          <p className="font-mono text-[10px] text-text-faint">no key-slice image on file</p>
        )}

        {findings.length > 0 && (
          <ul className="mt-2.5 flex flex-col gap-1">
            {findings.map((f: ScanFinding, i: number) => (
              <li key={i} className="flex items-baseline gap-1.5 font-mono text-[10px]">
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    f.acute ? "bg-intercept" : "bg-live-dim"
                  }`}
                />
                <span className="text-text">{f.description}</span>
                {f.measurement_mm != null && (
                  <span className="text-live">Ø{f.measurement_mm}mm</span>
                )}
                {f.recommended_cpt && (
                  <span className="text-text-faint">CPT {f.recommended_cpt}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" data-testid="report-scroll">
        <h3 className="font-mono text-[9px] tracking-[0.2em] text-text-faint">
          FULL REPORT TEXT
          {interceptActive && spanMeta && (
            <span className="ml-2 text-intercept">
              span {spanMeta.start_char}–{spanMeta.end_char} · {spanMeta.match_mode}
            </span>
          )}
        </h3>
        <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-text-dim">
          {interceptActive
            ? renderWithHighlights(report, reportHls)
            : report}
        </p>

        {labNote && (
          <>
            <h3 className="mt-3.5 font-mono text-[9px] tracking-[0.2em] text-text-faint">
              LAB NOTE
            </h3>
            <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-text-dim">
              {interceptActive ? renderWithHighlights(labNote, labHls) : labNote}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
