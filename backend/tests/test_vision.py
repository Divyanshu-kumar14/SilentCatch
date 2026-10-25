"""Stage-1 gates (plan 2.1): seed parser, D-1 SHA cache, Fallback A, honest badges."""

from __future__ import annotations

import io

from backend.engine import vision_extractor
from backend.fixtures.loader import load_encounter


def _tiny_png(size: tuple[int, int] = (1024, 512)) -> bytes:
    """A real decodable PNG (F-5 guard: never feed garbage bytes to Pillow)."""
    from PIL import Image

    img = Image.new("RGB", size, color=(10, 200, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _fake_transport(responses: list[str]):
    calls: list[list[dict]] = []

    def transport(model_id, messages, *, timeout_s, extra_body=None) -> tuple[str, dict]:
        calls.append(messages)
        return responses[min(len(calls) - 1, len(responses) - 1)], {
            "prompt_tokens": 120,
            "completion_tokens": 60,
        }

    return transport, calls


def test_seed_parser_extracts_mm_findings_from_real_report() -> None:
    report = load_encounter("ED-104").radiology_study.report_text
    result, trace = vision_extractor.extract_findings(report, vision_cache={})
    assert result.source == "vl_seed"
    mm_finding = next(f for f in result.findings if not f.acute)
    assert mm_finding.measurement_mm == 7.2  # buried incidental nodule
    assert mm_finding.recommended_cpt == "71250"
    # Seed scope = mm-quantified sentences only: the mm-less fracture sentence
    # is intentionally never parsed (the VL model supplies it in live mode).
    assert result.findings
    assert all(f.measurement_mm is not None for f in result.findings)
    assert trace.stage == "vision" and trace.note == "text_only_fallback"


def test_transport_parses_wrapped_json() -> None:
    json_payload = (
        '{"findings":[{"description":"nodule","location":"RUL",'
        '"measurement_mm":7.2,"acute":false,"verbatim_quote":"Incidental 7.2 mm",'
        '"recommended_cpt":"71250"}],"vision_confidence":"HIGH"}'
    )
    fenced = f"Here you go:\n```json\n{json_payload}\n```\nDone."
    transport, calls = _fake_transport([fenced])
    result, trace = vision_extractor.extract_findings(
        "Incidental 7.2 mm nodule",
        image_png=_tiny_png(),
        transport=transport,
        model_id="m",
        vision_cache={},
    )
    assert result.source == "vl_live"
    assert result.findings[0].measurement_mm == 7.2
    assert trace.prompt_tokens == 120 and trace.completion_tokens == 60
    assert trace.replayed is False and trace.note == "vl_live"


def test_sha256_cache_skips_second_transport_call() -> None:
    json_payload = '{"findings":[],"vision_confidence":"HIGH"}'
    transport, calls = _fake_transport([json_payload, json_payload])
    cache: dict = {}
    png = _tiny_png()
    result1, _ = vision_extractor.extract_findings(
        "Incidental 7.2 mm nodule",
        image_png=png, transport=transport, model_id="m", vision_cache=cache,
    )
    result2, trace2 = vision_extractor.extract_findings(
        "Different report text",  # cache is keyed on image bytes (D-1), not text
        image_png=png, transport=transport, model_id="m", vision_cache=cache,
    )
    assert len(calls) == 1, "D-1: cache must suppress the second inference call"
    assert trace2.note == "cache_hit" and trace2.replayed is True
    assert result1.findings == result2.findings


def test_fallback_a_resizes_to_budget() -> None:
    from PIL import Image
    import io

    img = Image.new("RGB", (2048, 2048), color=(200, 30, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    normalized = vision_extractor.normalize_image_png(buf.getvalue())
    with Image.open(io.BytesIO(normalized)) as cropped:
        assert max(cropped.size) == vision_extractor.VISION_IMAGE_MAX_EDGE_PX


def test_missing_image_flags_low_confidence() -> None:
    result, trace = vision_extractor.extract_findings(
        "Incidental 7.2 mm nodule", image_png=None, transport=None, vision_cache={}
    )
    assert result.vision_confidence == "LOW"
    assert result.findings[0].measurement_mm == 7.2
    assert trace.replayed is True
