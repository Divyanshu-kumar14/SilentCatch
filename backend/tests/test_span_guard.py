"""Span-Guard gates (plan 1.3) — offsets map 1:1 to original text."""

from __future__ import annotations

from backend.engine.span_guard import (
    assert_absent,
    build_verbatim_retry_prompt,
    verify_quote,
)
from backend.fixtures.loader import load_encounter

REPORT = load_encounter("ED-104").radiology_study.report_text
P104 = load_encounter("ED-104").draft_discharge_packet
P102 = load_encounter("ED-102").draft_discharge_packet


def test_exact_quote_maps_to_original_offsets() -> None:
    quote = "Incidental 7.2 mm spiculated solid noncalcified nodule in the right upper lobe"
    span = verify_quote(REPORT, quote)
    assert span is not None and span.match_mode == "WS_PUNCT_COLLAPSED"
    # Round-trip: the ORIGINAL slice at those coordinates IS the quote
    assert REPORT[span.start_char : span.end_char] == quote


def test_whitespace_paraphrase_still_verified() -> None:
    """PRD FR-4.2 edge: LLM drops the space — '7.2 mm' -> '7.2mm' (words intact)."""
    span = verify_quote(
        REPORT,
        "Incidental 7.2mm spiculated solid noncalcified nodule in the right upper lobe",
    )
    assert span is not None
    assert REPORT[span.start_char] == "I"
    # The reconstructed ORIGINAL slice reproduces the true report wording
    assert (
        REPORT[span.start_char : span.end_char]
        == "Incidental 7.2 mm spiculated solid noncalcified nodule in the right upper lobe"
    )


def test_case_variant_matches() -> None:
    span = verify_quote(REPORT, "INCIDENTAL 7.2 MM SPICULATED")
    assert span is not None
    assert span.start_char == REPORT.find("Incidental 7.2 mm spiculated")


def test_hallucinated_digit_rejected() -> None:
    """The one non-negotiable: changed measurement content MUST be rejected."""
    assert verify_quote(REPORT, "Incidental 9.9 mm spiculated nodule") is None
    assert verify_quote(REPORT, "Incidental 7.2 mm lesion on the left") is None  # wrong side


def test_empty_quote_rejected() -> None:
    assert verify_quote(REPORT, "   ") is None


def test_order_absence_gate() -> None:
    """FR-4.2b: alert only when required CPT is provably absent."""
    assert assert_absent(P104, cpt_code="71250") is True   # ED-104 lacks it -> alert fires
    assert assert_absent(P102, cpt_code="71250") is False  # ED-102 has it -> never nag
    assert assert_absent(P104, drug_name="Ketorolac") is False  # drug present (needed for collision branch)
    assert assert_absent(P102, drug_name="Ketorolac") is True


def test_verbatim_retry_prompt_carries_error() -> None:
    prompt = build_verbatim_retry_prompt("SAY QUOTE", "field source_quote mismatch")
    assert "STRICT REPAIR RULES" in prompt
    assert "source_quote MUST be an exact substring" in prompt
    assert "field source_quote mismatch" in prompt  # original error surfaces
    assert "SAY QUOTE" in prompt  # original request is preserved
