import Link from "next/link";

import results from "@/data/results_latest.json";
import { Mark, Arrow, ArrowUpRight } from "@/components/Mark";
import Reveal from "@/components/landing/Reveal";
import VolumeStill from "@/components/landing/VolumeStill";
import Cascade from "@/components/landing/Cascade";
import ScanFilm from "@/components/landing/ScanFilm";

const CONFIGS = Object.values(results.summary);

/** The fixture image each case actually ships with. */
const SCAN: Record<string, string> = {
  "ED-101": "ankle_xray_28m.png",
  "ED-102": "cxr_rll_consolidation_54f.png",
  "ED-103": "ct_abd_stone_3mm_41m.png",
  "ED-104": "ct_chest_rul_nodule_7mm.png",
  "ED-105": "forearm_xray_33f.png",
  "ED-106": "cxr_normal_47m.png",
  "ED-107": "abd_xray_normal_19m.png",
  "ED-108": "renal_us_normal_68f.png",
  "ED-109": "lspine_xray_51m.png",
  "ED-110": "ct_abd_adrenal_28mm_59m.png",
  "ED-111": "cxr_chf_73f.png",
  "ED-112": "pelvis_xray_45m.png",
};

function CasePlate({
  id,
  outcome,
  flagged,
}: {
  id: string;
  outcome: string;
  flagged: boolean;
}) {
  return (
    <figure>
      <div className="bg-night p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/scans/${SCAN[id] ?? "ct_chest_rul_nodule_7mm.png"}`}
          alt={`Synthetic ${id} key image`}
          width={512}
          height={512}
          loading="lazy"
          className="aspect-square w-full object-cover"
        />
      </div>
      <figcaption className="mt-2 flex items-baseline justify-between gap-2">
        <span className="tabular text-[13px] text-ink">{id}</span>
        <span className={`text-[13px] ${flagged ? "text-signal" : "text-muted"}`}>
          {outcome === "CRITICAL_INTERCEPT" ? "intercept" : "silent pass"}
        </span>
      </figcaption>
    </figure>
  );
}

export default function Landing() {
  return (
    <div className="bg-paper text-ink">
      {/* ---------------------------------------------------------- header */}
      <header className="relative z-50 bg-paper">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-5 lg:px-8">
          <div className="flex items-center">
            <Link
              href="/"
              className="flex h-11 items-center gap-2.5 bg-ink px-4 text-sheet"
              aria-label="SilentCatch home"
            >
              <Mark className="h-5 w-5" tone="light" />
              <span className="text-[15px] font-semibold tracking-tight">SilentCatch</span>
            </Link>
            <nav className="ml-8 hidden items-center gap-7 text-[14px] text-ink-2 lg:flex">
              <a href="#traps" className="transition-colors hover:text-ink">
                The catch
              </a>
              <a href="#pipeline" className="transition-colors hover:text-ink">
                Pipeline
              </a>
              <a href="#evidence" className="transition-colors hover:text-ink">
                Evidence
              </a>
              <a href="#limits" className="transition-colors hover:text-ink">
                Limits
              </a>
            </nav>
          </div>
          <Link
            href="/console"
            className="inline-flex h-11 items-center gap-2 bg-signal px-4 text-[14px] font-medium text-sheet transition-colors hover:bg-signal-ink"
          >
            Open the console <Arrow className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* ------------------------------------------------------------- band */}
      <div className="relative h-[44svh] min-h-[300px] overflow-hidden bg-night">
        <VolumeStill
          imageUrl="/scans/ct_chest_rul_nodule_7mm.png"
          roi={{ cx: 170, cy: 90 }}
        />
        <div className="film-grain pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-night-muted">R</span>
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-night-muted">L</span>
          <span className="absolute left-1/2 top-3 -translate-x-1/2 text-[13px] text-night-muted">S</span>
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[13px] text-night-muted">I</span>
        </div>
        <div className="absolute inset-x-0 bottom-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 text-[13px] text-night-ink/60 lg:px-8">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-signal live-dot" />
            ED-104 · CT chest without contrast · key slice 42
          </span>
          <span className="text-night-muted">Volumetric reconstruction · not raw DICOM</span>
        </div>
      </div>

      {/* ------------------------------------------------------------- hero */}
      <section className="mx-auto max-w-[1600px] px-5 pb-24 pt-12 lg:px-8 lg:pb-40 lg:pt-20">
        <div className="grid gap-10 lg:[grid-template-columns:42%_1fr] lg:gap-8">
          <div className="max-w-[34ch]">
            <p className="text-[17px] leading-[1.6] text-ink-2">
              A pre-discharge interlock for the emergency department. It reads the key slice,
              the serial labs, and the draft packet together — then holds the signature when
              they contradict.
            </p>
            <p className="mt-6 text-[13px] leading-[1.6] text-muted">
              12 synthetic encounters · 4 contradictions · 8 clean passes
            </p>
          </div>
          <div>
            <h1 className="display-xl text-balance">
              The last check
              <br />
              before discharge.
            </h1>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <a
                href="#traps"
                className="inline-flex items-center gap-2 text-[15px] font-medium text-ink underline-signal"
              >
                See the two failures <Arrow className="h-4 w-4" />
              </a>
              <span className="max-w-[42ch] text-[13px] leading-[1.6] text-muted">
                Deterministic gates, verified quotes, and a replayable ledger. Not a validated
                clinical device.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ traps */}
      <section id="traps" className="mx-auto max-w-[1600px] px-5 py-24 lg:px-8 lg:py-36">
        <div className="grid gap-10 lg:[grid-template-columns:42%_1fr] lg:gap-8">
          <Reveal>
            <h2 className="display-lg max-w-[14ch]">Both were in the chart.</h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="max-w-[64ch] text-[17px] leading-[1.6] text-ink-2">
              One was a 7.2 mm spiculated nodule buried on line 42 of a radiology report. The
              other was creatinine climbing 87% in 36 hours while still inside the printed
              reference range. Neither fired a standard alert.
            </p>
          </Reveal>
        </div>

        <div className="mt-16 grid gap-x-10 gap-y-14 md:grid-cols-2 lg:mt-24">
          <Reveal>
            <div className="md:h-[44svh] md:min-h-[300px]">
              <div className="flex items-baseline gap-3">
                <span className="font-display text-[clamp(7rem,22vw,18rem)] leading-[0.78] tracking-[-0.055em] text-ink">
                  7.2
                </span>
                <span className="text-[20px] text-muted">mm</span>
              </div>
              <p className="mt-5 text-[13px] text-muted">Radiology report · right upper lobe</p>
              <p className="mt-2 max-w-[52ch] text-[15px] text-ink-2">
                Spiculated, solid, non-calcified. No chest CT follow-up ordered.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="md:h-[44svh] md:min-h-[300px]">
              <div className="font-display text-[clamp(7rem,22vw,18rem)] leading-[0.78] tracking-[-0.055em] text-ink">
                <span className="text-signal">+</span>87%
              </div>
              <p className="mt-5 text-[13px] text-muted">
                Creatinine · 36 hours · 0.62 → 1.16 mg/dL
              </p>
              <p className="mt-2 max-w-[52ch] text-[15px] text-ink-2">
                Still inside the printed range. Ketorolac prescribed against the rise.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------------------- pipeline */}
      <section id="pipeline" className="bg-paper-deep">
        <div className="mx-auto max-w-[1600px] px-5 py-24 lg:px-8 lg:py-36">
          <div className="grid gap-10 lg:[grid-template-columns:42%_1fr] lg:gap-8">
            <Reveal>
              <h2 className="display-lg max-w-[12ch]">
                Four stages,
                <br />
                one signature.
              </h2>
            </Reveal>
            <Reveal delay={0.08}>
              <p className="max-w-[64ch] text-[17px] leading-[1.6] text-ink-2">
                A vision pass, a deterministic gate, a guideline lookup, and a reasoning pass.
                The gate does not ask a model when the numbers already say stop: a finding of
                4 mm or a lab delta of 25% overrides it.
              </p>
            </Reveal>
          </div>

          <Reveal className="mt-16 lg:mt-20">
            <Cascade />
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------- film */}
      <ScanFilm />

      {/* ---------------------------------------------------------- ledger */}
      <section id="evidence" className="mx-auto max-w-[1600px] px-5 py-24 lg:px-8 lg:py-36">
        <div className="grid gap-10 lg:[grid-template-columns:42%_1fr] lg:gap-8">
          <Reveal>
            <h2 className="display-lg max-w-[12ch]">
              The ledger,
              <br />
              not the pitch.
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="max-w-[64ch]">
              <p className="text-[17px] leading-[1.6] text-ink-2">
                Twelve synthetic encounters, three configurations, replay-only. Clinical metrics
                are intentionally N/A in replay. What you can check is the outcome of every case
                and the provenance of every quote.
              </p>
              <p className="mt-4 max-w-[64ch] text-[13px] leading-[1.6] text-muted">
                12/12 predicted/expected fixture checks match. This is a functional check, not
                model accuracy.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal className="mt-16">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <p className="text-[13px] text-muted">Twelve fixture key images</p>
            <p className="text-[13px] text-faint">4 contradiction · 8 clean</p>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
            {results.cases.map((c) => (
              <CasePlate
                key={c.encounter_id}
                id={c.encounter_id}
                outcome={c.predicted_outcome}
                flagged={c.expected_contradiction}
              />
            ))}
          </div>
        </Reveal>

        <Reveal className="mt-20">
          <div className="hidden md:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-edge-2 text-[13px] text-muted">
                  <th className="py-3 pr-6 font-medium">Configuration</th>
                  <th className="py-3 pr-6 font-medium">Input</th>
                  <th className="py-3 pr-6 font-medium">Fixture checks</th>
                  <th className="py-3 pr-6 font-medium">Scored cases</th>
                  <th className="py-3 font-medium">Clinical metrics</th>
                </tr>
              </thead>
              <tbody>
                {CONFIGS.map((c) => (
                  <tr key={c.key} className="border-b border-edge align-baseline">
                    <td className="py-4 pr-6 text-[15px] text-ink">{c.name}</td>
                    <td className="py-4 pr-6 text-[13px] text-ink-2">{c.input_modality}</td>
                    <td className="tabular py-4 pr-6 text-[13px] text-ink">
                      {c.replay_check_matches}/{c.replay_check_total}
                    </td>
                    <td className="tabular py-4 pr-6 text-[13px] text-ink">{c.scored_cases}</td>
                    <td className="py-4 text-[13px] text-muted">N/A in replay</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            {CONFIGS.map((c) => (
              <div key={c.key} className="py-4 first:pt-0 last:pb-0">
                <p className="text-[15px] text-ink">{c.name}</p>
                <p className="mt-1 text-[13px] text-muted">{c.input_modality}</p>
                <p className="mt-2 text-[13px] leading-[1.5] text-ink-2">
                  {c.replay_check_matches}/{c.replay_check_total} fixture checks ·{" "}
                  {c.scored_cases} scored · metrics N/A in replay
                </p>
              </div>
            ))}
          </div>

          <p className="mt-4 max-w-[64ch] text-[13px] leading-[1.6] text-muted">
            Source: eval/results_latest.json · replay mode · 2026-10-28. Cost values are public-rate
            estimates, not provider invoices. Tavily credit costs are external.
          </p>
        </Reveal>
      </section>

      {/* ----------------------------------------------------------- limits */}
      <section id="limits">
        <div className="bg-ink text-paper">
          <div className="mx-auto flex min-h-[34svh] max-w-[1600px] items-end px-5 pb-10 pt-24 lg:px-8">
            <h2 className="display-lg max-w-[16ch]">What it does not claim.</h2>
          </div>
        </div>

        {[
          {
            q: "Is this clinical validation?",
            a: "No. SilentCatch is an experimental prototype. It is evaluated on 12 synthetic development fixtures — 8 expected-safe and 4 expected-contradiction. The replay run is a deterministic functional check, not a measure of model accuracy, sensitivity, or real-world safety.",
          },
          {
            q: "What leaves the machine?",
            a: "In live mode, a guideline query is scrubbed of names, MRNs, and dates before it is sent to Tavily. The audit runs against the fixture or the encounter payload you provide. Replay mode makes no provider calls at all.",
          },
          {
            q: "What happens when the model is wrong?",
            a: "The gate does not defer to a model when the numbers already say stop: a finding of 4 mm or a lab delta of 25% overrides it. Every quoted span must match the source text exactly, or the verdict is rejected and repaired once. If a provider fails, the run falls back to replay and says so.",
          },
          {
            q: "What does the red line prove?",
            a: "It points from an exact character span in the source text to the order or prescription it contradicts. The span is verified by a case-insensitive substring match and converted to character coordinates. It proves provenance, not clinical truth.",
          },
        ].map((item, i) => (
          <div key={item.q} className={i % 2 === 0 ? "bg-paper" : "bg-sheet"}>
            <div className="mx-auto grid max-w-[1600px] gap-6 px-5 py-14 lg:grid-cols-[42%_1fr] lg:gap-8 lg:px-8 lg:py-16">
              <h3 className="max-w-[20ch] font-display text-[clamp(1.6rem,2.4vw,2.1rem)] leading-[1.05] text-ink">
                {item.q}
              </h3>
              <p className="max-w-[56ch] text-[16px] leading-[1.65] text-ink-2">{item.a}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------------------ close */}
      <section className="bg-night text-night-ink">
        <div className="mx-auto max-w-[1600px] px-5 pb-10 pt-24 lg:px-8 lg:pt-36">
          <h2 className="display-xl max-w-[13ch]">Nothing leaves unseen.</h2>
          <div className="mt-16 flex flex-col gap-8 md:mt-24 md:flex-row md:items-end md:justify-between">
            <p className="max-w-[46ch] text-[15px] leading-[1.6] text-night-ink/70">
              The interlock runs in the two minutes before sign-off. Open the console and run the
              synthetic ED-104 case: the nodule, the creatinine, the packet, the patch.
            </p>
            <Link
              href="/console"
              className="inline-flex h-14 w-fit items-center gap-2 bg-paper px-6 text-[15px] font-medium text-night transition-colors hover:bg-white"
            >
              Open the flight-check console <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>

          <footer className="mt-24 flex flex-col gap-3 pb-10 text-[13px] text-night-muted md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2.5">
              <Mark className="h-4 w-4" tone="light" />
              <span>SilentCatch</span>
            </div>
            <span>Synthetic fixtures · not a validated clinical device · MIT</span>
            <div className="flex items-center gap-5">
              <Link href="/console" className="transition-colors hover:text-night-ink">
                Console
              </Link>
              <a href="#limits" className="transition-colors hover:text-night-ink">
                Limits
              </a>
              <a href="#catch" className="transition-colors hover:text-night-ink">
                The catch
              </a>
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
}
