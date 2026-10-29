# SilentCatch frontend

My Next.js 14 console for the SilentCatch interlock: a light-table landing page at `/` and the three-column flight-check console at `/console`. It talks to my FastAPI backend over SSE (`POST /api/audit-stream`) and never holds API keys — the only env var is the public backend origin.

## Run it

```bash
npm ci
npm run dev        # http://localhost:3000 (expects the backend on :8000)
```

Point at another backend with `NEXT_PUBLIC_API_URL` (baked in at build time):

```bash
NEXT_PUBLIC_API_URL=https://3.26.189.111.sslip.io npm run build
```

## Verify it

```bash
npm run lint       # ESLint, zero warnings
npx tsc --noEmit   # type-check
npm run build      # standalone production build
```

`npm test` runs my Playwright console suite (`test-phase3.cjs`, needs both servers up).

## Layout

- `src/app/` — routes: `/` landing, `/console` flight-check
- `src/components/` — console panes (`ScanViewer`, `LabSparkline`, `DischargeEditor`), `TelemetryBar`, `BenchmarkView`, `SignReceiptDialog`, `landing/`
- `src/lib/` — API client + SSE parser (`api.ts`), clinical math, 3D scene engine
- `src/data/results_latest.json` — benchmark artifact copy (synced from `eval/` via `make sync-benchmark-artifact`, never hand-edited)

See the root [README](../README.md) for the full picture. Live at <https://silentcatch.vercel.app/console>.
