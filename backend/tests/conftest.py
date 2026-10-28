"""Test isolation: unit tests must never reach a real provider.

The repo's `.env` may contain working NEBIUS/TAVILY keys. Tests that exercise the
live path inject an explicit stub transport; everything else must run the
deterministic/replay ladder even on a developer machine with keys configured.
"""

from __future__ import annotations

import pytest

from backend.engine import guideline_search, pipeline


@pytest.fixture(autouse=True)
def _offline_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "NEBIUS_API_KEY", None)
    monkeypatch.setattr(guideline_search, "TAVILY_API_KEY", None)
