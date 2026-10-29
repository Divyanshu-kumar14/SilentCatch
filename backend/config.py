"""SilentCatch config — Nebius Token Factory + Tavily settings and spend caps.

Contract (PRD §6 FR-2.2, §9 R-3):
- Reads API keys from env; never prints secret values.
- Resolves exact model IDs at startup via GET /v1/models (R-3). Falls back to
  PRD-documented IDs when resolution is impossible (no key / network failure)
  so the offline replay path always bootstraps.
- Enforces the in-memory spend ceiling ($0.05/discharge, $2.00/day).
"""

from __future__ import annotations

import logging
import os
from typing import Final

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger(__name__)

NEBIUS_BASE_URL: Final[str] = os.getenv(
    "NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1"
)
NEBIUS_API_KEY: Final[str | None] = os.getenv("NEBIUS_API_KEY") or None
TAVILY_API_KEY: Final[str | None] = os.getenv("TAVILY_API_KEY") or None

# PRD §6 FR-2.2: hard spend ceiling before switching to REPLAY_MODE.
MAX_COST_PER_DISCHARGE_USD: Final[float] = 0.05
MAX_DAILY_SPEND_USD: Final[float] = 2.00

# PRD §6 FR-2.2: live Tier-4 calls capped at 6s before failover (Fallback B).
REASONING_TIMEOUT_S: Final[float] = 6.0
# PRD §6 FR-3.1: Tavily soft timeout before guideline-cache fallback.
TAVILY_TIMEOUT_S: Final[float] = 3.5

# PRD §10 Fallback A: vision payload budget.
VISION_IMAGE_MAX_EDGE_PX: Final[int] = 768

# PRD §9 R-3 defaults — casing may drift; startup /v1/models resolution wins.
# (IDs verified against NVIDIA/Nebius public naming, HF-aligned, Oct 2026.)
DEFAULT_MODEL_IDS: Final[dict[str, str]] = {
    # Stage 1: annotated-slice + chart extraction
    "vision": "nvidia/Nemotron-3.5-Super-VL",
    # Stage 2: sub-second SILENT_PASS gate (thinking OFF)
    "gate": "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    # Stage 4: deep contradiction synthesis
    "reasoning": "nvidia/Nemotron-3-Ultra-550b-a55b",
    # Fallback B target when Ultra is congested
    "failsafe": "nvidia/nemotron-3-super-120b-a12b",
}

# Substring discriminators used to re-resolve IDs from GET /v1/models listings.
_ROLE_MATCHERS: Final[dict[str, tuple[str, ...]]] = {
    "vision": ("super-vl", "3.5-super-vl"),
    "gate": ("nano",),
    "reasoning": ("ultra",),
    "failsafe": ("super",),  # matched last; "vl" ids excluded explicitly
}


def resolve_model_ids(client: "httpx.Client") -> dict[str, str]:
    """Resolve exact Token Factory model IDs from GET /v1/models.

    Returns a role -> exact model ID map. On any failure returns the PRD
    defaults (never raises — offline/startup bootstrap must not crash).
    """
    import httpx  # local import keeps module importable in offline tests

    try:
        assert client is not None, "httpx client required"
        if not NEBIUS_API_KEY:
            logger.warning("NEBIUS_API_KEY unset — using default model IDs (replay mode)")
            return dict(DEFAULT_MODEL_IDS)
        resp = client.get(
            f"{NEBIUS_BASE_URL}/models",
            headers={"Authorization": f"Bearer {NEBIUS_API_KEY}"},
            timeout=10.0,
        )
        resp.raise_for_status()
        listed = [m.get("id", "") for m in resp.json().get("data", [])]
        lowered = [lid.lower() for lid in listed]

        resolved: dict[str, str] = {}
        for role, needles in _ROLE_MATCHERS.items():
            for needle, raw in zip(lowered, listed):
                if needle not in raw.lower():
                    continue
                if role == "failsafe" and "vl" in raw.lower():
                    continue  # failsafe is the text-only Super, not the VL variant
                if not any(n in raw.lower() for n in needles):
                    continue
                resolved[role] = raw
                break
        for role in _ROLE_MATCHERS:
            resolved.setdefault(role, DEFAULT_MODEL_IDS[role])
        logger.info("Nebius model IDs resolved: %s", resolved)
        return resolved
    except Exception as exc:  # noqa: BLE001 — bootstrap must never crash (PRD §7)
        logger.warning("Model-ID resolution failed (%s) — defaulting to PRD IDs", exc)
        return dict(DEFAULT_MODEL_IDS)


def resolved() -> dict[str, str]:
    """Active model IDs: startup-resolved values, or PRD defaults (R-3)."""
    return dict(globals().get("resolved_model_ids", DEFAULT_MODEL_IDS))


def spend_caps() -> dict[str, float]:
    return {
        "per_discharge_usd": MAX_COST_PER_DISCHARGE_USD,
        "daily_usd": MAX_DAILY_SPEND_USD,
    }


# Deployment CORS: exact origins, never a blanket `https://*.vercel.app` regex
# (that would trust every Vercel tenant). Preview deployments must be added
# explicitly through ALLOWED_ORIGINS or the opt-in ALLOWED_ORIGIN_REGEX.
DEFAULT_ALLOWED_ORIGINS: Final[tuple[str, ...]] = (
    "https://silentcatch.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)


def allowed_origins() -> list[str]:
    """Browser origins allowed to call the API (comma-separated env override)."""
    raw = os.getenv("ALLOWED_ORIGINS", "")
    configured = [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]
    return configured or list(DEFAULT_ALLOWED_ORIGINS)


def allowed_origin_regex() -> str | None:
    """Optional regex for approved preview deployments; unset by default."""
    raw = os.getenv("ALLOWED_ORIGIN_REGEX", "").strip()
    return raw or None
