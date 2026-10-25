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
    <div className="flex h-full items-center justify-center font-mono text-xs text-slate-500">
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
            stroke="#f43f5e"
            strokeOpacity={0.25}
            strokeWidth={8}
            strokeLinecap="round"
          />
          <path
            className="redline-path"
            d={d}
            fill="none"
            stroke="#f43f5e"
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
        if (token !== runToken.current) return; // superseded by a newer run
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
              : "backend unreachable (start uvicorn on :8014)"
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
    runToken.current++; // invalidate any in-flight stream listener first
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
    <div className="flex h-screen flex-col overflow-hidden bg-[#070a0f] text-slate-100">
      {/* ------------------------------------------------------ header */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/90 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          {/* Logo badge */}
          <div className="flex items-center gap-2">
            <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/15 border border-sky-400/40 shadow-[0_0_12px_rgba(56,189,248,0.3)]">
              <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="font-mono text-[13px] font-black tracking-[0.2em] text-white">
                  SILENTCATCH
                </h1>
                <span className="rounded bg-sky-500/10 px-1.5 py-0.2 font-mono text-[9px] font-bold uppercase tracking-wider text-sky-400 border border-sky-500/20">
                  COPILOT
                </span>
              </div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-slate-400 leading-none">
                ER Pre-Discharge Flight-Check
              </p>
            </div>
          </div>

          {/* Tab Toggle: Cockpit vs Model Benchmarks */}
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/80 p-0.5 ml-2">
            <button
              onClick={() => setViewTab("cockpit")}
              className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider transition-all ${
                viewTab === "cockpit"
                  ? "bg-sky-500 text-slate-950 shadow-[0_0_12px_rgba(56,189,248,0.35)]"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              FLIGHT-CHECK
            </button>
            <button
              onClick={() => setViewTab("benchmarks")}
              className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider transition-all ${
                viewTab === "benchmarks"
                  ? "bg-sky-500 text-slate-950 shadow-[0_0_12px_rgba(56,189,248,0.35)]"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              MODEL BENCHMARKS
            </button>
          </div>
        </div>

        {/* Encounter Switcher (all 12 encounters rendered, key ones easily visible) */}
        {viewTab === "cockpit" && (
          <nav
            className="flex items-center gap-1.5 max-w-[50vw] overflow-x-auto py-0.5 px-2 scrollbar-none"
            aria-label="Encounter switcher"
          >
            {fixtures.map((record) => {
              const active = enc?.encounter_id === record.encounter_id;
              return (
                <button
                  key={record.encounter_id}
                  onClick={() => selectEncounter(record)}
                  className={`group shrink-0 rounded-lg border px-2.5 py-1 text-left transition-all ${
                    active
                      ? "border-sky-400/60 bg-sky-500/15 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.2)]"
                      : "border-white/5 bg-slate-900/50 text-slate-400 hover:border-white/15 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                  title={`${record.encounter_id}: ${record.chief_complaint} (${record.patient_scenario})`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`font-mono text-[11px] font-bold ${
                        active ? "text-sky-300" : "text-slate-300 group-hover:text-white"
                      }`}
                    >
                      {record.encounter_id}
                    </span>
                    <span className="block max-w-20 truncate text-[9.5px] leading-none text-slate-400">
                      {record.chief_complaint}
                    </span>
                  </div>
                </button>
              );
            })}
          </nav>
        )}

        {/* Inference status pills */}
        <div className="flex shrink-0 items-center gap-2">
          {healthz && (
            <>
              <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/80 px-2.5 py-1">
                <span
                  className={`h-2 w-2 rounded-full ${
                    healthz.inference_mode === "LIVE"
                      ? "bg-emerald-400 shadow-[0_0_8px_#10b981]"
                      : "bg-amber-400 shadow-[0_0_8px_#f59e0b]"
                  }`}
                />
                <span className="font-mono text-[10px] font-bold text-slate-200">
                  {healthz.inference_mode}
                </span>
              </div>
              <span className="rounded-lg border border-white/5 bg-slate-900/60 px-2 py-1 font-mono text-[9.5px] text-slate-400">
                tavily: {healthz.tavily_live ? "live" : "snapshot"}
              </span>
            </>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------ error strip */}
      {phase === "error" && err && (
        <div className="shrink-0 border-b border-rose-500/40 bg-rose-950/40 px-4 py-2 font-mono text-[11.5px] font-semibold text-rose-300">
          ✗ FLIGHT-CHECK ERROR — {err}
        </div>
      )}

      {/* ------------------------------------------------------ panes */}
      <main className={`min-h-0 flex-1 overflow-hidden ${viewTab === "benchmarks" ? "block" : "hidden"}`}>
        {viewTab === "benchmarks" && <BenchmarkView />}
      </main>

      <main
        className={`min-h-0 flex-1 grid-cols-[minmax(0,30fr)_minmax(0,27fr)_minmax(0,36fr)] gap-3 p-3 ${
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
          <div className="safe-flash rounded-xl border border-emerald-500/70 bg-slate-950/90 px-5 py-2 font-mono text-[11.5px] font-bold tracking-wide text-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.3)] backdrop-blur-md">
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
