<div align="center">

# SilentCatch

### Real-Time Cross-Modal Clinical Safety Interlock for ER Discharges

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Next.js 14](https://img.shields.io/badge/Frontend-Next.js%2014-black.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Nebius Token Factory](https://img.shields.io/badge/Inference-Nebius%20Token%20Factory-00D4B2)](https://nebius.com/services/token-factory)
[![NVIDIA Nemotron](https://img.shields.io/badge/Models-NVIDIA%20Nemotron-76B900.svg?logo=nvidia&logoColor=white)](https://build.nvidia.com/)
[![Tavily Search API](https://img.shields.io/badge/Grounding-Tavily%20Search%20API-4A90E2)](https://tavily.com/)
[![Docker](https://img.shields.io/badge/Deployment-Docker%20Compose-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com/)
[![Test Suite](https://img.shields.io/badge/Tests-67%20Passed-brightgreen.svg)]()
[![Live Demo](https://img.shields.io/badge/Demo-silentcatch.vercel.app-000000?logo=vercel&logoColor=white)](https://silentcatch.vercel.app)

<br/>

**I built a multi-tier safety interlock that runs before the clinician clicks *Sign & Discharge Patient* — it surfaces cross-modal contradictions that routine discharge checks miss.**

**My eval results, up front:** 12/12 fixture checks · 100% intercept recall · 100% precision · 0 false positives · ~$0.90 per 1k discharges (44% below Ultra-only) · ~1.5s design latency. All on 12 synthetic fixtures in replay mode — [how I scored it](#-benchmark-results-synthetic-fixture-validation).

[Overview](#-the-clinical-challenge) • [Architecture](#-system-architecture) • [Benchmarks](#-benchmark-results-synthetic-fixture-validation) • [Console Showcase](#-clinical-flight-check-console) • [Quick Start](#-quick-start) • [API Reference](#-api-reference) • [Privacy Posture](#-data-handling-posture)

<br/>

![SilentCatch Hero Console](docs/assets/hero-critical-intercept.png)
*SilentCatch running my synthetic ED-104 fixture: a buried 7.2 mm RUL pulmonary nodule and an acute kinetic AKI × Ketorolac collision surface before sign-off. Screenshot from a local run; it is not evidence of clinical validation.*

</div>

---

## 🏥 The Clinical Challenge

I built SilentCatch for the two discharge failures that scare me most. In a high-volume Emergency Department, clinicians carry brutal cognitive loads, and when they assemble discharge packets, two silent, high-liability blind spots slip past standard EHR warnings. The diagram below is an illustrative synthetic failure mode, not a measured outcome:

```
                       THE "SILENT TRAP" OF ROUTINE ER DISCHARGES

   ┌───────────────────────────────────────┐    ┌───────────────────────────────────────┐
   │      1. Buried Incidental Nodule      │    │    2. "Normal Box" Kinetic Collapse   │
   ├───────────────────────────────────────┤    ├───────────────────────────────────────┤
   │ Trauma CT rule-out for rib fracture   │    │ Serial Creatinine: 0.62 → 0.88 →      │
   │ Radiologist notes 7.2 mm incidental   │    │ 1.16 mg/dL (+87% delta in 36h).       │
   │ nodule on image slice #42.            │    │ Still within reference (0.6-1.20).    │
   │                                       │    │                                       │
   │ Outcome: Missed in acute discharge    │    │ Outcome: Clinician prescribes         │
   │ instructions; patient presents 2      │    │ Ketorolac (Toradol), precipitating    │
   │ years later with Stage IV cancer.     │    │ acute tubular necrosis (ATN).         │
   └───────────────────────────────────────┘    └───────────────────────────────────────┘
```

### Why Conventional Clinical Decision Support (CDS) Fails
Alert fatigue is a widely reported problem: modal-heavy decision support gets dismissed on reflex. I designed SilentCatch to avoid becoming one more routine pop-up by gating on deterministic risk signals first.

### The SilentCatch Paradigm
- **Quiet fast path on clean fixtures:** In my prototype, routine safe encounters clear the deterministic gate without opening an interception modal. The reference latency budgets are design targets, not measured clinical performance.
- **Synchronized interception on contradictions:** When cross-modal contradictions collide (imaging finding vs. discharge order, or kinetic lab trajectory vs. prescribed drug), SilentCatch halts sign-off, draws visual red-lines connecting source evidence to the draft packet, cites retrieved guidelines when available, and offers a 1-click patch-and-reverify loop.

---

## ⚡ System Architecture

I built SilentCatch around open-weight **NVIDIA Nemotron** frontier models on **Nebius Token Factory**, real-time guideline retrieval via **Tavily Search API**, and deterministic kinematic math I wrote to catch what the models might wave through.

```mermaid
flowchart TD
    subgraph Ingestion ["1. Clinical Discharge Ingestion"]
        A["Radiology Key-Slice + Full Report"] --> D{"Clinician Triggers<br/>'Sign & Discharge'"}
        B["Serial Labs Time-Series"] --> D
        C["Draft Discharge Packet & Rx"] --> D
    end

    subgraph Pipeline ["2. 4-Stage Cascaded Routing Pipeline"]
        D --> S1["Stage 1: Vision Extraction<br/><b>NVIDIA Nemotron 3.5 Super VL (120B)</b><br/>• Extracts lesion calipers & mm measurements<br/>• In-memory SHA-256 byte cache (D-1)"]
        S1 --> S2["Stage 2: Sub-Second Noise Gate<br/><b>NVIDIA Nemotron 3 Nano (30B)</b><br/>• Sub-second triage clearance<br/>• Deterministic fail-safe override (≥4mm or ≥25% delta)"]
        
        S2 -- "Clean Trajectory" --> Pass["SILENT_PASS (fast path)<br/>No interception modal • Discharge authorized"]
        
        S2 -- "Potential Conflict" --> S3["Stage 3: Evidence Grounding<br/><b>Tavily Search API / snapshot</b><br/>• Regex PHI scrubber (names, MRN, DOB stripped)<br/>• Retrieves relevant guideline references when available"]
        S3 --> S4["Stage 4: Contradiction Synthesis<br/><b>NVIDIA Nemotron 3 Ultra (550B)</b><br/>• Cross-modal clinical contradiction reasoning<br/>• Synthesizes discharge order & medication patches"]
    end

    subgraph Verification ["3. Deterministic Quote-Verification Gate"]
        S4 --> SG["Deterministic Span-Guard Rig<br/>1. Exact case-insensitive substring quote match<br/>2. Computes [start_char, end_char] UI coordinates<br/>3. Validates required CPT / drug is provably absent"]
        SG -- "Quote Unverified" --> Retry["Auto-Repair Retry (1x)<br/>Re-prompts with strict verbatim constraint"]
        Retry --> SG
        SG -- "Guards Verified" --> Intercept["CRITICAL_INTERCEPT<br/>• Red-line visual bridge to source quote<br/>• Guideline provenance badge<br/>• 1-Click 'Apply Safe Patch & Re-Verify'"]
    end
```

### Stage Details

My latency values below are design budgets, not measured production results. Live behaviour depends on provider load, model routing, and network conditions.

| Stage | Engine / Model | Latency Budget | Primary Responsibility |
| :--- | :--- | :---: | :--- |
| **Stage 1: Vision** | `Nemotron-3.5-Super-VL-120B` | ~400 ms | Ingests key-slice CT/X-ray and report; extracts mm findings and ROI coordinates. |
| **Stage 2: Gate** | `NVIDIA-Nemotron-3-Nano-30B` | ~250 ms | Triage filter for clean discharges. Deterministic fail-safes override model if findings $\ge 4\text{mm}$ or lab delta $\ge 25\%$. |
| **Stage 3: Evidence** | `Tavily Search API` | ~300 ms | Outbound query scrubbed of PHI; retrieves governing clinical literature (`pubs.rsna.org`, `kdigo.org`, `fda.gov`). |
| **Stage 4: Reasoning** | `Nemotron-3-Ultra-550B` | ~600 ms | Synthesizes structured clinical patches. Proposes candidates with verbatim source quotes. |
| **Verification Gate** | Deterministic Python Rig | < 1 ms | Verifies quotes exist in the chart, computes UI character offsets, and blocks unverified proposals from surfacing. |

### 🔍 Why SilentCatch is the Best Use of Tavily ($3,000 Award)

Tavily sits at Stage 3 of my pipeline: the evidence layer that decides what Ultra is allowed to reason from.

The flow: Nano drafts 1–2 precision queries naming the governing body (Fleischner, KDIGO, FDA), with patient identifiers forbidden in the prompt itself. Every query then passes a regex PHI scrubber covering names, MRNs, and dates of birth — once on generation, again on the outbound call. The Tavily request uses advanced depth, max 3 results, raw content off, and `include_domains` locked to eight medical authorities, so results come from places like pubs.rsna.org and kdigo.org instead of the open web. A 10s timeout degrades to a verified local snapshot captured Oct 2026, and the badge always says which path ran.

The returned paragraphs are embedded verbatim into Ultra's reasoning context as `guideline_evidence`, the verdict carries the kind-matched guideline URL, and the interception card links it as a live-vs-snapshot badge. The model never argues from memory when it can argue from a cited paragraph.

One caveat: my scrubber is a prototype safeguard, not a certified de-identification pipeline. No real patient data has touched this system — only the 12 synthetic fixtures.

---

## 📊 Benchmark Results (Synthetic Fixture Validation)

I wrote a benchmark harness over **12 synthetic development fixtures** (8 expected-safe, 4 expected-contradiction) across 3 configurations, because I wanted numbers I could defend instead of vibes. The artifact in [`eval/results_latest.json`](eval/results_latest.json) regenerates with `make benchmark` (deterministic replay) or `make benchmark-live` (provider inference).

> ⚠️ Evaluated on 12 synthetic ER fixtures in deterministic replay mode. Classification metrics reflect fixture routing accuracy. Cost figures are public-rate estimates, not provider invoices. Not a clinical validation study.

| Configuration | Cases scored | Recall | Precision | FPR | Est. latency | Est. cost / 1k | Scoring basis |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Nemotron 3 Nano-30B only** | 12/12 | 100.0% | 100.0% | 0.0% | ~250 ms | $0.0060* | deterministic fixture routing |
| **Nemotron 3 Ultra-550B only** | 12/12 | 100.0% | 100.0% | 0.0% | ~900 ms | $1.6060* | fixture-seeded replay |
| **SilentCatch Tiered Router** | 12/12 | 100.0% | 100.0% | 0.0% | ~1550 ms | $0.8993* | fixture-seeded replay |

My headline takeaway: the tiered router matches Ultra-only routing at 44% lower estimated cost, because cheap stages clear the easy cases before Ultra ever runs. Replay stage-4 predictions for Ultra-only and Tiered are seeded from fixture expectations (`score_source: fixture_seeded`); the Nano-only baseline is deterministic (`fixture_deterministic`). These figures validate my fixture wiring, triage routing, and verification — they are not provider-model recall or precision.

- **Replay (`make benchmark`)** — no provider calls. Classification metrics are fixture-routing checks, cost is estimated from documented token budgets and public rates, latency is reported as design targets. `meta.mode` is `REPLAYED` and every scored value carries a `score_source`.
- **Live (`make benchmark-live`)** — runs the configured provider path and scores only predictions that actually came from live responses. It requires `NEBIUS_API_KEY` (and optionally `TAVILY_API_KEY`) and may incur cost. Live results are still limited to these synthetic fixtures and do **not** establish clinical sensitivity, specificity, or real-world safety.

I also smoke-tested ED-104 live against Nebius from my deployed backend (Oct 29): 2/2 verdicts verified, ~25s, ~$0.01. One observed run, not a benchmark — reproduce it with the smoke command in Quick Start.

My console's **BENCHMARKS** tab renders `meta.mode`, `scored_cases`, `score_source`, per-case provenance, fallback status, and the nullable metrics from the artifact. It labels fixture-seeded routing separately from model performance.

<details>
<summary>What the generated artifact contains</summary>

```json
{
  "schema_version": 2,
  "meta": {
    "mode": "REPLAYED",
    "requested_mode": "replay",
    "environment": "REPLAYED",
    "scoring_basis": "fixture_deterministic",
    "total_encounters": 12,
    "positive_cases": 4,
    "negative_cases": 8
  },
  "summary": {
    "tiered_router": {
      "mode": "REPLAYED",
      "scored_cases": 12,
      "score_source": "fixture_seeded",
      "replay_check_matches": 12,
      "replay_check_total": 12,
      "recall_pct": 100.0,
      "precision_pct": 100.0,
      "fpr_pct": 0.0,
      "median_latency_ms": null,
      "latency_scope": "estimated_design_targets",
      "estimated_latency_ms": { "critical_path_ms": 1550.0 },
      "cost_per_1k_discharges_usd": 0.8993,
      "cost_type": "estimated_public_rates"
    }
  }
}
```

Actual values depend on the run; inspect `eval/results_latest.json` rather than copying numbers from this example.

</details>

<br/>

![SilentCatch Model Benchmarks](docs/assets/model-benchmarks-tab.png)
*Screenshot of the benchmark tab. It labels replay mode and fixture-seeded routing explicitly; neither is model accuracy or clinical validation.*

---

## 🖥️ Clinical Flight-Check Console

I designed the interface as a single bone-paper sheet: the imaging chamber is the only dark material, and the three columns — imaging, kinetics, discharge gate — are separated by hairlines rather than nested cards. Below `1280px` the columns stack; above it, the sheet holds its three-column flight-check layout:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ SILENTCATCH  ER Pre-Discharge Flight-Check     [Flight-check] [Benchmarks]      ED-104 │
├──────────────────────────────┬──────────────────────────────┬──────────────────────────┤
│ PANE 1: RADIOLOGY KEY-SLICE  │ PANE 2: 48-HR LAB VELOCITY   │ PANE 3: DISCHARGE EDITOR │
│                              │                              │                          │
│ • 256×256 Key-Slice Viewer   │ • OLS Linear Trajectory Math │ • Primary ICD-10 & Rx    │
│ • Red ROI Caliper Ring       │ • KDIGO AKI 1/2/3 Alarm Bands│ • Interception Cards     │
│ • Verbatim Span-Guard Quote  │ • Interactive Judge Sandbox  │ • Tavily Clinical Badges │
│   Offset Highlighting        │ • Real-time bounds (0.1-25.0)│ • 1-Click Patch & Verify │
├──────────────────────────────┴──────────────────────────────┴──────────────────────────┤
│ TELEMETRY: Vision ~400ms* | Gate ~250ms* | Evidence ~300ms* | Ultra ~600ms* (targets)  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### The 1-Click Closed Loop: Before vs. After Patch

| Step 1: Interception (`CRITICAL_INTERCEPT`) | Step 2: Verified Safe (`VERIFIED_SAFE`) |
| :---: | :---: |
| ![ED-104 Intercept](docs/assets/hero-critical-intercept.png) | ![ED-104 Verified Safe](docs/assets/loop-closed-verified-safe.png) |
| Halts sign-off; highlights buried 7.2 mm nodule and draws red-line to missing CPT 71250 order. Flags kinetic AKI creatinine delta. | Clinician clicks **"Apply patch & re-verify"**. The packet updates in place, re-audits clean, and unlocks the green sign-off state. |

### 3D reconstruction

![SilentCatch 3D reconstruction](docs/assets/console-3d-reconstruction.png)
*My 3D tab stacks 34 planes of the single fixture key slice. It is a reconstruction, not a DICOM volume; the slice control and the ROI beacon ride the emphasised plane.*

### The landing page

![SilentCatch landing page](docs/assets/landing-page.png)
*My public entry point at `/`: a scroll-driven reconstruction of the ED-104 key slice above the fold, with the fixture ledger and the two failure modes below. The console lives at `/console`.*

---

## 🚀 Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/) **OR**
- [Python 3.11+](https://www.python.org/) and [Node.js 18+](https://nodejs.org/)

### Option 1: Docker Compose (Recommended)

I made this the zero-configuration path — full stack (FastAPI on `:8000`, Next.js on `:3000`):

```bash
# Clone the repository
git clone https://github.com/Divyanshu-kumar14/SilentCatch.git
cd SilentCatch

# Build and launch containers
make judge-demo
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> [!NOTE]
> When API keys are unset, SilentCatch automatically uses the **deterministic replay/seed path** with recorded fixture traces. All 67 tests and UI features function offline with full fidelity. Benchmark classification metrics are fixture-deterministic; cost figures are public rate estimates. Replay does not measure model accuracy or live inference latency.

---

### Option 2: Local Development Setup

```bash
# 1. Install dependencies (creates .venv and installs node_modules)
make install

# 2. Run backend (:8000) and frontend (:3000) concurrently
make dev
```

### Run the Benchmark & Verification Tests

```bash
# Replay benchmark: no provider calls; syncs the frontend artifact
make benchmark

# Explicit live benchmark: requires NEBIUS_API_KEY, may incur provider charges
# Prefer a one-case smoke first:
# ./.venv/bin/python eval/benchmark.py --live --smoke --case ED-104
make benchmark-live

# Backend unit & integration tests
./.venv/bin/python -m pytest backend/tests -q

# Frontend lint, type-check, and production build
npm --prefix frontend run lint
npm --prefix frontend run build
```

My frontend reads a static copy at `frontend/src/data/results_latest.json`; both benchmark targets call `make sync-benchmark-artifact` so the UI cannot drift from `eval/results_latest.json`.

---

## 🔬 Running with Live Nebius Inference

`make judge-demo` needs no API keys; with keys unset it runs my deterministic replay path. To run live inference against real Nebius Token Factory endpoints:

1. **Obtain API keys**
   - Nebius Token Factory: <https://nebius.com/services/token-factory>
   - Tavily Search API: <https://tavily.com>

2. **Configure the environment**
   ```bash
   cp .env.example .env
   # Edit .env and add:
   # NEBIUS_API_KEY=your_key_here
   # TAVILY_API_KEY=your_key_here
   ```

3. **Run the live stack**
   ```bash
   make dev
   ```

My console header shows `[LIVE — Nebius Token Factory]` instead of `[REPLAY MODE — No API Keys]` when a Nebius key is configured. The mode is also reported by `GET /healthz` (`inference_mode`) and by each audit's `run_start` event. My spend circuit breakers cap costs at **$0.05/discharge** and **$2.00/day**; when a cap trips, the audit falls back to the deterministic replay path.

### Deployed Topology (Vercel frontend + FastAPI backend)

I run the demo split across two hosts:

- Frontend: `https://silentcatch.vercel.app` (Next.js on Vercel)
- Backend: `https://3.26.189.111.sslip.io` (FastAPI in Docker behind Caddy)

Set the frontend origin in Vercel under **Project → Settings → Environment Variables**:

| Variable | Environments | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Production, Preview | `https://3.26.189.111.sslip.io` |

`NEXT_PUBLIC_*` values are public build-time values. API keys belong only in the backend environment. A production build with no `NEXT_PUBLIC_API_URL` fails loudly in the console instead of silently calling `localhost`.

I allow exact browser origins on the backend (comma-separated):

```bash
ALLOWED_ORIGINS=https://silentcatch.vercel.app,http://localhost:3000,http://127.0.0.1:3000
# Optional, approved preview deployments only — never a blanket *.vercel.app
# ALLOWED_ORIGIN_REGEX=^https://silentcatch-[a-z0-9-]+\.vercel\.app$
```

**Fail-closed audit status.** If live inference was requested and the vision stage fell back before extraction, or reasoning produced no prediction after escalation, I report a would-be `SILENT_PASS` as `INCOMPLETE` with an error, and the console blocks discharge. Deterministic gate triage and seed-rig re-audits keep their result but are labeled `MIXED`/`FALLBACK`, never `LIVE`. Deliberate replay (no keys, spend cap) remains `REPLAYED`.

---

## 🔌 API Reference

### Liveness & Telemetry
```http
GET /healthz
```
Returns configured live capability, resolved model IDs, Tavily configuration, and active spend caps. It reports configuration only; it does not make a provider call.

```json
{
  "status": "ok",
  "inference_mode": "LIVE_CAPABLE",
  "live_capable": true,
  "mode_note": "NEBIUS_API_KEY configured; audits may call the provider. This health check makes no model call.",
  "nebius_base_url": "https://api.tokenfactory.nebius.com/v1",
  "models": {
    "vision": "nvidia/Nemotron-3.5-Super-VL",
    "gate": "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    "reasoning": "nvidia/Nemotron-3-Ultra-550b-a55b",
    "failsafe": "nvidia/nemotron-3-super-120b-a12b"
  },
  "tavily_configured": true,
  "spend_caps": {
    "per_discharge_usd": 0.05,
    "daily_usd": 2.00
  }
}
```

When no key is configured, the same endpoint returns `"inference_mode": "REPLAY_ONLY"` and `"live_capable": false`. `tavily_live` remains as a deprecated alias for `tavily_configured`.

---

### Patient Encounters
```http
GET /api/encounters
```
Returns all available patient fixtures formatted for the clinical cockpit view (expected findings stripped).

---

### Benchmark Results
```http
GET /api/benchmark
```
Returns the cached `eval/results_latest.json` artifact plus a top-level `eval_mode` (`fixture_deterministic` for replay, `live_inference` for live). Replay artifacts score deterministic fixture routing via `score_source`, estimate cost from public rates, and report latency as design targets. Consumers must not read replay values as provider-model accuracy or measured inference latency.

---

### Streaming Safety Interlock (SSE)
```http
POST /api/audit-stream
Content-Type: application/json
```

**Payload:**
```json
{
  "encounter_id": "ED-104",
  "encounter": null
}
```
*(Optionally provide a mutated `encounter` object to run the 1-click re-verification loop).*

**Server-Sent Event Stream Format:**
```
event: run_start
data: {"encounter_id": "ED-104", "mode": "REPLAYED", "daily_spend_usd": 0.0}

event: stage_start
data: {"stage": "vision"}

event: stage_done
data: {"stage": "vision", "findings": [...], "vision_confidence": "HIGH"}

event: stage_start
data: {"stage": "gate"}

event: stage_done
data: {"stage": "gate", "decision": {"action": "ESCALATE", "reasons": [...]}}

event: stage_start
data: {"stage": "guideline"}

event: stage_done
data: {"stage": "guideline", "guidelines": [...]}

event: stage_start
data: {"stage": "reasoning"}

event: stage_done
data: {"stage": "reasoning", "verdicts": [...]}

event: verdict
data: {"status": "CRITICAL_INTERCEPT", "verdicts": [...], "total_cost_usd": 0.0, "execution_mode": "REPLAYED"}

event: done
data: {"status": "CRITICAL_INTERCEPT", "verdicts": [...], "elapsed_ms": 7, "execution_mode": "REPLAYED"}
```

---

## 🔒 Data-Handling Posture

This section describes my prototype's intended data flow. It is **not** a HIPAA certification, nor a guarantee about third-party provider retention.

1. **Provider-hosted inference**: Live inference goes to [Nebius Token Factory](https://nebius.com/services/token-factory) using open-weight NVIDIA Nemotron models. Retention and logging are governed by the provider's terms and configuration; I don't independently certify them. Replay mode makes no provider call.
2. **Outbound query scrubbing**: Before a Tavily search request, my query path applies a deterministic regex scrubber intended to remove names, medical record numbers, and dates of birth. The scrubber is a prototype safeguard, not a formal de-identification certification; review and validate it before any real patient data is used.
3. **In-process spend circuit breakers**: My in-memory ledgers enforce:
   - **$0.05 USD** budget per discharge evaluation.
   - **$2.00 USD** budget per day.
   The caps are process-local and reset on restart. When a cap is reached, the audit falls back to the deterministic replay path instead of making further provider calls.

---

## 📁 Repository Map

```
SilentCatch/
├── backend/
│   ├── config.py                 # Nebius/Tavily config, model IDs & spend caps
│   ├── main.py                   # FastAPI REST entrypoint, SSE streaming & image server
│   ├── schemas.py                # Strict Pydantic v2 data models & validation
│   ├── engine/
│   │   ├── pipeline.py           # 4-stage SSE orchestrator & thread pool worker
│   │   ├── vision_extractor.py   # Nemotron 3.5 Super VL image/text extractor & cache
│   │   ├── noise_gate.py         # Nemotron 3 Nano triage gate with deterministic overrides
│   │   ├── guideline_search.py   # PHI-scrubbed Tavily guideline retrieval & snapshot cache
│   │   ├── contradiction_ultra.py# Nemotron 3 Ultra deep cross-modal reasoning
│   │   ├── span_guard.py         # Zero-hallucination substring quote verifier & LRU cache
│   │   ├── kinematic_labs.py     # Analytical OLS serial lab velocity & KDIGO AKI engine
│   │   ├── telemetry.py          # Real-time token pricing, spend ledger & caps
│   │   └── replay.py             # ReplayStore for deterministic offline execution
│   ├── fixtures/                 # 12 synthetic ER encounters, key-slice PNGs & guideline cache
│   └── tests/                    # 67 pytest unit & integration tests
├── frontend/                     # Next.js 14 light-table landing + console
│   ├── src/app/                  # App router: `/` landing, `/console` flight-check
│   ├── src/components/
│   │   ├── Console.tsx           # Console shell, audit stream & keyboard shortcuts
│   │   ├── ScanViewer.tsx        # Left pane: radiology key-slice + Span-Guard highlight
│   │   ├── LabSparkline.tsx      # Center pane: kinetic sparklines + judge sandbox
│   │   ├── DischargeEditor.tsx   # Right pane: discharge summary + 1-click patch loop
│   │   ├── SignReceiptDialog.tsx # Sign-off receipt dialog (shadcn Dialog pattern)
│   │   ├── TelemetryBar.tsx      # Bottom bar: progressive pipeline telemetry & spend ledger
│   │   ├── BenchmarkView.tsx     # Lazy-loaded Model Benchmarks visualization tab
│   │   └── landing/              # Landing page, scroll film & 3D volume components
│   ├── src/lib/                  # API client, analytical clinical math & volume-scene engine
│   └── test-phase3.cjs           # Playwright automated 6-step console verification suite
├── eval/
│   ├── benchmark.py              # Reproducible 12-case × 3-config evaluation harness
│   └── results_latest.json       # Fixture-routing scores, public-rate cost estimates, design targets
├── docs/assets/                  # Console screenshot artifacts
├── Dockerfile                    # Container definition
├── docker-compose.yml            # Multi-service local & cloud compose file
├── Makefile                      # make dev, make judge-demo, make benchmark, make benchmark-live
└── LICENSE                       # MIT License
```

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).

<div align="center">
<sub>I built SilentCatch as an experimental prototype for surfacing cross-modal discharge contradictions. Not a validated clinical device.</sub>
</div>

---

## 🛠️ Nebius & NVIDIA Developer Feedback

I built SilentCatch on Nebius Token Factory with NVIDIA Nemotron models (Nano 30B gate, Super 120B failsafe, Ultra 550B reasoning, Super-VL 120B vision), plus one live smoke run of ED-104 against Nebius on Oct 29 (2/2 verdicts verified, ~25s, ~$0.01). Everything below comes from that work.

### Onboarding

Onboarding took one API key and one base URL. The OpenAI-compatible endpoint meant my whole client was `OpenAI(api_key, base_url)` plus `chat.completions.create`, with my own retry ladder on top (`max_retries=0`). The one snag: model ID casing drifted from the documented names, so startup resolves exact IDs from `GET /v1/models` with substring matchers and falls back to hardcoded defaults. That resolution code exists only because the IDs moved.

### What worked well

The tiered model family fits a safety gate. Nano 30B with thinking disabled serves the triage gate inside its 8s ceiling, so clean discharges clear before Ultra ever runs; my public-rate estimates put the tiered path 44% below Ultra-only per 1k discharges. The `enable_thinking` toggle via `extra_body` worked as documented. Usage tokens came back on every response, which my spend ledger needs to enforce the $0.05/discharge and $2.00/day caps. Without usage in the response, the circuit-breaker design would not work.

### What needs improvement

Three things, in order of pain. First, constrained decoding. I found no JSON-schema response option, so strict `FindingSpec` output required a client-side parser (markdown-fence stripping plus one repair retry carrying the validation error). A `response_format` with schema would delete that whole module. Second, Ultra 550B latency. The ED-104 smoke run took ~25s end to end, against my 20s reasoning timeout. That fits a pre-signoff gate with a progress indicator, but it rules out anything inline; time-to-first-token is the number I would want improved and documented. Third, congestion visibility. I built a Super-120B failsafe tier for when Ultra is busy, but I had no queue-depth or load signal to route on, so failover is purely timeout-driven and blind.

### Would I build with them again

Yes. The OpenAI-compatible surface plus the Nano-to-Ultra cost ladder is the shape a staged interlock wants: cheap stages clear the easy cases, and the expensive model only sees the hard ones. I would budget the same way next time, with deterministic guards first, Ultra last, and timeouts plus a failsafe tier assumed from day one.
