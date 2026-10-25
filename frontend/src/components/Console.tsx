"use client";

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
    window.addEventListener("resize", queue);
    window.addEventListener("scroll", queue, true);
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
            stroke="#ff4d5e"
            strokeOpacity={0.3}
            strokeWidth={7}
            strokeLinecap="round"
          />
          <path
            className="redline-path"
            d={d}
            fill="none"
            stroke="#ff4d5e"
            strokeWidth={1.6}
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
  const [lastResult, setLastResult] = useState<{ elapsed: number; cost: number } | null>(
    null
  );

  const runToken = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const dirtyRef = useRef(false);
  const appliedRef = useRef<Set<string>>(applied);
  appliedRef.current = applied;

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
  const editLabValue = (analyte: string, idx: number, raw: string): string | null => {
    if (!enc) return "No encounter loaded";
    if (!isValidLabValue(analyte, raw)) {
      const bound =
        analyte === "creatinine_mg_dl" ? "0.1–25.0 mg/dL" : "numeric, in range";
      return `rejected — bound ${bound}`;
    }
    const next = structuredClone(enc) as Encounter;
    next.serial_labs[analyte][idx] = {
      ...next.serial_labs[analyte][idx],
      value: Number(raw),
    };
    setEnc(next);
    dirtyRef.current = true;
    setSlopes(analyzeSerialLabs(next.serial_labs));
    return null;
  };

  const editInstructions = (text: string) => {
    if (!enc) return;
    const next = structuredClone(enc) as Encounter;
    next.draft_discharge_packet.discharge_instructions = text;
    setEnc(next);
    dirtyRef.current = true;
  };

  // One click: mutate the packet in place with the patch, then re-audit (FR-5.2).
  const applyAndRerun = (verdict: InterceptionVerdict) => {
    if (!enc) return;
    const next = applyPatch(enc, verdict.discharge_patch);
    dirtyRef.current = true;
    setEnc(next);
    setApplied((prev) => new Set(prev).add(patchKey(verdict)));
    setSlopes(analyzeSerialLabs(next.serial_labs));
    startRun(next);
  };

  const interceptActive = phase === "intercept" && verdicts.length > 0;
  const safeActive = phase === "safe";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-text">
      {/* ------------------------------------------------------ header */}
      <header className="flex shrink-0 items-center gap-4 border-b border-border bg-pane px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h1 className="font-mono text-[13px] font-semibold tracking-[0.18em] text-text">
            SILENTCATCH
          </h1>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-faint">
            ER Pre-Discharge Flight-Check
          </span>
        </div>

        <nav className="flex items-center gap-1" aria-label="Encounter switcher">
          {fixtures.map((record) => {
            const active = enc?.encounter_id === record.encounter_id;
            return (
              <button
                key={record.encounter_id}
                onClick={() => selectEncounter(record)}
                className={`group rounded-sm border px-2 py-0.5 text-left transition-colors ${
                  active
                    ? "border-border-strong bg-pane-raised"
                    : "border-transparent hover:border-border hover:bg-pane"
                }`}
                title={`${record.encounter_id}: ${record.chief_complaint} (${record.patient_scenario})`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`font-mono text-[11px] font-semibold ${
                      active ? "text-live" : "text-text-dim group-hover:text-text"
                    }`}
                  >
                    {record.encounter_id}
                  </span>
                  <span className="block max-w-28 truncate text-[9px] leading-none text-text-faint">
                    {record.chief_complaint}
                  </span>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          {healthz && (
            <>
              <span
                className={`rounded-sm border border-border bg-pane-raised px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider ${
                  healthz.inference_mode === "LIVE" ? "text-live" : "text-warn"
                }`}
              >
                {healthz.inference_mode}
              </span>
              <span className="font-mono text-[10px] text-text-faint">
                tavily: {healthz.tavily_live ? "live" : "snapshot"}
              </span>
            </>
          )}
          {runStart?.mode_note && (
            <span
              className="max-w-48 truncate font-mono text-[9.5px] text-text-faint"
              title={runStart.mode_note}
            >
              {runStart.mode_note}
            </span>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------ error strip */}
      {phase === "error" && err && (
        <div className="shrink-0 border-b border-intercept-dim bg-pane px-4 py-1.5 font-mono text-[11px] text-intercept">
          ✗ FLIGHT-CHECK ERROR — {err}
        </div>
      )}

      {/* ------------------------------------------------------ panes */}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,29fr)_minmax(0,26fr)_minmax(0,37fr)] gap-2.5 p-2.5">
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
            onRun={() => enc && startRun(enc)}
          />
        )}
      </main>

      {/* ------------------------------------------------------ red-lines */}
      {enc && (
        <RedlineOverlay verdicts={verdicts} encounter={enc} active={interceptActive} />
      )}

      {/* ------------------------------------------------------ safety banner */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed left-0 right-0 top-14 z-50 flex justify-center"
      >
        {safeActive && lastResult && (
          <div className="safe-flash rounded-sm border border-safe/50 bg-pane-raised px-4 py-1.5 font-mono text-[11px] tracking-wide text-safe">
            VERIFIED SAFE — patched packet re-audited: SILENT_PASS in{" "}
            {lastResult.elapsed}ms · ${lastResult.cost.toFixed(4)}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ telemetry */}
      <TelemetryBar
        phase={phase}
        runStart={runStart}
        traces={traces}
        activeStage={activeStage}
      />
    </div>
  );
}
