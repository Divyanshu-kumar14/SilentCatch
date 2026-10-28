"""SilentCatch FastAPI entrypoint — Phase 2: SSE audit stream added on /api/audit-stream.

Phase 0 scope: /healthz (FR-2.2 telemetry + R-3 model-ID resolution) — retained.
Phase 2 scope:
- POST /api/audit-stream: 4-stage audit streamed as Server-Sent Events with
  per-stage telemetry, spend ledger and automatic replay fallback (FR-2.2,
  NFR §7). Accepts a patched encounter for the 1-click "Apply Safe Patch &
  Re-Verify" loop (re-audit of ED-104's patched packet hits the fast path).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend import config
from backend.engine import pipeline
from backend.engine.replay import ReplayStore
from backend.fixtures.loader import (
    FIXTURES_DIR,
    load_encounter,
    load_encounters,
    load_encounters_dumped,
)
from backend.schemas import Encounter


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Resolve exact Token Factory model IDs once at boot (PRD §9 R-3)."""
    import httpx

    with httpx.Client() as client:
        config.resolved_model_ids = config.resolve_model_ids(client)
    yield


app = FastAPI(title="SilentCatch", version="0.2.0", lifespan=lifespan)

# Frontend (dev :3000, prod preview/vercel) needs cross-origin SSE + docs.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|https://.*\.vercel\.app)$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve key-slice fixture images directly to the frontend console
_images_dir = FIXTURES_DIR / "images"
if _images_dir.is_dir():
    app.mount("/fixtures/images", StaticFiles(directory=_images_dir), name="images")

# Module-scoped runtime state: vision cache (D-1) + replay captures + day ledger
_vision_cache: dict[str, object] = {}
_replay_store = ReplayStore()


class AuditRequest(BaseModel):
    encounter_id: str
    encounter: Encounter | None = None  # permits the patched-packet re-audit


@app.get("/healthz")
async def healthz() -> dict:
    """Liveness + configuration introspection. Always 200, never leaks keys.

    This endpoint reports whether live inference is *configured*; it never makes
    a provider call, so it must not claim that a model was actually invoked.
    """
    resolved = getattr(config, "resolved_model_ids", config.DEFAULT_MODEL_IDS)
    live_capable = bool(config.NEBIUS_API_KEY)
    tavily_configured = bool(config.TAVILY_API_KEY)
    return {
        "status": "ok",
        "inference_mode": "LIVE_CAPABLE" if live_capable else "REPLAY_ONLY",
        "live_capable": live_capable,
        "mode_note": (
            "NEBIUS_API_KEY configured; audits may call the provider. "
            "This health check makes no model call."
            if live_capable
            else "No NEBIUS_API_KEY; audits use deterministic replay/seed paths."
        ),
        "nebius_base_url": config.NEBIUS_BASE_URL,
        "models": {
            "vision": resolved.get("vision"),
            "gate": resolved.get("gate"),
            "reasoning": resolved.get("reasoning"),
            "failsafe": resolved.get("failsafe"),
        },
        "tavily_configured": tavily_configured,
        # Backward-compatible alias: means "configured", not "called".
        "tavily_live": tavily_configured,
        "spend_caps": config.spend_caps(),
    }


_benchmark_cache: dict | None = None
_benchmark_mtime: float = 0.0


@app.get("/api/encounters")
async def list_encounters() -> list[dict]:
    """Production view of all available encounters (expected_findings stripped)."""
    return load_encounters_dumped()


@app.get("/api/benchmark")
async def get_benchmark() -> dict:
    """Cached benchmark artifact plus an explicit evaluation-mode label.

    Replay artifacts score deterministic fixture routing; live artifacts score
    provider responses. ``eval_mode`` lets the console state which one it shows.
    """
    global _benchmark_cache, _benchmark_mtime
    benchmark_file = Path(__file__).resolve().parent.parent / "eval" / "results_latest.json"
    try:
        mtime = benchmark_file.stat().st_mtime
        if _benchmark_cache is None or mtime != _benchmark_mtime:
            _benchmark_cache = json.loads(benchmark_file.read_text())
            _benchmark_mtime = mtime
        mode = _benchmark_cache.get("meta", {}).get("mode")
        if mode == "LIVE":
            eval_mode = "live_inference"
        elif mode == "REPLAYED":
            eval_mode = "fixture_deterministic"
        elif mode:
            eval_mode = "mixed_provenance"
        else:
            eval_mode = "unavailable"
        # Copy so each response carries eval_mode without mutating the cache.
        return {**_benchmark_cache, "eval_mode": eval_mode}
    except FileNotFoundError:
        return {
            "status": "pending",
            "eval_mode": "unavailable",
            "message": "Run make benchmark to generate results.",
        }


@app.post("/api/audit-stream")
async def audit_stream(body: AuditRequest) -> StreamingResponse:
    """Run the 4-stage audit and stream ordered SSE events.

    Body: either {encounter_id} (fixture) or {encounter_id, encounter} when the
    client sends an edited/patched packet for re-verification (FR-5.2 loop).
    """
    try:
        encounter = body.encounter or load_encounter(body.encounter_id)
    except KeyError as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=str(exc)) from exc

    events = pipeline.event_stream(
        encounter, vision_cache=_vision_cache, replay=_replay_store
    )
    return StreamingResponse(
        pipeline.serialize_sse(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

