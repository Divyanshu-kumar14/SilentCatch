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


def load_encounter_records() -> list[dict]:
    """Raw JSON documents (fail loudly on malformed fixtures)."""
    data = json.loads(ENCOUNTERS_PATH.read_text())
    return data["encounters"]


def load_encounters() -> list[Encounter]:
    return [Encounter.model_validate(record) for record in load_encounter_records()]


def load_encounter(encounter_id: str) -> Encounter:
    for encounter in load_encounters():
        if encounter.encounter_id == encounter_id:
            return encounter
    raise KeyError(f"Unknown encounter fixture: {encounter_id}")


def load_eval_specs(encounter_id: str) -> list[FindingSpec]:
    for record in load_encounter_records():
        if record.get("encounter_id") == encounter_id:
            return [FindingSpec.model_validate(doc) for doc in record.get("expected_findings", [])]
    raise KeyError(f"Unknown encounter fixture: {encounter_id}")
