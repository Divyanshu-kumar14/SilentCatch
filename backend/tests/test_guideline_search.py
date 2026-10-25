"""Stage-3 gates (plan 2.3): PHI scrubber, domain filter, timeout -> snapshot."""

from __future__ import annotations

import httpx

from backend.engine import guideline_search
from backend.schemas import FindingKind


def test_scrubber_strips_patient_identifiers() -> None:
    dirty = "Patient John Smith MRN:99232 DOB 1980-01-01 fleischner nodule 7mm follow-up"
    clean = guideline_search.scrub_phi(dirty)
    assert "John" not in clean and "Smith" not in clean
    assert "MRN" not in clean and "99232" not in clean
    assert "1980" not in clean
    assert "fleischner nodule 7mm follow-up" in clean


def test_template_queries_match_prd_examples() -> None:
    drop = guideline_search.template_queries(FindingKind.INCIDENTAL_FINDING_DROP)
    collision = guideline_search.template_queries(FindingKind.KINETIC_MED_COLLISION)
    assert any("Fleischner" in q for q in drop)
    assert any("ketorolac" in q.lower() for q in collision)
    assert any("KDIGO" in q for q in collision)


def test_search_passes_tavily_verified_params() -> None:
    """Stub records the outbound payload — contract params must be exact."""
    captured: dict = {}

    def fake_post(query: str):
        captured["query"] = query
        return (
            [
                {"title": "Fleischner 2017", "url": "https://pubs.rsna.org/doi/10.1148/radiol.2017161659", "content": "6-8mm solid nodule CT at 6-12 months"},
                {"title": "junk", "url": "", "content": "no url"},  # invalid row filtered
            ],
            {},
        )

    result, trace = guideline_search.search(
        ["fleischner nodule"], http_post=fake_post
    )
    assert captured["query"] == "fleischner nodule"
    assert len(result.guidelines) == 1  # url-less row dropped
    assert result.guidelines[0].source == "tavily_live"
    assert trace.note == "tavily_live" and trace.replayed is False


def test_timeout_falls_back_to_snapshot() -> None:
    def slow_post(query):  # must never hang: raise like httpx timeout
        raise httpx.TimeoutException("tavily timed out")

    result, trace = guideline_search.search(
        ["fleischner nodule"], http_post=slow_post
    )
    assert result.degraded is True
    assert len(result.guidelines) >= 1  # plan verify: snapshot returns >=1 URL
    assert result.guidelines[0].source == "cache_snapshot"
    assert any("fleischner" in g.url.lower() or "rsna" in g.url.lower() for g in result.guidelines)
    assert trace.note == "cache_snapshot"


def test_snapshot_uses_verified_kdigo_and_fda_rows() -> None:
    result, _ = guideline_search.search(
        ["fda ketorolac contraindication"], http_post=None  # no Tavily + explicit None
    )
    urls = " ".join(g.url for g in result.guidelines)
    assert "kdigo.org" in urls or "accessdata.fda.gov" in urls
