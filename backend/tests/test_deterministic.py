"""Phase-1 integration gate (plan 1.5): full deterministic sweep over 4 fixtures."""

from __future__ import annotations

from backend.engine.deterministic import run_deterministic_pipeline
from backend.fixtures.loader import load_encounter, load_eval_specs
from backend.schemas import FindingKind

SILENT_IDS = ("ED-101", "ED-102", "ED-103")
INTERCEPT_ID = "ED-104"


def _run(encounter_id: str):
    encounter = load_encounter(encounter_id)
    return run_deterministic_pipeline(
        encounter_id=encounter_id,
        radiology_report=encounter.radiology_study.report_text,
        lab_note=encounter.lab_note.text if encounter.lab_note else None,
        serial_labs=encounter.serial_labs,
        packet=encounter.draft_discharge_packet,
        candidates=load_eval_specs(encounter_id),
    )


def test_silent_encounters_send_zero_findings() -> None:
    for eid in SILENT_IDS:
        result = _run(eid)
        assert result.sent_findings == [], f"{eid} must stay SILENT (G1)"
        assert result.kinetic_flags == [] or eid == "ED-101"


def test_silent_encounters_have_no_kinetic_flags() -> None:
    for eid in SILENT_IDS:
        result = _run(eid)
        assert result.kinetic_flags == [], f"{eid} kinetic silence (G1) violated"


def test_ed104_sends_exactly_two_kinds() -> None:
    result = _run(INTERCEPT_ID)
    kinds = sorted(f.kind for f in result.sent_findings)
    assert kinds == [
        FindingKind.INCIDENTAL_FINDING_DROP,
        FindingKind.KINETIC_MED_COLLISION,
    ]
    assert len(result.sent_findings) == 2
    assert "KINETIC_AKI_STAGE_1" in result.kinetic_flags
    # Every surfaced quote carries real offsets into its source
    for finding in result.sent_findings:
        span = finding.verified_span
        assert span["end_char"] > span["start_char"]
        assert span["start_char"] >= 0
        src = finding.source_text
        assert span["end_char"] <= len(src)


def test_ed104_nodule_span_points_at_true_quote() -> None:
    """UI red-line contract: highlight offsets reproduce the verbatim evidence."""
    result = _run(INTERCEPT_ID)
    nodule = next(
        f
        for f in result.sent_findings
        if f.kind == FindingKind.INCIDENTAL_FINDING_DROP
    )
    quoted = nodule.source_text[
        nodule.verified_span["start_char"] : nodule.verified_span["end_char"]
    ]
    assert quoted == "Incidental 7.2 mm spiculated solid noncalcified nodule in the right upper lobe"


def test_hallucinated_candidate_never_surfaces() -> None:
    """Adversarial probe (quality-code 3-case): invented finding is rejected."""
    encounter = load_encounter("ED-104")
    bogus = load_eval_specs("ED-104")[0].model_copy(
        update={"source_quote": "Incidental 9.9 mm nodule in the left lung"}
    )
    result = run_deterministic_pipeline(
        encounter_id="ED-104",
        radiology_report=encounter.radiology_study.report_text,
        lab_note=encounter.lab_note.text if encounter.lab_note else None,
        serial_labs=encounter.serial_labs,
        packet=encounter.draft_discharge_packet,
        candidates=[bogus],
    )
    assert len(result.sent_findings) == 0
    assert result.findings[0].rejected
    assert "SPAN_GUARD_FAIL" in result.findings[0].rejection_reason


def test_duplicate_followup_never_nags() -> None:
    """ED-102 contract: proposal for an already-present CPT is rejected."""
    encounter = load_encounter("ED-102")
    nodule_spec = load_eval_specs("ED-104")[0].model_copy(
        update={"source_quote": "Incidental 6 mm solid noncalcified nodule"}
    )
    result = run_deterministic_pipeline(
        encounter_id="ED-102",
        radiology_report=encounter.radiology_study.report_text,
        lab_note=encounter.lab_note.text if encounter.lab_note else None,
        serial_labs=encounter.serial_labs,
        packet=encounter.draft_discharge_packet,
        candidates=[nodule_spec],
    )
    assert result.sent_findings == []
    assert result.findings[0].rejected
    assert "ABSENCE_FAIL" in result.findings[0].rejection_reason
