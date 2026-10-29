"""CORS allowlist tests: exact prod origin, local dev, no blanket Vercel trust."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend import config
from backend.main import app


def _preflight(origin: str):
    return TestClient(app).options(
        "/api/encounters",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )


def test_production_origin_is_allowed() -> None:
    res = _preflight("https://silentcatch.vercel.app")
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "https://silentcatch.vercel.app"


def test_localhost_dev_origin_is_allowed() -> None:
    res = _preflight("http://localhost:3000")
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_unapproved_vercel_tenant_is_rejected() -> None:
    res = _preflight("https://someone-elses-app.vercel.app")
    assert res.status_code == 400
    assert "access-control-allow-origin" not in res.headers


def test_allowed_origins_env_override(monkeypatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example, https://b.example/")
    assert config.allowed_origins() == ["https://a.example", "https://b.example"]


def test_allowed_origin_regex_is_opt_in(monkeypatch) -> None:
    monkeypatch.delenv("ALLOWED_ORIGIN_REGEX", raising=False)
    assert config.allowed_origin_regex() is None
    monkeypatch.setenv("ALLOWED_ORIGIN_REGEX", r"^https://preview-[a-z0-9]+\.vercel\.app$")
    assert config.allowed_origin_regex() == r"^https://preview-[a-z0-9]+\.vercel\.app$"
