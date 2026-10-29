# SilentCatch — Product Context

## What it is
I built a pre-discharge safety interlock for emergency-department discharges. Before a clinician clicks
**Sign & Discharge Patient**, SilentCatch reads the radiology key slice, the serial labs, and the
draft discharge packet together, surfaces cross-modal contradictions, blocks the signature, and
offers a one-click patch followed by a re-audit.

## Who it is for
- **Primary:** emergency-department clinicians working under cognitive load, at a desktop workstation,
  in the last two minutes before a discharge is signed.
- **Secondary:** hackathon judges and clinical-informatics evaluators — I want them to see the catch,
  the evidence, and the honesty boundaries in under five minutes.
- **Not for:** patients, and not a validated clinical decision-support device.

## The two failures I built it to catch
1. **The buried finding.** A 7.2 mm spiculated right-upper-lobe nodule is noted in a radiology report
   and never becomes a follow-up order in the discharge packet.
2. **The normal-box collapse.** Creatinine rises 0.62 → 0.88 → 1.16 mg/dL in 36 hours (+87%) while
   remaining inside the printed reference range. Ketorolac is prescribed anyway.

## How it works (product truth)
1. **Vision** — Nemotron Super-VL extracts findings and measurements from the key slice + report.
2. **Gate** — Nemotron Nano triages; deterministic fail-safes override at ≥4 mm or ≥25% delta.
3. **Evidence** — Tavily (or a cached snapshot) retrieves governing guideline text; outbound queries
   are PHI-scrubbed.
4. **Reasoning** — Nemotron Ultra synthesises contradictions and patch proposals.
5. **Verification** — a deterministic span guard requires an exact case-insensitive substring match,
   computes character coordinates, and rejects unsupported quotes (one repair retry).
6. **Re-audit** — applying a patch mutates the packet and runs the pipeline again; a clean second run
   closes the loop.

## Honesty boundaries (must stay visible)
- 12 synthetic development fixtures: 8 expected-safe, 4 expected-contradiction. No real patients.
- Replay mode is deterministic and local; I score replay metrics as fixture-routing checks
  with explicit `score_source` provenance (`fixture_deterministic` vs `fixture_seeded`).
  12/12 predicted/expected fixture checks match — a functional check, not model accuracy.
- Not a validated clinical device. Latency and cost figures are design targets / public-rate estimates.
- The UI must always distinguish LIVE from REPLAYED and must never show a provider dollar figure for a
  replay run.

## Surfaces and modes
- `/` — **Persuade.** The story of the catch, the pipeline, the evidence, the honest ledger.
- `/console` — **Operate.** The three-column flight check: scan, lab velocity, discharge packet,
  connected telemetry. Keyboard: R run, M mute, B benchmarks, 1–4 patients.
- `/console` → Benchmarks — **Read/Operate.** The 12-case ledger and the three evaluated configurations.

## Voice
Clinical, exact, unhurried. Short declarative sentences. Say "blocked", "verified", "replayed",
"not validated". Never market a capability the fixture data cannot support.
