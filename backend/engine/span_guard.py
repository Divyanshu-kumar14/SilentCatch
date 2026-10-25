"""Deterministic Span-Guard (PRD FR-4.2) — the zero-hallucination gate.

Contract:
- verify_quote(source, quote): the ONLY way a verdict gets its UI coordinates.
  Two-stage normalization (P1: lowercase + whitespace/punct -> single space;
  P2: alphanumeric-only) so LLM paraphrases like "7 mm" -> "7mm" still match,
  while digit-content changes ("7.2" -> "7.5") are rejected. Returns exact
  (start_char, end_char) into the ORIGINAL text, or None (reject + caller retries).
- assert_absent(packet, cpt_code=..., drug=...): True only when the recommended
  CPT code / medication is provably NOT already in the discharge packet.
- build_verbatim_retry_prompt(original_prompt, error): the Stage-4 retry wrapper;
  the caller (contradiction_ultra, Phase 2) supplies the transport.

No alert is rendered without verify_quote() succeeding (PRD R-1).
"""

from __future__ import annotations

import functools
import re
import unicodedata

from backend.schemas import DischargePacket, VerifiedSpan

_WS_RE = re.compile(r"\s+")
_ALNUM_ONLY_RE = re.compile(r"[^a-z0-9]+")


@functools.lru_cache(maxsize=128)
def _normalize_keep_offsets(text: str) -> tuple[str, list[int]]:
    """P1 normalization: lowercase, every non-alphanumeric -> one space;
    collapse runs -> single char. Returns (normalized, char_index_map)
    where char_index_map[i] is the ORIGINAL index of normalized char i.
    """
    lowered = unicodedata.normalize("NFKC", text).lower()
    out: list[str] = []
    mapping: list[int] = []
    pending_space = False
    for idx, ch in enumerate(lowered):
        if ch.isalnum():
            if pending_space:
                out.append(" ")
                mapping.append(idx - 1)  # point the space at where it began
                pending_space = False
            out.append(ch)
            mapping.append(idx)
        else:
            pending_space = True
    # trim leading trimmed-space equiv: if text began with punctuation no space was
    # emitted, so no trim needed here; trailing punctuation also never emitted.
    return "".join(out), mapping


@functools.lru_cache(maxsize=128)
def _normalize_alnum_only(text: str) -> tuple[str, list[int]]:
    """P2 normalization: drop everything except [a-z0-9]; map kept chars back."""
    lowered = unicodedata.normalize("NFKC", text).lower()
    kept_chars: list[str] = []
    mapping: list[int] = []
    for idx, ch in enumerate(lowered):
        if ch.isalnum():
            kept_chars.append(ch)
            mapping.append(idx)
    return "".join(kept_chars), mapping


def verify_quote(source: str, quote: str) -> VerifiedSpan | None:
    """Return exact original-text offsets, or None when the quote is unprovable."""
    if not quote.strip():
        return None

    norm_src, norm_map = _normalize_keep_offsets(source)
    norm_quote, _ = _normalize_keep_offsets(quote)
    pos = norm_src.find(norm_quote)
    if pos >= 0:
        start_orig = norm_map[pos]
        end_orig = norm_map[pos + len(norm_quote) - 1] + 1
        return VerifiedSpan(
            start_char=start_orig,
            end_char=end_orig,
            match_mode="WS_PUNCT_COLLAPSED",
        )

    # P2: whitespace-only paraphrase ("7 mm" vs "7mm", "mg/dL" vs "mg dl")
    flat_src, flat_map = _normalize_alnum_only(source)
    flat_quote, _ = _normalize_alnum_only(quote)
    pos = flat_src.find(flat_quote)
    if pos >= 0:
        start_orig = flat_map[pos]
        end_orig = flat_map[pos + len(flat_quote) - 1] + 1
        return VerifiedSpan(
            start_char=start_orig, end_char=end_orig, match_mode="ALNUM_ONLY"
        )
    return None


def assert_absent(
    packet: DischargePacket,
    cpt_code: str | None = None,
    drug_name: str | None = None,
) -> bool:
    """True ONLY when the required order/drug is provably missing from the packet."""
    if cpt_code:
        for order in packet.follow_up_orders:
            if order.cpt_code.strip().upper() == cpt_code.strip().upper():
                return False
    if drug_name:
        needle = drug_name.strip().lower()
        for rx in packet.prescriptions:
            if needle in rx.drug_name.strip().lower():
                return False
    return True


def build_verbatim_retry_prompt(original_prompt: str, error: str) -> str:
    """One automatic repair retry wrapper (FR-4.2 edge): re-emit JSON with verbatim quote."""
    return (
        "Your previous output FAILED deterministic verification. "
        f"Validation error: {error}\n\n"
        "STRICT REPAIR RULES:\n"
        "1. source_quote MUST be an exact substring of the radiology report or lab "
        "note you were given — copy it character-for-character (whitespace variants "
        "are tolerated, wording/hemisphere changes are not).\n"
        "2. Do not invent measurements, CPT codes, or guideline URLs. Omit a field "
        "rather than fabricate it.\n"
        "3. Return ONLY the corrected JSON object — no markdown fences, no prose.\n\n"
        f"ORIGINAL REQUEST:\n{original_prompt}"
    )
