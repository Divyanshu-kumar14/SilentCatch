"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createVolumeScene, type VolumeSceneHandle } from "@/lib/volume-scene";
import { Arrow } from "@/components/Mark";

const BEATS = [
  {
    kicker: "The scan",
    title: "The radiologist saw it.",
    body: "A 7.2 mm spiculated nodule in the right upper lobe, key slice 42. It is in the report, verbatim.",
  },
  {
    kicker: "The report",
    title: "The report carried it.",
    body: "Every claim is anchored to a character span in the source text — not a paraphrase, not a summary.",
  },
  {
    kicker: "The packet",
    title: "The packet dropped it.",
    body: "No chest CT follow-up. Ketorolac prescribed while creatinine climbs 87% in 36 hours.",
  },
  {
    kicker: "The interlock",
    title: "The interlock caught it.",
    body: "Discharge blocked. Two patches proposed. One click re-runs the audit.",
  },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function beatFor(p: number) {
  if (p < 0.24) return 0;
  if (p < 0.47) return 1;
  if (p < 0.68) return 2;
  return 3;
}

function StaticFilm() {
  return (
    <div className="bg-night px-6 py-24 text-night-ink lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="relative overflow-hidden rounded-sm bg-night-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/scans/ct_chest_rul_nodule_7mm.png"
            alt="Synthetic axial CT key slice with the 7.2 mm right-upper-lobe nodule outlined"
            className="h-full w-full object-contain opacity-90"
          />
          <div
            className="absolute border-2 border-signal"
            style={{ left: "57.8%", top: "26.6%", width: "17.2%", height: "17.2%" }}
          />
          <span className="absolute left-4 top-4 text-[13px] text-night-muted">ED-104 · key slice 42</span>
        </div>
        <div className="flex flex-col justify-center gap-8">
          {BEATS.map((b) => (
            <div key={b.kicker}>
              <p className="text-[13px] text-night-muted">{b.kicker}</p>
              <h3 className="mt-1 font-display text-3xl">{b.title}</h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-night-ink/70">{b.body}</p>
            </div>
          ))}
          <a
            href="/console"
            className="inline-flex w-fit items-center gap-2 bg-paper px-5 py-3 text-sm font-medium text-night"
          >
            Open the console <Arrow className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

export default function ScanFilm() {
  const sectionRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<VolumeSceneHandle | null>(null);
  const target = useRef(0);
  const current = useRef(0);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);
  const [reduced, setReduced] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduced || reduceMotion) return;
    const mount = mountRef.current;
    const section = sectionRef.current;
    if (!mount || !section) return;

    sceneRef.current = createVolumeScene(mount, {
      imageUrl: "/scans/ct_chest_rul_nodule_7mm.png",
      roi: { cx: 170, cy: 90 },
      mode: "film",
    });

    const measure = () => {
      const rect = section.getBoundingClientRect();
      const total = section.offsetHeight - window.innerHeight;
      target.current = total > 0 ? clamp01(-rect.top / total) : 0;
      const next = beatFor(target.current);
      if (next !== activeRef.current) {
        activeRef.current = next;
        setActive(next);
      }
    };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      current.current += (target.current - current.current) * 0.085;
      sceneRef.current?.setProgress(current.current);
    };

    measure();
    tick();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [reduced, reduceMotion]);

  if (reduced || reduceMotion) {
    return (
      <section id="catch" className="bg-night">
        <StaticFilm />
      </section>
    );
  }

  const beat = BEATS[active];

  return (
    <section
      ref={sectionRef}
      id="catch"
      className="relative h-[380vh] bg-night text-night-ink md:h-[440vh]"
    >
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <div ref={mountRef} className="absolute inset-0" aria-hidden />
        <div className="film-grain pointer-events-none absolute inset-0" />

        {/* frame ticks */}
        <div className="pointer-events-none absolute inset-5 md:inset-8" aria-hidden>
          <span className="absolute -left-px -top-px h-3 w-3 border-l border-t border-white/40" />
          <span className="absolute -right-px -top-px h-3 w-3 border-r border-t border-white/40" />
          <span className="absolute -bottom-px -left-px h-3 w-3 border-b border-l border-white/40" />
          <span className="absolute -bottom-px -right-px h-3 w-3 border-b border-r border-white/40" />
        </div>

        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-8 md:p-12">
          <div className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-signal live-dot" />
            <span className="text-[13px] text-night-ink/70">The catch</span>
          </div>
          <span className="hidden text-[13px] text-night-muted md:block">
            ED-104 · synthetic fixture · reconstruction from key slice 42
          </span>
        </div>

        {/* scrim */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-night via-night/80 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-8 p-6 md:flex-row md:items-end md:justify-between md:p-12">
          <div className="min-h-[210px] max-w-xl md:min-h-[240px]">
            <AnimatePresence mode="popLayout">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <p className="text-[13px] text-night-muted">{beat.kicker}</p>
                <h2 className="mt-2 font-display text-[2rem] leading-[1.02] md:text-[3.1rem]">
                  {beat.title}
                </h2>
                <p className="mt-4 max-w-md text-sm leading-relaxed text-night-ink/70 md:text-base">
                  {beat.body}
                </p>
                {active === 3 && (
                  <div className="mt-7 flex flex-wrap items-center gap-5">
                    <a
                      href="/console"
                      className="inline-flex items-center gap-2 bg-paper px-5 py-3 text-sm font-medium text-night transition-colors hover:bg-white"
                    >
                      Open the console <Arrow className="h-4 w-4" />
                    </a>
                    <span className="text-[13px] text-night-muted">
                      Re-audit: SILENT_PASS · loop closed
                    </span>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* beat rail */}
          <div className="flex items-center gap-4 md:flex-col md:items-end md:gap-3">
            {BEATS.map((b, i) => (
              <div
                key={b.kicker}
                className={`flex items-center gap-2 text-[13px] transition-colors ${
                  i === active ? "text-night-ink" : "text-night-muted/60"
                }`}
              >
                <span className={`h-px w-6 transition-colors ${i === active ? "bg-signal" : "bg-white/20"}`} />
                <span>{b.kicker}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className={`absolute bottom-6 right-6 hidden text-[13px] text-night-muted transition-opacity md:block ${
            active === 0 ? "opacity-100" : "opacity-0"
          }`}
        >
          Scroll ↓
        </div>
      </div>
    </section>
  );
}
