"""SilentCatch data contracts — Pydantic v2 models mirroring PRD §8.2/§6 (FA-4).

Design rules:
- Aliases match the PRD JSON keys exactly (`class` -> drug_class via alias because
  `class` is a reserved keyword and cannot be a Python kwarg).
- Eval-only metadata (expected_findings) rides on Encounter with extra="ignore"
  so the production parse never chokes on benchmark annotations.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, field_validator
class Severity(StrEnum):
    CRITICAL = "CRITICAL"
    WARNING = "WARNING"


class FindingKind(StrEnum):
    # PRD UC-2: dropped incidental imaging follow-up
    INCIDENTAL_FINDING_DROP = "INCIDENTAL_FINDING_DROP"
    # PRD UC-3: lab-velocity drug collision
    KINETIC_MED_COLLISION = "KINETIC_MED_COLLISION"


class SlopeStatus(StrEnum):
    VALID = "VALID"
    INSUFFICIENT_TIME_SERIES = "INSUFFICIENT_TIME_SERIES"


class LabPoint(BaseModel):
    timestamp_hr: float
    value: float
    ref_min: float | None = None
    ref_max: float | None = None


class RadiologyStudy(BaseModel):
    modality: str
    slice_image_url: str | None = None
    report_text: str


class Prescription(BaseModel):
    model_config = {"populate_by_name": True}

    drug_name: str
    dose: str
    days: int
    drug_class: str = Field(alias="class")


class FollowUpOrder(BaseModel):
    specialty: str
    timeframe: str
    reason: str
    cpt_code: str


class DischargePacket(BaseModel):
    primary_diagnosis_icd10: str
    discharge_instructions: str
    prescriptions: list[Prescription]
    follow_up_orders: list[FollowUpOrder]


class LabNote(BaseModel):
    """Free-text clinician comment on serial labs (quote source for kinetic verdicts)."""

    text: str


class Encounter(BaseModel):
    model_config = {"extra": "ignore", "populate_by_name": True}

    encounter_id: str
    patient_scenario: str
    chief_complaint: str
    radiology_study: RadiologyStudy
    serial_labs: dict[str, list[LabPoint]]
    lab_note: LabNote | None = None
    draft_discharge_packet: DischargePacket

    @field_validator("lab_note", mode="before")
    @classmethod
    def _coerce_lab_note(cls, value: object) -> object:
        """Accept plain-string notes (fixtures, Stage-4 LLM output) at the boundary."""
        if isinstance(value, str):
            return {"text": value}
        return value


# ---------------------------------------------------------------- Stage-4 output

class DischargePatch(BaseModel):
    remove_drug_name: str | None = None  # exact-name match target for swap
    add_prescription: Prescription | None = None
    add_follow_up_order: FollowUpOrder | None = None
    note: str


class VerifiedSpan(BaseModel):
    """Char offsets into the ORIGINAL source text (for UI red-line highlighting)."""

    start_char: int
    end_char: int
    match_mode: str  # "WS_PUNCT_COLLAPSED" | "ALNUM_ONLY"


class InterceptionVerdict(BaseModel):
    """Single validated contradiction (never rendered without a VerifiedSpan)."""

    kind: FindingKind
    severity: Severity
    explanation: str
    source_quote: str
    verified_span: VerifiedSpan
    guideline_url: str | None = None  # populated by Stage 3 (Tavily) when live
    discharge_patch: DischargePatch


# ---------------------------------------------------------------- pipeline plumbing

class KinematicSlope(BaseModel):
    analyte: str
    status: SlopeStatus
    slope_per_hour: float | None = None  # OLS dy/dt (hours)
    slope_per_day: float | None = None
    pct_delta_from_baseline: float | None = None  # (last - first) / first * 100
    abs_delta: float | None = None
    first_value: float | None = None
    last_value: float | None = None
    n_points: int
    flags: list[str] = Field(default_factory=list)


class StageTrace(BaseModel):
    """FR-2.2 telemetry line — one per model/backing store call."""

    stage: str  # vision | gate | guideline | reasoning | span_guard
    model_id: str | None = None
    replayed: bool = False
    latency_ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    est_cost_usd: float = 0.0
    payload: dict[str, Any] = Field(default_factory=dict)
    note: str = ""  # e.g. "capture", "seed", "failure_fallback", "cache_hit"


class ScanFinding(BaseModel):
    """One imaging finding produced by Stage 1 (VL live, capture, or seed parser)."""

    description: str
    location: str | None = None
    measurement_mm: float | None = None
    acute: bool = False
    verbatim_quote: str
    recommended_cpt: str | None = None  # deterministic hint used by the gate


class VisionResult(BaseModel):
    """Stage-1 output. `source` is code-set after parsing — never trusted from
    the model (same discipline as GateDecision.source)."""

    findings: list[ScanFinding]
    vision_confidence: str = "HIGH"  # HIGH | LOW (FR-1.1 edge)
    source: str = ""  # vl_live | vl_capture | vl_seed
    note: str = ""


class GateDecision(BaseModel):
    action: str  # SILENT_PASS | ESCALATE
    reasons: list[str] = Field(default_factory=list)
    confidence: float = 1.0
    source: str = ""  # set by code (never trusted from the model)


class AuditResult(BaseModel):
    encounter_id: str
    status: str  # SILENT_PASS | CRITICAL_INTERCEPT
    verdicts: list[InterceptionVerdict] = Field(default_factory=list)
    traces: list[StageTrace] = Field(default_factory=list)
    total_cost_usd: float = 0.0
    elapsed_ms: int = 0


# ---------------------------------------------------------------- eval metadata

class FindingSpec(BaseModel):
    """An LLM-independent candidate finding used only by the deterministic test rig.

    In production, equivalent objects come from Stage 4 (Nemotron 3 Ultra) and are
    validated by the very same guards run here (PRD §1: model proposes, code verifies).
    """

    kind: FindingKind
    severity: Severity
    explanation: str
    source_quote: str
    source: str = "radiology_report"  # radiology_report | lab_note
    guideline_url: str | None = None
    discharge_patch: DischargePatch


def disable_eval_annotations() -> type[Encounter]:
    """Explicit helper for call sites that must mutate expected_findings-free copies."""
    return Encounter
