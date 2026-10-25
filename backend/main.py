"""SilentCatch FastAPI entrypoint — Phase 0 scaffold.

Phase 0 scope: /healthz only (FR-2.2 telemetry + R-3 model-ID resolution).
Phase 2 adds POST /api/audit-stream (SSE) on top of this app.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend import config

app = FastAPI(title="SilentCatch", version="0.1.0")

# Frontend (dev :3000, prod preview/vercel) needs cross-origin SSE + docs.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|https://.*\.vercel\.app)$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def resolve_models() -> None:
    """Resolve exact Token Factory model IDs once at boot (PRD §9 R-3)."""
    import httpx

    with httpx.Client() as client:
        config.resolved_model_ids = config.resolve_model_ids(client)


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
