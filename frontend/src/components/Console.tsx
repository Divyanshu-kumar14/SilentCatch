"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Volume2, VolumeX, RotateCcw, HelpCircle } from "lucide-react";

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
import { Mark } from "@/components/Mark";

const BenchmarkView = dynamic(() => import("@/components/BenchmarkView"), {
  loading: () => (
    <div className="flex h-full items-center justify-center text-[13px] text-muted">
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
            stroke="#B0232A"
            strokeOpacity={0.14}
            strokeWidth={6}
            strokeLinecap="round"
          />
          <path
            className="redline-path"
            d={d}
            fill="none"
            stroke="#B0232A"
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
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(true);
  const [lastResult, setLastResult] = useState<{
    elapsed: number;
    cost: number;
    mode: string;
  } | null>(null);

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
            setLastResult({
              elapsed: r.elapsed_ms,
              cost: r.total_cost_usd,
              mode: r.execution_mode || "REPLAYED",
            });
            if (r.status === "CRITICAL_INTERCEPT") {
              setPhase("intercept");
              playCockpitSound("intercept", soundRef.current);
            } else if (r.status === "SILENT_PASS") {
              setPhase(appliedRef.current.size > 0 ? "safe" : "pass");
              playCockpitSound("safe", soundRef.current);
            } else if (r.status === "INCOMPLETE") {
              setErr(
                r.error ??
                  "Audit incomplete — discharge blocked. Required live evidence is missing."
              );
              setPhase("error");
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
      name: "Robert Martinez, 62M",
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
    <div className="flex h-screen flex-col overflow-hidden bg-paper-deep text-ink">
      {/* ───────────────────────────────── top bar ───────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-edge bg-paper pl-4 pr-2.5">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label="SilentCatch home"
          >
            <span className="flex h-8 w-8 items-center justify-center bg-ink">
              <Mark className="h-[18px] w-[18px]" tone="light" />
            </span>
            <h1 className="hidden text-[15px] font-semibold tracking-tight sm:block">
              SilentCatch
            </h1>
          </Link>

          <nav className="flex h-14 items-stretch" aria-label="Console sections">
            {(
              [
                ["cockpit", "Flight-check"],
                ["benchmarks", "Benchmarks"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setViewTab(id)}
                aria-current={viewTab === id ? "page" : undefined}
                className={`relative whitespace-nowrap px-3 text-[13px] transition-colors ${
                  viewTab === id ? "font-medium text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {label}
                {viewTab === id && (
                  <span className="absolute inset-x-3 bottom-0 h-[2px] bg-ink" aria-hidden />
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Provenance is configuration, not a provider call. */}
          <div
            className="hidden items-center gap-2 pr-2 text-[12px] lg:flex"
            title={
              healthz?.live_capable
                ? "NEBIUS_API_KEY is configured. Audits may call the provider; this badge reports configuration, not a completed model call."
                : "No NEBIUS_API_KEY configured. Audits run deterministic replay/seed paths with no provider call."
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                healthz?.live_capable ? "bg-safe" : "bg-edge-2"
              }`}
            />
            <span
              className={`font-medium ${
                healthz?.live_capable ? "text-safe" : "text-muted"
              }`}
            >
              {healthz?.live_capable
                ? "[LIVE — Nebius Token Factory]"
                : "[REPLAY MODE — No API Keys]"}
            </span>
            <span className="text-faint">
              tavily {healthz?.tavily_configured ? "live" : "snapshot"}
            </span>
          </div>

          <button
            onClick={() => setShowGuide(!showGuide)}
            aria-pressed={showGuide}
            className={`hidden h-8 items-center gap-1.5 px-2 text-[12px] transition-colors sm:flex ${
              showGuide
                ? "text-ink underline decoration-signal decoration-1 underline-offset-4"
                : "text-muted hover:text-ink"
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Guide
          </button>

          {viewTab === "cockpit" && (
            <button
              onClick={handleRun}
              disabled={phase === "running"}
              aria-label="Run audit"
              className="flex h-8 items-center gap-2 bg-ink px-3 text-[12px] font-medium text-sheet transition-colors hover:bg-ink-2 disabled:opacity-50"
            >
              <RotateCcw
                className={`h-3.5 w-3.5 ${phase === "running" ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">Run audit</span>
              <kbd className="ml-0.5 hidden border border-white/25 px-1 text-[10px] leading-4 text-sheet/70 sm:inline">
                R
              </kbd>
            </button>
          )}

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            title={soundEnabled ? "Audio alarms enabled [M]" : "Audio muted [M]"}
            aria-label={soundEnabled ? "Mute audio" : "Enable audio"}
            className="flex h-8 w-8 items-center justify-center text-muted transition-colors hover:text-ink"
          >
            {soundEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {/* ─────────────────────────── case rail + guide ─────────────────────────── */}
      {viewTab === "cockpit" && (
        <div className="shrink-0 border-b border-edge bg-paper-deep">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2">
            <span className="label">Cases</span>

            <div className="no-scrollbar flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto py-0.5">
              {fixtures.slice(0, 4).map((record) => {
                const active = enc?.encounter_id === record.encounter_id;
                const isED104 = record.encounter_id === "ED-104";
                const isOrdered = record.encounter_id === "ED-102";
                const status = isED104 ? "contradiction" : isOrdered ? "ordered" : "clean";

                return (
                  <button
                    key={record.encounter_id}
                    onClick={() => selectEncounter(record)}
                    aria-pressed={active}
                    className={`flex h-7 shrink-0 items-center gap-2 whitespace-nowrap border px-2.5 text-[12px] transition-colors ${
                      active
                        ? "border-ink bg-sheet font-medium text-ink"
                        : "border-transparent text-muted hover:border-edge-2 hover:text-ink"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 ${
                        status === "contradiction"
                          ? "bg-signal"
                          : status === "ordered"
                            ? "bg-warn"
                            : "bg-safe"
                      }`}
                      aria-hidden
                    />
                    <span className="tabular">{record.encounter_id}</span>
                    <span
                      className={`text-[10px] uppercase tracking-[0.08em] ${
                        status === "contradiction"
                          ? "text-signal"
                          : status === "ordered"
                            ? "text-warn"
                            : "text-faint"
                      }`}
                    >
                      {status}
                    </span>
                  </button>
                );
              })}

              {fixtures.length > 4 && (
                <select
                  value={
                    fixtures.slice(4).some((f) => f.encounter_id === enc?.encounter_id)
                      ? enc?.encounter_id
                      : ""
                  }
                  onChange={(e) => {
                    const found = fixtures.find((f) => f.encounter_id === e.target.value);
                    if (found) selectEncounter(found);
                  }}
                  aria-label="More cases"
                  className={`h-7 cursor-pointer border bg-transparent px-2 text-[12px] outline-none ${
                    fixtures.slice(4).some((f) => f.encounter_id === enc?.encounter_id)
                      ? "border-ink bg-sheet font-medium text-ink"
                      : "border-transparent text-muted hover:border-edge-2 hover:text-ink"
                  }`}
                >
                  <option value="" disabled>
                    +{fixtures.length - 4} more…
                  </option>
                  {fixtures.slice(4).map((f) => (
                    <option key={f.encounter_id} value={f.encounter_id}>
                      {f.encounter_id} · {f.chief_complaint || "Trauma case"}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {patientStory && (
              <div className="ml-auto hidden min-w-0 items-baseline gap-2.5 text-[12px] lg:flex">
                <span className="font-medium text-ink">{patientStory.name}</span>
                <span className="hidden max-w-[36ch] truncate text-muted xl:inline">
                  {patientStory.problem}
                </span>
                <span
                  className={`shrink-0 font-medium ${
                    patientStory.isCritical ? "text-signal" : "text-safe"
                  }`}
                >
                  {patientStory.outcome}
                </span>
              </div>
            )}
          </div>

          {showGuide && (
            <div className="flex items-start justify-between gap-4 border-t border-edge bg-warn-wash px-4 py-2 text-[12px] leading-[1.5] text-ink-2">
              <p className="max-w-[110ch]">
                <span className="font-medium text-ink">Guide.</span> Open{" "}
                <button
                  onClick={() => {
                    const target = fixtures.find((f) => f.encounter_id === "ED-104");
                    if (target) selectEncounter(target);
                  }}
                  className="font-medium text-signal underline underline-offset-2"
                >
                  ED-104
                </button>{" "}
                to see a missed 7.2 mm nodule and a toxic analgesic collide at the point of
                signature. The verdict is produced by the audit stream — deterministic replay
                offline, live when a provider is configured.
              </p>
              <button
                onClick={() => setShowGuide(false)}
                className="shrink-0 text-[12px] text-muted underline underline-offset-2 hover:text-ink"
              >
                Hide
              </button>
            </div>
          )}
        </div>
      )}

      {/* ────────────────────────────── workstation ────────────────────────────── */}
      {viewTab === "benchmarks" ? (
        <main className="min-h-0 flex-1 overflow-y-auto bg-paper">
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
        <main className="min-h-0 flex-1 overflow-hidden p-2.5">
          {err && (
            <div
              role="alert"
              className="mb-2 flex items-center justify-between gap-4 border border-signal/30 bg-signal-wash px-3 py-2 text-[12px] text-signal-ink"
            >
              <span>{err}</span>
              <button
                onClick={() => setErr(null)}
                className="shrink-0 font-medium underline underline-offset-2"
              >
                Dismiss
              </button>
            </div>
          )}

          {enc ? (
            <div className="sheet-surface grid h-full min-h-0 grid-cols-1 rounded-[10px] overflow-y-auto xl:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)_minmax(0,1.06fr)] xl:overflow-hidden">
              <div className="min-h-[540px] border-b border-edge xl:min-h-0 xl:border-b-0 xl:border-r">
                <ScanViewer
                  encounter={enc}
                  findings={findings}
                  verdicts={verdicts}
                  interceptActive={interceptActive}
                />
              </div>

              <div className="min-h-[540px] border-b border-edge xl:min-h-0 xl:border-b-0 xl:border-r">
                <LabSparkline
                  slopes={slopes}
                  serialLabs={enc.serial_labs}
                  flags={flags}
                  onEdit={editLabValue}
                  interceptActive={interceptActive}
                />
              </div>

              <div className="min-h-[540px] xl:min-h-0">
                <DischargeEditor
                  encounter={enc}
                  phase={phase}
                  verdicts={verdicts}
                  guides={guides}
                  applied={applied}
                  lastResult={lastResult}
                  runMode={runStart?.mode ?? null}
                  onApply={applyAndRerun}
                  onEditInstructions={editInstructions}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-muted">
              Loading encounters…
            </div>
          )}
        </main>
      )}

      {/* ─────────────────────────── redline overlay ─────────────────────────── */}
      {enc && (
        <RedlineOverlay
          verdicts={verdicts}
          encounter={enc}
          active={interceptActive}
        />
      )}

      {/* ──────────────────────────── telemetry ──────────────────────────── */}
      <TelemetryBar
        phase={phase}
        runStart={runStart}
        traces={traces}
        activeStage={activeStage}
      />
    </div>
  );
}
