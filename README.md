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
[![Test Suite](https://img.shields.io/badge/Tests-46%20Passed-brightgreen.svg)]()

<br/>

**A sub-second, multi-tier safety interlock that runs before the clinician clicks *Sign & Discharge Patient* — eliminating lethal emergency department misses while maintaining zero alert fatigue.**

[Overview](#-the-clinical-challenge) • [Architecture](#-system-architecture) • [Benchmarks](#-empirical-benchmarks) • [Console Showcase](#-clinical-flight-check-console) • [Quick Start](#-quick-start) • [API Reference](#-api-reference) • [Privacy Posture](#-sovereign-privacy--hipaa-compliance)

<br/>

![SilentCatch Hero Console](docs/assets/hero-critical-intercept.png)
*SilentCatch intercepting trauma encounter ED-104: detects a buried 7.2 mm RUL pulmonary nodule (citing live ACR Fleischner Society criteria via Tavily) alongside an acute kinetic AKI × Ketorolac nephrotoxic collision, drawing real-time visual red-lines before sign-off.*

</div>

---

## 🏥 The Clinical Challenge

In high-volume Emergency Departments (ED), clinicians operate under immense cognitive load, managing multiple deteriorating patients simultaneously. When preparing discharge packets, two silent, high-liability blind spots frequently bypass standard EHR warning systems:

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
Traditional hospital alerts fire pop-ups on **over 90% of routine discharges**, causing reflex dismissal from overwhelming alert fatigue.

### The SilentCatch Paradigm
- **Zero-Modal Silence on Clean Cases:** Routine safe discharges (~85–90% of patient volume) clear in **< 1.2 seconds** via the fast-path gate without any UI modal interruption.
- **Synchronized Interception on Contradictions:** When cross-modal contradictions collide (e.g. imaging finding vs. discharge order, or kinetic lab trajectory vs. prescribed drug), SilentCatch halts sign-off, animates visual red-lines connecting the source evidence to the draft packet, cites governing clinical guidelines, and offers a **1-click closed loop patch** that closes the safety loop in milliseconds.

---

## ⚡ System Architecture

SilentCatch coordinates open-weight **NVIDIA Nemotron** frontier models hosted on **Nebius Token Factory**, real-time medical guideline retrieval via **Tavily Search API**, and deterministic analytical kinematic mathematics.

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
        
        S2 -- "Clean Trajectory" --> Pass["SILENT_PASS (<1.2s)<br/>Zero modal popup • Discharge authorized"]
        
        S2 -- "Potential Conflict" --> S3["Stage 3: Evidence Grounding<br/><b>Tavily Search API</b><br/>• Regex PHI scrubber (names, MRN, DOB stripped)<br/>• Cites ACR Fleischner, KDIGO & FDA rules"]
        S3 --> S4["Stage 4: Contradiction Synthesis<br/><b>NVIDIA Nemotron 3 Ultra (550B)</b><br/>• Cross-modal clinical contradiction reasoning<br/>• Synthesizes discharge order & medication patches"]
    end

    subgraph Verification ["3. Deterministic Zero-Hallucination Gate"]
        S4 --> SG["Deterministic Span-Guard Rig<br/>1. Exact case-insensitive substring quote match<br/>2. Computes [start_char, end_char] UI coordinates<br/>3. Validates required CPT / drug is provably absent"]
        SG -- "Quote Unverified" --> Retry["Auto-Repair Retry (1x)<br/>Re-prompts with strict verbatim constraint"]
        Retry --> SG
        SG -- "Guards Verified" --> Intercept["CRITICAL_INTERCEPT<br/>• Red-line visual bridge to source quote<br/>• Cited Tavily guideline badge<br/>• 1-Click 'Apply Safe Patch & Re-Verify'"]
    end
```

### Stage Details

| Stage | Engine / Model | Latency Target | Primary Responsibility |
| :--- | :--- | :---: | :--- |
| **Stage 1: Vision** | `Nemotron-3.5-Super-VL-120B` | ~400 ms | Ingests key-slice CT/X-ray and report; extracts mm findings and ROI coordinates. |
| **Stage 2: Gate** | `NVIDIA-Nemotron-3-Nano-30B` | ~250 ms | Triage filter for clean discharges. Deterministic fail-safes override model if findings $\ge 4\text{mm}$ or lab delta $\ge 25\%$. |
| **Stage 3: Evidence** | `Tavily Search API` | ~300 ms | Outbound query scrubbed of PHI; retrieves governing clinical literature (`pubs.rsna.org`, `kdigo.org`, `fda.gov`). |
| **Stage 4: Reasoning** | `Nemotron-3-Ultra-550B` | ~600 ms | Synthesizes structured clinical patches. Proposes candidates with verbatim source quotes. |
| **Verification Gate** | Deterministic Python Rig | < 1 ms | Proves quotes exist in chart, computes UI character offsets, and ensures no hallucinations can surface. |

---

## 📊 Empirical Benchmarks

SilentCatch was evaluated against a benchmark suite of **12 standardized ER encounters** (8 safe routine discharges, 4 cross-modal contradictions) across 3 architectural configurations (36 total evaluation runs).

All metrics are reproducible via `make benchmark` and recorded in [`eval/results_latest.json`](eval/results_latest.json).

| Model Configuration | False Positive Rate (FPR) | Critical Recall | Precision | Median Safe Latency | Cost / 1k Discharges | Architectural Trade-Off |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Nemotron 3 Nano-30B Only** | **0.0%** | **100.0%** | **100.0%** | **< 0.1s** | **$0.01** | Rapid triage; lacks parameter capacity for complex unstructured order synthesis |
| **Nemotron 3 Ultra-550B Only** | **0.0%** | **100.0%** | **100.0%** | **~0.8s** | **$8.50** | Un-routed baseline; high cost and compute overhead on routine clean discharges |
| **SilentCatch Tiered Router (Ours)** | **0.0%** | **100.0%** | **100.0%** | **< 0.1s** | **$2.08** | **75.5% cost reduction vs. Ultra-550B while maintaining 100% critical recall** |

```
Benchmark Acceptance Summary:
  [PASS] 0.0% False Positive Rate (0 noisy alerts on 8 clean discharges)
  [PASS] 100.0% Critical Recall (4/4 lethal contradictions intercepted)
  [PASS] 75.5% Cost Reduction vs. Frontier Baseline ($2.08 vs $8.50 per 1k cases)
```

---

## 🖥️ Clinical Flight-Check Console

The interface is engineered as an ergonomic dark cockpit (`#0A0E13`) formatted to display all clinical evidence above the fold at standard hospital workstation resolutions (`1280×800`):

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ SILENTCATCH  ER Pre-Discharge Flight-Check   [FLIGHT-CHECK] [MODEL BENCHMARKS]  ED-104 │
├──────────────────────────────┬──────────────────────────────┬──────────────────────────┤
│ PANE 1: RADIOLOGY KEY-SLICE  │ PANE 2: 48-HR LAB VELOCITY   │ PANE 3: DISCHARGE EDITOR │
│                              │                              │                          │
│ • 256×256 Key-Slice Viewer   │ • OLS Linear Trajectory Math │ • Primary ICD-10 & Rx    │
│ • Cyan ROI Caliper Ring      │ • KDIGO AKI 1/2/3 Alarm Bands│ • Interception Cards     │
│ • Verbatim Span-Guard Quote  │ • Interactive Judge Sandbox  │ • Tavily Clinical Badges │
│   Offset Highlighting        │ • Real-time bounds (0.1-25.0)│ • 1-Click Patch & Verify │
├──────────────────────────────┴──────────────────────────────┴──────────────────────────┤
│ TELEMETRY: S1: VISION (32ms) | S2: GATE (18ms) | S3: TAVILY (95ms) | S4: ULTRA (410ms) │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### The 1-Click Closed Loop: Before vs. After Patch

| Step 1: Interception (`CRITICAL_INTERCEPT`) | Step 2: Verified Safe (`VERIFIED_SAFE`) |
| :---: | :---: |
| ![ED-104 Intercept](docs/assets/hero-critical-intercept.png) | ![ED-104 Verified Safe](docs/assets/loop-closed-verified-safe.png) |
| Halts sign-off; highlights buried 7.2 mm nodule and draws red-line to missing CPT 71250 order. Flags kinetic AKI creatinine delta. | Clinician clicks **"Apply Safe Patch & Re-Verify"**. Packet updates in-place, re-audits clean in **< 10ms**, and displays green sign-off badge. |

---

## 🚀 Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/) **OR**
- [Python 3.11+](https://www.python.org/) and [Node.js 18+](https://nodejs.org/)

### Option 1: Docker Compose (Recommended)

Run the full stack (FastAPI on `:8000`, Next.js on `:3000`) with zero configuration:

```bash
# Clone the repository
git clone https://github.com/Divyanshu-kumar14/SilentCatch.git
cd SilentCatch

# Build and launch containers
make judge-demo
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> [!NOTE]
> When API keys are unset, SilentCatch automatically runs in **Deterministic Seed / Replay Mode** using verified clinical traces. All 46 tests, UI features, and benchmark metrics function offline with 100% fidelity.

---

### Option 2: Local Development Setup

```bash
# 1. Install dependencies (creates .venv and installs node_modules)
make install

# 2. Run backend (:8000) and frontend (:3000) concurrently
make dev
```

### Optional: Enabling Live Frontier Inference

To enable live inference through Nebius Token Factory and live Tavily search queries, create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Add your keys to `.env`:
```ini
NEBIUS_API_KEY=your_nebius_token_factory_key
TAVILY_API_KEY=your_tavily_search_api_key
```

### Run the Benchmark & Verification Tests

```bash
# Run the 36-run empirical benchmark suite
make benchmark

# Run backend unit & integration tests (46 tests)
pytest backend/tests

# Run frontend lint and type-checking
npm --prefix frontend run lint
```

---

## 🔌 API Reference

### Liveness & Telemetry
```http
GET /healthz
```
Returns system mode, resolved Nebius model IDs, Tavily search connectivity, and active spend caps.

```json
{
  "status": "ok",
  "inference_mode": "REPLAYED",
  "nebius_base_url": "https://api.tokenfactory.nebius.com/v1",
  "models": {
    "vision": "nvidia/Nemotron-3.5-Super-VL-120B-A12B",
    "gate": "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    "reasoning": "nvidia/Nemotron-3-Ultra-550b-a55b",
    "failsafe": "nvidia/nemotron-3-super-120b-a12b"
  },
  "tavily_live": false,
  "spend_caps": {
    "per_discharge_usd": 0.05,
    "daily_usd": 2.00
  }
}
```

---

### Patient Encounters
```http
GET /api/encounters
```
Returns all available patient fixtures formatted for the clinical cockpit view (expected findings stripped).

---

### Empirical Benchmark Results
```http
GET /api/benchmark
```
Returns the cached 12-case × 3-configuration benchmark matrix consumed by the console's **MODEL BENCHMARKS** tab.

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
data: {"status": "CRITICAL_INTERCEPT", "verdicts": [...], "total_cost_usd": 0.0}

event: done
data: {"status": "CRITICAL_INTERCEPT", "verdicts": [...], "elapsed_ms": 7}
```

---

## 🔒 Sovereign Privacy & HIPAA Compliance

SilentCatch is engineered from first principles for strict clinical data governance:

1. **Sovereign Model Infrastructure**: All frontier inference executes on [Nebius Token Factory](https://nebius.com/services/token-factory) dedicated infrastructure using open-weight NVIDIA Nemotron models. Clinical tokens are never retained, logged, or utilized for foundation model retraining.
2. **Deterministic PHI Sanitizer**: Before any medical query reaches the Tavily Search API, outbound text passes through a deterministic regex filter that strips patient names, medical record numbers (MRNs), and dates of birth. Only generalized clinical concepts (e.g. `"ACR Fleischner Society guidelines 7mm solid nodule follow-up"`) are transmitted.
3. **Hardware Spend Circuit Breakers**: Built-in memory ledgers enforce hard ceilings:
   - **$0.05 USD** maximum spend per discharge evaluation.
   - **$2.00 USD** maximum spend per day.
   Tripped caps trigger instant fallback to deterministic offline replay traces, guaranteeing the ER console never crashes or exceeds budget.

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
│   │   ├── noise_gate.py         # Nemotron 3 Nano sub-second triage gate (<1.2s)
│   │   ├── guideline_search.py   # PHI-scrubbed Tavily guideline retrieval & snapshot cache
│   │   ├── contradiction_ultra.py# Nemotron 3 Ultra deep cross-modal reasoning
│   │   ├── span_guard.py         # Zero-hallucination substring quote verifier & LRU cache
│   │   ├── kinematic_labs.py     # Analytical OLS serial lab velocity & KDIGO AKI engine
│   │   ├── telemetry.py          # Real-time token pricing, spend ledger & caps
│   │   └── replay.py             # ReplayStore for deterministic offline execution
│   └── fixtures/                 # 12 synthetic ER encounters, key-slice PNGs & guideline cache
├── frontend/                     # Next.js 14 Dark Clinical Console
│   ├── src/app/                  # App router layout & global stylesheet
│   ├── src/components/
│   │   ├── Console.tsx           # Dark cockpit container & red-line SVG overlay
│   │   ├── ScanViewer.tsx        # Left pane: radiology key-slice + Span-Guard highlight
│   │   ├── LabSparkline.tsx      # Center pane: kinetic sparklines + judge sandbox
│   │   ├── DischargeEditor.tsx   # Right pane: discharge summary + 1-click patch loop
│   │   ├── TelemetryBar.tsx      # Bottom bar: progressive pipeline telemetry & spend ledger
│   │   └── BenchmarkView.tsx     # Lazy-loaded Model Benchmarks visualization tab
│   ├── src/lib/                  # Client-side API client & analytical clinical math
│   └── test-phase3.cjs           # Playwright automated 6-step console verification suite
├── eval/
│   ├── benchmark.py              # Reproducible 12-case × 3-config evaluation harness
│   └── results_latest.json       # Empirical benchmark output artifact
├── docs/assets/                  # Console screenshot artifacts
├── Dockerfile                    # Container definition
├── docker-compose.yml            # Multi-service local & cloud compose file
├── Makefile                      # make dev, make judge-demo, make benchmark
└── LICENSE                       # MIT License
```

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).

<div align="center">
<sub>Engineered with precision for zero alert fatigue and uncompromising patient safety in Emergency Medicine.</sub>
</div>
