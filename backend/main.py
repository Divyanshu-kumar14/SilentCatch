"""SilentCatch FastAPI entrypoint — Phase 2: SSE audit stream added on /api/audit-stream.

Phase 0 scope: /healthz (FR-2.2 telemetry + R-3 model-ID resolution) — retained.
Phase 2 scope:
- POST /api/audit-stream: 4-stage audit streamed as Server-Sent Events with
  per-stage telemetry, spend ledger and automatic replay fallback (FR-2.2,
  NFR §7). Accepts a patched encounter for the 1-click "Apply Safe Patch &
  Re-Verify" loop (re-audit of ED-104's patched packet hits the fast path).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend import config
from backend.engine import pipeline
from backend.engine.replay import ReplayStore
from backend.fixtures.loader import load_encounter
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

# Module-scoped runtime state: vision cache (D-1) + replay captures + day ledger
_vision_cache: dict[str, object] = {}
_replay_store = ReplayStore()


class AuditRequest(BaseModel):
    encounter_id: str
    encounter: Encounter | None = None  # permits the patched-packet re-audit


@app.get("/healthz")
async def healthz() -> dict:
    """Liveness + config introspection. Always 200, never leaks keys."""
    resolved = getattr(config, "resolved_model_ids", config.DEFAULT_MODEL_IDS)
    return {
        "status": "ok",
        "inference_mode": "LIVE" if config.NEBIUS_API_KEY else "REPLAYED",
        "nebius_base_url": config.NEBIUS_BASE_URL,
        "models": {
            "vision": resolved.get("vision"),
            "gate": resolved.get("gate"),
            "reasoning": resolved.get("reasoning"),
            "failsafe": resolved.get("failsafe"),
        },
        "tavily_live": bool(config.TAVILY_API_KEY),
        "spend_caps": config.spend_caps(),
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

