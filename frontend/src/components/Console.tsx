"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { getEncounters, getHealthz, streamAudit } from "@/lib/api";
import {
  analyzeSerialLabs,
  applyPatch,
  flatFlags,
  isValidLabValue,
  resolveSpan,
} from "@/lib/clinical";
import type {
  AuditEvent,
  Encounter,
  GateDecision,
  Guideline,
  Healthz,
  InterceptionVerdict,
  KinematicSlope,
  Phase,
  RunStartEvent,
  ScanFinding,
  StageTrace,
} from "@/lib/types";
import DischargeEditor from "@/components/DischargeEditor";
import LabSparkline from "@/components/LabSparkline";
import ScanViewer from "@/components/ScanViewer";
import TelemetryBar from "@/components/TelemetryBar";

const BenchmarkView = dynamic(() => import("@/components/BenchmarkView"), {
  loading: () => (
    <div className="flex h-full items-center justify-center font-mono text-xs text-slate-400">
      Loading benchmark suite…
    </div>
  ),
});

/** Stable identity for an applied patch (indexes can drift between re-runs). */
function patchKey(v: InterceptionVerdict): string {
  const p = v.discharge_patch;
  return [
    v.kind,
    p.add_follow_up_order?.cpt_code ?? "",
    p.add_prescription?.drug_name ?? "",
    p.remove_drug_name ?? "",
  ].join("|");
}

/** Fixed full-cockpit SVG layer carrying the FR-5.2 animated red-lines. */
function RedlineOverlay({
  verdicts,
  encounter,
  active,
}: {
  verdicts: InterceptionVerdict[];
  encounter: Encounter;
  active: boolean;
}) {
  const [paths, setPaths] = useState<string[]>([]);

  useLayoutEffect(() => {
    if (!active) {
      setPaths([]);
      return;
    }
    let raf = 0;
    const measure = () => {
      const drawn: string[] = [];
      verdicts.forEach((v, i) => {
        const span = resolveSpan(encounter, v);
        if (!span) return;
        const sourceEl = document.getElementById(`hl-${span.pane}-${i}`);
        const targetEl =
          v.kind === "INCIDENTAL_FINDING_DROP"
            ? document.getElementById("orders-anchor")
            : document.getElementById("rx-anchor");
        if (!sourceEl || !targetEl) return;
        const s = sourceEl.getBoundingClientRect();
        const t = targetEl.getBoundingClientRect();
        const x1 = s.right + 14;
        const y1 = s.top + s.height / 2;
        const x2 = t.left - 10;
        const y2 = t.top + Math.min(t.height / 2, 36);
        const dx = (x2 - x1) * 0.45;
        drawn.push(
          `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
        );
      });
      setPaths(drawn);
    };
    const queue = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    queue();
    window.addEventListener("resize", queue, { passive: true });
    window.addEventListener("scroll", queue, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", queue);
      window.removeEventListener("scroll", queue, true);
    };
  }, [active, verdicts, encounter]);

  if (!active || paths.length === 0) return null;
  return (
    <svg className="pointer-events-none fixed inset-0 z-40" aria-hidden>
      {paths.map((d, i) => (
        <g key={i}>
          <path
            d={d}
            fill="none"
            stroke="#FF5A5F"
            strokeOpacity={0.25}
            strokeWidth={8}
            strokeLinecap="round"
          />
          <path
            className="redline-path"
            d={d}
            fill="none"
            stroke="#FF5A5F"
            strokeWidth={2}
          />
        </g>
      ))}
    </svg>
  );
}

export default function Console() {
  const [healthz, setHealthz] = useState<Healthz | null>(null);
  const [fixtures, setFixtures] = useState<Encounter[]>([]);
  const [enc, setEnc] = useState<Encounter | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [runStart, setRunStart] = useState<RunStartEvent | null>(null);
  const [traces, setTraces] = useState<StageTrace[]>([]);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [findings, setFindings] = useState<ScanFinding[]>([]);
  const [, setGate] = useState<GateDecision | null>(null);
  const [guides, setGuides] = useState<Guideline[]>([]);
  const [verdicts, setVerdicts] = useState<InterceptionVerdict[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [slopes, setSlopes] = useState<Record<string, KinematicSlope>>({});
  const [err, setErr] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"cockpit" | "benchmarks">("cockpit");
  const [lastResult, setLastResult] = useState<{ elapsed: number; cost: number } | null>(
    null
  );

  const runToken = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const dirtyRef = useRef(false);
  const appliedRef = useRef<Set<string>>(applied);
  appliedRef.current = applied;
  const encRef = useRef<Encounter | null>(enc);
  encRef.current = enc;

  const startRun = useCallback((doc: Encounter) => {
    const token = ++runToken.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setErr(null);

    setTraces([]);
    setActiveStage(null);
    setFindings([]);
    setGate(null);
    setGuides([]);
    setVerdicts([]);
    setLastResult(null);
    setRunStart(null);
    setPhase("running");

    void streamAudit(
      { encounter_id: doc.encounter_id, encounter: dirtyRef.current ? doc : undefined },
      (evt: AuditEvent) => {
        if (token !== runToken.current) return;
        switch (evt.event) {
          case "run_start":
            setRunStart(evt.data);
            break;
          case "stage_start":
            setActiveStage(evt.data.stage);
            break;
          case "stage_done": {
            const d = evt.data;
            setActiveStage(null);
            setTraces((prev) => {
              if (d.stage === "guideline") {
                const appended: StageTrace[] = [...prev];
                if (d.query_trace) appended.push(d.query_trace);
                if (d.trace) appended.push(d.trace);
                return appended;
              }
              return d.trace ? [...prev, d.trace] : prev;
            });
            if (d.stage === "vision") setFindings(d.findings);
            else if (d.stage === "gate") setGate(d.decision);
            else if (d.stage === "guideline") setGuides(d.guidelines ?? []);
            break;
          }
          case "verdict":
          case "done": {
            const r = evt.data;
            if (r.error) {
              setErr(r.error);
              setPhase("error");
              break;
            }
            setVerdicts(r.verdicts ?? []);
            setLastResult({ elapsed: r.elapsed_ms, cost: r.total_cost_usd });
            if (r.status === "CRITICAL_INTERCEPT") setPhase("intercept");
            else if (r.status === "SILENT_PASS")
              setPhase(appliedRef.current.size > 0 ? "safe" : "pass");
            else {
              setErr(r.status);
              setPhase("error");
            }
            break;
          }
        }
      },
      { signal: controller.signal }
    ).catch((e: unknown) => {
      if (controller.signal.aborted) return;
      setErr(e instanceof Error ? e.message : "audit stream failed");
      setPhase("error");
    });
  }, []);

  // Boot: healthz + fixtures, then a welcome audit run on the first case.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [hl, list] = await Promise.all([getHealthz(), getEncounters()]);
        if (!alive) return;
        setHealthz(hl);
        setFixtures(list);
        if (list.length > 0) {
          const doc = structuredClone(list[0]) as Encounter;
          setEnc(doc);
          setSlopes(analyzeSerialLabs(doc.serial_labs));
          dirtyRef.current = false;
          startRun(doc);
        }
      } catch (e) {
        if (alive) {
          setErr(
            e instanceof Error
              ? e.message
              : "backend unreachable (start uvicorn on :8000)"
          );
          setPhase("error");
        }
      }
    })();
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flags = flatFlags(slopes);

  const selectEncounter = (record: Encounter) => {
    const doc = structuredClone(record) as Encounter;
    runToken.current++;
    abortRef.current?.abort();
    setEnc(doc);
    setSlopes(analyzeSerialLabs(doc.serial_labs));
    setApplied(new Set());
    dirtyRef.current = false;
    startRun(doc);
  };

  // Sandbox edit: instant slope recalc on valid numeric edits only (FR-5.3).
  const editLabValue = useCallback((analyte: string, idx: number, raw: string): string | null => {
    const currentEnc = encRef.current;
    if (!currentEnc) return "No encounter loaded";
    if (!isValidLabValue(analyte, raw)) {
      const bound =
        analyte === "creatinine_mg_dl" ? "0.1–25.0 mg/dL" : "numeric, in range";
      return `rejected — bound ${bound}`;
    }
    const next = structuredClone(currentEnc) as Encounter;
    next.serial_labs[analyte][idx] = {
      ...next.serial_labs[analyte][idx],
      value: Number(raw),
    };
    setEnc(next);
    dirtyRef.current = true;
    setSlopes(analyzeSerialLabs(next.serial_labs));
    return null;
  }, []);

  const editInstructions = useCallback((text: string) => {
    const currentEnc = encRef.current;
    if (!currentEnc) return;
    const next = structuredClone(currentEnc) as Encounter;
    next.draft_discharge_packet.discharge_instructions = text;
    setEnc(next);
    dirtyRef.current = true;
  }, []);

  // One click: mutate the packet in place with the patch, then re-audit (FR-5.2).
  const applyAndRerun = useCallback((verdict: InterceptionVerdict) => {
    const currentEnc = encRef.current;
    if (!currentEnc) return;
    const next = applyPatch(currentEnc, verdict.discharge_patch);
    dirtyRef.current = true;
    setEnc(next);
    setApplied((prev) => new Set(prev).add(patchKey(verdict)));
    setSlopes(analyzeSerialLabs(next.serial_labs));
    startRun(next);
  }, [startRun]);

  const handleRun = useCallback(() => {
    if (encRef.current) startRun(encRef.current);
  }, [startRun]);

  const interceptActive = phase === "intercept" && verdicts.length > 0;
  const safeActive = phase === "safe";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#06070C] text-[#F4F6FA]">
      {/* ------------------------------------------------------ header */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0A0D16]/90 px-4 py-2.5 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          {/* Logo badge with neon glow */}
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#3DE0D0]/20 to-[#FF5A5F]/20 border border-[#3DE0D0]/40 shadow-[0_0_16px_rgba(61,224,208,0.35)]">
              <span className="h-2 w-2 rounded-full bg-[#3DE0D0] animate-pulse shadow-[0_0_8px_#3DE0D0]" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="font-mono text-[14px] font-black tracking-[0.22em] text-white">
                  SILENTCATCH
                </h1>
                <span className="rounded-full bg-[#3DE0D0]/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-[#3DE0D0] border border-[#3DE0D0]/30 shadow-[0_0_10px_rgba(61,224,208,0.2)]">
                  FLIGHT-CHECK
                </span>
              </div>
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8A93A6] leading-none mt-0.5">
                ER Pre-Discharge Safety Interlock
              </p>
            </div>
          </div>

          {/* Tab Toggle: Cockpit vs Model Benchmarks */}
          <div className="flex items-center gap-1 rounded-xl border border-white/12 bg-white/5 p-1 ml-3">
            <button
              onClick={() => setViewTab("cockpit")}
              className={`rounded-lg px-3 py-1 font-mono text-[10px] font-bold tracking-wider transition-all duration-200 ${
                viewTab === "cockpit"
                  ? "bg-[#3DE0D0] text-[#06070C] font-extrabold shadow-[0_0_16px_rgba(61,224,208,0.45)]"
                  : "text-[#8A93A6] hover:text-white"
              }`}
            >
              FLIGHT-CHECK
            </button>
            <button
              onClick={() => setViewTab("benchmarks")}
              className={`rounded-lg px-3 py-1 font-mono text-[10px] font-bold tracking-wider transition-all duration-200 ${
                viewTab === "benchmarks"
                  ? "bg-[#3DE0D0] text-[#06070C] font-extrabold shadow-[0_0_16px_rgba(61,224,208,0.45)]"
                  : "text-[#8A93A6] hover:text-white"
              }`}
            >
              MODEL BENCHMARKS
            </button>
          </div>
        </div>

        {/* Encounter Switcher (all 12 encounters rendered and navigable in Stitch Bed Census style) */}
        {viewTab === "cockpit" && (
          <nav
            className="flex items-center gap-1.5 max-w-[48vw] overflow-x-auto py-1 px-2 scrollbar-none"
            aria-label="Encounter switcher"
          >
            {fixtures.map((record) => {
              const active = enc?.encounter_id === record.encounter_id;
              const isCritical = record.encounter_id === "ED-104" || record.encounter_id === "ED-110" || record.encounter_id === "ED-111" || record.encounter_id === "ED-112";
              const isReview = record.encounter_id === "ED-102";
              return (
                <button
                  key={record.encounter_id}
                  onClick={() => selectEncounter(record)}
                  className={`group shrink-0 rounded-lg border px-2.5 py-1 text-left transition-all duration-150 ${
                    active
                      ? isCritical
                        ? "border-[#FF5A5F] bg-[#FF5A5F]/20 text-[#FF5A5F] shadow-[0_0_16px_rgba(255,90,95,0.4)]"
                        : "border-[#3DE0D0] bg-[#3DE0D0]/15 text-[#3DE0D0] shadow-[0_0_14px_rgba(61,224,208,0.3)]"
                      : "border-white/8 bg-white/5 text-[#8A93A6] hover:border-white/20 hover:text-white hover:bg-white/10"
                  }`}
                  title={`${record.encounter_id}: ${record.chief_complaint} (${record.patient_scenario})`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isCritical
                          ? "bg-[#FF5A5F] shadow-[0_0_8px_#FF5A5F]"
                          : isReview
                          ? "bg-[#FFB84D] shadow-[0_0_8px_#FFB84D]"
                          : "bg-[#3DE0D0] shadow-[0_0_8px_#3DE0D0]"
                      }`}
                    />
                    <span
                      className={`font-mono text-[11px] font-bold ${
                        active
                          ? isCritical ? "text-[#FF5A5F]" : "text-[#3DE0D0]"
                          : "text-[#B9C0CF] group-hover:text-white"
                      }`}
                    >
                      {record.encounter_id}
                    </span>
                    <span className="block max-w-20 truncate text-[9.5px] leading-none text-[#8A93A6]">
                      {record.chief_complaint}
                    </span>
                    <span
                      className={`font-mono text-[8.5px] font-extrabold px-1 py-0.2 rounded ${
                        isCritical
                          ? "bg-[#FF5A5F]/20 text-[#FF5A5F]"
                          : isReview
                          ? "bg-[#FFB84D]/20 text-[#FFB84D]"
                          : "bg-[#3DE0D0]/15 text-[#3DE0D0]"
                      }`}
                    >
                      {isCritical ? "HALT" : isReview ? "ORDERED" : "CLEAR"}
                    </span>
                  </div>
                </button>
              );
            })}
          </nav>
        )}

        {/* Inference status pills & Live Safety Clock */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden xl:flex flex-col items-end pr-2 border-r border-white/10 font-mono text-[9px] text-[#8A93A6]">
            <span className="text-[#F4F6FA] font-bold">SAFETY INTERLOCK ACTIVE</span>
            <span className="text-[#3DE0D0] text-[8.5px]">6 MONITORED ED BEDS</span>
          </div>
          {healthz && (
            <>
              <div className="flex items-center gap-1.5 rounded-full border border-[#3DE0D0]/30 bg-[#3DE0D0]/10 px-3 py-1 shadow-[0_0_12px_rgba(61,224,208,0.2)]">
                <span
                  className={`h-2 w-2 rounded-full ${
                    healthz.inference_mode === "LIVE"
                      ? "bg-[#3DE0D0] shadow-[0_0_8px_#3DE0D0]"
                      : "bg-[#FFB84D] shadow-[0_0_8px_#FFB84D]"
                  }`}
                />
                <span className="font-mono text-[10px] font-bold text-[#3DE0D0]">
                  {healthz.inference_mode}
                </span>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[9px] text-[#8A93A6]">
                tavily: {healthz.tavily_live ? "live" : "snapshot"}
              </span>
            </>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------ error strip */}
      {phase === "error" && err && (
        <div className="shrink-0 border-b border-[#FF5A5F]/40 bg-[#FF5A5F]/15 px-4 py-2 font-mono text-[11.5px] font-semibold text-[#FF5A5F]">
          ✗ FLIGHT-CHECK ERROR — {err}
        </div>
      )}

      {/* ------------------------------------------------------ panes */}
      <main className={`min-h-0 flex-1 overflow-hidden ${viewTab === "benchmarks" ? "block" : "hidden"}`}>
        {viewTab === "benchmarks" && <BenchmarkView />}
      </main>

      <main
        className={`min-h-0 flex-1 grid-cols-[minmax(0,30fr)_minmax(0,27fr)_minmax(0,36fr)] gap-3.5 p-3.5 ${
          viewTab === "cockpit" ? "grid" : "hidden"
        }`}
      >
        {enc && (
          <ScanViewer
            encounter={enc}
            findings={findings}
            verdicts={verdicts}
            interceptActive={interceptActive}
          />
        )}
        {enc && (
          <LabSparkline
            slopes={slopes}
            serialLabs={enc.serial_labs}
            flags={flags}
            onEdit={editLabValue}
            interceptActive={interceptActive}
          />
        )}
        {enc && (
          <DischargeEditor
            encounter={enc}
            phase={phase}
            verdicts={verdicts}
            guides={guides}
            applied={applied}
            lastResult={lastResult}
            onApply={applyAndRerun}
            onEditInstructions={editInstructions}
            onRun={handleRun}
          />
        )}
      </main>

      {/* ------------------------------------------------------ red-lines */}
      {enc && (
        <RedlineOverlay
          verdicts={verdicts}
          encounter={enc}
          active={viewTab === "cockpit" && interceptActive}
        />
      )}

      {/* ------------------------------------------------------ safety banner */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed left-0 right-0 top-14 z-50 flex justify-center"
      >
        {safeActive && lastResult && (
          <div className="safe-flash rounded-2xl border border-[#3DE0D0]/80 bg-[#06070C]/95 px-6 py-2.5 font-mono text-[12px] font-bold tracking-wide text-[#3DE0D0] shadow-[0_0_30px_rgba(61,224,208,0.4)] backdrop-blur-xl">
            VERIFIED SAFE — patched packet re-audited: SILENT_PASS in{" "}
            {lastResult.elapsed}ms · ${lastResult.cost.toFixed(4)}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ telemetry */}
      <TelemetryBar
        phase={phase}
        _runStart={runStart}
        traces={traces}
        activeStage={activeStage}
      />
    </div>
  );
}
