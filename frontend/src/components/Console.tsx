"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Volume2,
  VolumeX,
  RotateCcw,
  Activity,
  HelpCircle,
  Info,
  User,
} from "lucide-react";

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
    <div className="flex h-full items-center justify-center text-xs text-slate-400">
      Loading benchmark suite…
    </div>
  ),
});

/** Web Audio API self-contained clinical cockpit sound synthesizer */
function playCockpitSound(type: "intercept" | "safe" | "click" | "step", enabled: boolean) {
  if (!enabled || typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (type === "intercept") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.35);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } else if (type === "safe") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.42);
    }
  } catch {
    // Non-blocking on browser autoplay policy
  }
}

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
            : document.getElementById("rx-anchor") || document.getElementById("orders-anchor");
        if (!sourceEl || !targetEl) return;
        const s = sourceEl.getBoundingClientRect();
        const t = targetEl.getBoundingClientRect();
        const x1 = s.right + 12;
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
            stroke="#F43F5E"
            strokeOpacity={0.15}
            strokeWidth={6}
            strokeLinecap="round"
          />
          <path
            className="redline-path"
            d={d}
            fill="none"
            stroke="#F43F5E"
            strokeWidth={2}
          />
        </g>
      ))}
    </svg>
  );
}

export default function Console() {
  const [, setHealthz] = useState<Healthz | null>(null);
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
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(true);
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
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

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
            if (r.status === "CRITICAL_INTERCEPT") {
              setPhase("intercept");
              playCockpitSound("intercept", soundRef.current);
            } else if (r.status === "SILENT_PASS") {
              setPhase(appliedRef.current.size > 0 ? "safe" : "pass");
              playCockpitSound("safe", soundRef.current);
            } else {
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
  }, [startRun]);

  const flags = flatFlags(slopes);

  const selectEncounter = useCallback((record: Encounter) => {
    const doc = structuredClone(record) as Encounter;
    runToken.current++;
    abortRef.current?.abort();
    setEnc(doc);
    setSlopes(analyzeSerialLabs(doc.serial_labs));
    setApplied(new Set());
    dirtyRef.current = false;
    startRun(doc);
  }, [startRun]);

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

  // Global Keyboard Shortcuts (FR-5.3 & Cockpit Ergonomics)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (encRef.current) startRun(encRef.current);
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setSoundEnabled((s) => !s);
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setViewTab((t) => (t === "cockpit" ? "benchmarks" : "cockpit"));
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (fixtures[idx]) {
          e.preventDefault();
          selectEncounter(fixtures[idx]);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fixtures, selectEncounter, startRun]);

  const interceptActive = phase === "intercept" && verdicts.length > 0;

  // Plain-English Patient Story Mapping for Non-Medical Judges
  const patientStory = enc ? {
    "ED-101": {
      name: "Alex Carter, 28M",
      problem: "Ankle sprain during basketball.",
      situation: "Routine injury. Clean X-ray, normal labs. Doctor prescribed safe rest & ibuprofen.",
      outcome: "Silent Pass — No collisions. Safe to discharge immediately.",
      isCritical: false,
    },
    "ED-102": {
      name: "Maria Santos, 54F",
      problem: "Pneumonia with 6mm lung nodule.",
      situation: "Incidental nodule detected, BUT the doctor already remembered to order a 6-month chest CT.",
      outcome: "Silent Pass — Good clinical handoff already in place.",
      isCritical: false,
    },
    "ED-103": {
      name: "David Chen, 42M",
      problem: "Passed kidney stone (renal colic).",
      situation: "Kidney labs are recovering back to baseline. Pain is managed without toxic collisions.",
      outcome: "Silent Pass — Improving trajectory. Safe for home recovery.",
      isCritical: false,
    },
    "ED-104": {
      name: "Robert Martinez, 48M",
      problem: "Bicycle crash with chest pain.",
      situation: "DANGER: Doctor missed a 7.2mm lung nodule AND prescribed Toradol while kidneys are silently failing!",
      outcome: phase === "safe"
        ? "VERIFIED SAFE — Both omissions remediated. Discharge unlocked!"
        : "CRITICAL INTERCEPT — Discharge BLOCKED until safe CT ordered & toxic drug swapped.",
      isCritical: phase !== "safe",
    },
  }[enc.encounter_id] || {
    name: enc.encounter_id,
    problem: enc.chief_complaint,
    situation: enc.patient_scenario,
    outcome: interceptActive ? "Critical Collision Intercepted" : "Verified Clean",
    isCritical: interceptActive,
  } : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-slate-100 font-sans">
      {/* ------------------------------------------------------ 1. TOP HEADER ------------------------------------------------------ */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-slate-950/90 px-6 py-2.5 backdrop-blur-xl">
        {/* Brand & Concept */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 shadow-md shadow-indigo-500/20">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">
                  SILENTCATCH
                </h1>
                <span className="rounded-md bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-xs font-semibold text-sky-400">
                  Pre-Discharge Safety Interlock
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Pre-discharge collision interlock & clinical handoff verification
              </p>
            </div>
          </div>

          {/* Navigation Pill (Cockpit vs Benchmarks) */}
          <div className="flex items-center rounded-xl border border-white/10 bg-slate-900/80 p-0.5 ml-2">
            <button
              onClick={() => setViewTab("cockpit")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                viewTab === "cockpit"
                  ? "bg-sky-500 text-slate-950 font-bold shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              FLIGHT-CHECK
            </button>
            <button
              onClick={() => setViewTab("benchmarks")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                viewTab === "benchmarks"
                  ? "bg-sky-500 text-slate-950 font-bold shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              MODEL BENCHMARKS
            </button>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {/* Judge / Non-Medical Explainer Toggle */}
          <button
            onClick={() => setShowGuide(!showGuide)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
              showGuide
                ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
                : "border-white/10 bg-slate-900/60 text-slate-400 hover:text-white"
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5 text-sky-400" />
            <span>Judge Guide: {showGuide ? "ON" : "OFF"}</span>
          </button>

          {/* Run Audit */}
          {viewTab === "cockpit" && (
            <button
              onClick={handleRun}
              disabled={phase === "running"}
              className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all active:scale-95"
            >
              <RotateCcw className={`h-3.5 w-3.5 text-sky-400 ${phase === "running" ? "animate-spin" : ""}`} />
              <span>Run Audit</span>
              <kbd className="rounded bg-black/40 px-1.5 py-0.5 text-xs text-slate-400 border border-white/10">
                R
              </kbd>
            </button>
          )}

          {/* Sound Mute */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            title={soundEnabled ? "Audio Alarms Enabled [M]" : "Audio Muted [M]"}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
              soundEnabled
                ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                : "border-white/5 bg-slate-900/60 text-slate-400 hover:text-white"
            }`}
          >
            {soundEnabled ? (
              <Volume2 className="h-3.5 w-3.5 text-sky-400" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
            <span>{soundEnabled ? "Sound ON" : "MUTED"}</span>
            <kbd className="rounded bg-black/40 px-1 py-0.5 text-xs text-slate-500">
              M
            </kbd>
          </button>

          {/* Token Factory Live Pill */}
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-semibold">TOKEN FACTORY LIVE</span>
            <span className="text-xs text-emerald-400/80">tavily: live</span>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------ 2. JUDGE STORY & PATIENT SELECTOR STRIP ------------------------------------------------------ */}
      {viewTab === "cockpit" && (
        <div className="shrink-0 border-b border-white/[0.08] bg-slate-950/70 px-6 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Patient Selector Tabs */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">
                Patients:
              </span>
              {/* Primary 4 Benchmark Cases */}
              {fixtures.slice(0, 4).map((record) => {
                const active = enc?.encounter_id === record.encounter_id;
                const isED104 = record.encounter_id === "ED-104";
                const isOrdered = record.encounter_id === "ED-102";

                return (
                  <button
                    key={record.encounter_id}
                    onClick={() => selectEncounter(record)}
                    className={`group relative flex items-center gap-2 rounded-xl border px-3 py-1.5 transition-all ${
                      active
                        ? isED104
                          ? "border-rose-500 bg-rose-500/20 text-white shadow-md shadow-rose-950/40 ring-1 ring-rose-500/50"
                          : "border-sky-500 bg-sky-500/20 text-white shadow-md shadow-sky-950/40 ring-1 ring-sky-500/50"
                        : "border-white/10 bg-slate-900/60 text-slate-400 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        isED104
                          ? "bg-rose-500"
                          : isOrdered
                            ? "bg-amber-400"
                            : "bg-emerald-400"
                      }`}
                    />
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs">
                        {record.encounter_id}
                      </span>
                      {isED104 ? (
                        <span className="rounded bg-rose-500 px-1.5 py-0.2 text-[10px] font-extrabold text-slate-950 uppercase tracking-tight">
                          ⭐ JUDGE DEMO
                        </span>
                      ) : (
                        <span
                          className={`rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase ${
                            isOrdered
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {isOrdered ? "ORDERED" : "CLEAR"}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Overflow Archive Dropdown */}
              {fixtures.length > 4 && (
                <div className="relative">
                  <select
                    value={fixtures.slice(4).some((f) => f.encounter_id === enc?.encounter_id) ? enc?.encounter_id : ""}
                    onChange={(e) => {
                      const found = fixtures.find((f) => f.encounter_id === e.target.value);
                      if (found) selectEncounter(found);
                    }}
                    className={`rounded-xl border px-2.5 py-1.5 text-xs font-medium outline-none transition-all cursor-pointer ${
                      fixtures.slice(4).some((f) => f.encounter_id === enc?.encounter_id)
                        ? "border-sky-500 bg-sky-500/20 text-white font-bold"
                        : "border-white/10 bg-slate-900/60 text-slate-400 hover:text-white hover:border-white/20"
                    }`}
                  >
                    <option value="" disabled className="bg-slate-900 text-slate-400">
                      + {fixtures.length - 4} More Cases…
                    </option>
                    {fixtures.slice(4).map((f) => (
                      <option key={f.encounter_id} value={f.encounter_id} className="bg-slate-900 text-slate-200">
                        {f.encounter_id} · {f.chief_complaint || "Trauma Case"}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Current Patient Story in Plain English - Always Visible */}
            {patientStory && (
              <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-slate-900/90 px-4 py-1.5 text-xs shadow-sm">
                <div className="flex items-center gap-2 text-slate-300">
                  <User className="h-4 w-4 text-sky-400 shrink-0" />
                  <span className="font-bold text-white">{patientStory.name}:</span>
                  <span className="text-slate-300">{patientStory.problem}</span>
                </div>
                <div className="h-3.5 w-px bg-white/10" />
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Status:</span>
                  <span
                    className={`font-bold ${
                      patientStory.isCritical ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {patientStory.outcome}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Optional Judge Explainer Banner */}
          {showGuide && (
            <div className="mt-2.5 rounded-xl border border-sky-500/20 bg-sky-950/30 p-2.5 text-xs text-sky-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-sky-400 shrink-0" />
                <span>
                  <strong>Judges Guide:</strong> Click <strong>ED-104 (⭐ Judge Demo)</strong> to see SilentCatch block a dangerous discharge where a doctor missed an early lung tumor and prescribed a toxic painkiller to a patient with failing kidneys.
                </span>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="text-xs text-sky-400 hover:text-white underline shrink-0 font-medium"
              >
                Got it, hide guide
              </button>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------ 3. MAIN WORKSTATION BODY ------------------------------------------------------ */}
      {viewTab === "benchmarks" ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <BenchmarkView
            onSelectEncounter={(encounterId) => {
              const target = fixtures.find((f) => f.encounter_id === encounterId);
              if (target) {
                selectEncounter(target);
                setViewTab("cockpit");
              }
            }}
          />
        </main>
      ) : (
        <main className="min-h-0 flex-1 p-5 overflow-hidden">
          {err && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
              <span>{err}</span>
              <button
                onClick={() => setErr(null)}
                className="text-xs font-bold text-rose-300 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {enc ? (
            <div className="grid h-full grid-cols-12 gap-5 min-h-0">
              {/* Column 1: Key-Slice & Radiology (4 cols) */}
              <div className="col-span-4 h-full min-h-0">
                <ScanViewer
                  encounter={enc}
                  findings={findings}
                  verdicts={verdicts}
                  interceptActive={interceptActive}
                />
              </div>

              {/* Column 2: 48-Hour Lab Velocity (4 cols) */}
              <div className="col-span-4 h-full min-h-0">
                <LabSparkline
                  slopes={slopes}
                  serialLabs={enc.serial_labs}
                  flags={flags}
                  onEdit={editLabValue}
                  interceptActive={interceptActive}
                />
              </div>

              {/* Column 3: Discharge Packet & Safety Interlock (4 cols) */}
              <div className="col-span-4 h-full min-h-0">
                <DischargeEditor
                  encounter={enc}
                  phase={phase}
                  verdicts={verdicts}
                  guides={guides}
                  applied={applied}
                  lastResult={lastResult}
                  onApply={applyAndRerun}
                  onEditInstructions={editInstructions}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">
              Loading encounters…
            </div>
          )}
        </main>
      )}

      {/* ------------------------------------------------------ REDLINE OVERLAY ------------------------------------------------------ */}
      {enc && (
        <RedlineOverlay
          verdicts={verdicts}
          encounter={enc}
          active={interceptActive}
        />
      )}

      {/* ------------------------------------------------------ 4. CONNECTED TELEMETRY FOOTER ------------------------------------------------------ */}
      <TelemetryBar
        phase={phase}
        runStart={runStart}
        traces={traces}
        activeStage={activeStage}
      />
    </div>
  );
}
