"""Fixture loader — raw records for eval metadata + strict Encounter parse.

Two views on purpose:
- load_encounter_records(): unvalidated dicts (expected_findings survives).
- load_encounters() / parse Encounter: production view (extra="ignore").
"""

from __future__ import annotations

import json
from pathlib import Path

from backend.schemas import Encounter, FindingSpec

FIXTURES_DIR = Path(__file__).resolve().parent
ENCOUNTERS_PATH = FIXTURES_DIR / "encounters.json"

_raw_records: list[dict] | None = None
_raw_by_id: dict[str, dict] | None = None
_dumped_encounters: list[dict] | None = None


def _init_fixtures() -> None:
    global _raw_records, _raw_by_id, _dumped_encounters
    if _raw_records is not None:
        return
    data = json.loads(ENCOUNTERS_PATH.read_text())
    _raw_records = data["encounters"]
    _raw_by_id = {r["encounter_id"]: r for r in _raw_records if "encounter_id" in r}
    _dumped_encounters = [
        Encounter.model_validate(record).model_dump(by_alias=True)
        for record in _raw_records
    ]


def load_encounter_records() -> list[dict]:
    """Raw JSON documents (fail loudly on malformed fixtures)."""
    _init_fixtures()
    assert _raw_records is not None
    return [record.copy() for record in _raw_records]


def load_encounters() -> list[Encounter]:
    _init_fixtures()
    assert _raw_records is not None
    return [Encounter.model_validate(record) for record in _raw_records]


def load_encounters_dumped() -> list[dict]:
    """Pre-dumped JSON-ready dictionaries for the API view."""
    _init_fixtures()
    assert _dumped_encounters is not None
    return _dumped_encounters


def load_encounter(encounter_id: str) -> Encounter:
    _init_fixtures()
    assert _raw_by_id is not None
    record = _raw_by_id.get(encounter_id)
    if record is None:
        raise KeyError(f"Unknown encounter fixture: {encounter_id}")
    return Encounter.model_validate(record)


def load_eval_specs(encounter_id: str) -> list[FindingSpec]:
    _init_fixtures()
    assert _raw_by_id is not None
    record = _raw_by_id.get(encounter_id)
    if record is None:
        raise KeyError(f"Unknown encounter fixture: {encounter_id}")
    return [FindingSpec.model_validate(doc) for doc in record.get("expected_findings", [])]
