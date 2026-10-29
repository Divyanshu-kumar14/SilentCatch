"""Benchmark artifact read failures must degrade, never 500 the console."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from backend import main
from backend.main import app


def _client() -> TestClient:
    return TestClient(app)


def test_permission_error_returns_pending(monkeypatch) -> None:
    monkeypatch.setattr(main, "_benchmark_cache", None)
    monkeypatch.setattr(main, "_benchmark_mtime", 0.0)
    real_stat = Path.stat

    def deny_artifact(self: Path, *args, **kwargs):
        if self.name == "results_latest.json":
            raise PermissionError("artifact mode 600")
        return real_stat(self, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", deny_artifact)
    res = _client().get("/api/benchmark")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "pending"
    assert body["eval_mode"] == "unavailable"


def test_corrupt_artifact_returns_pending(monkeypatch) -> None:
    monkeypatch.setattr(main, "_benchmark_cache", None)
    monkeypatch.setattr(main, "_benchmark_mtime", 0.0)
    real_read_text = Path.read_text

    def corrupt(self: Path, *args, **kwargs):
        if self.name == "results_latest.json":
            return "{not json"
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", corrupt)
    res = _client().get("/api/benchmark")
    assert res.status_code == 200
    assert res.json()["eval_mode"] == "unavailable"
