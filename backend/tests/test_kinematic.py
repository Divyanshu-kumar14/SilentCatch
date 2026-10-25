"""Kinematic engine gates (plan 1.2) — verified clinical math, not vibes."""

from __future__ import annotations

from backend.engine import kinematic_labs
from backend.fixtures.loader import load_encounter
from backend.schemas import LabPoint, SlopeStatus


def test_ed104_aki_stage1_flags_and_pct_delta() -> None:
    encounter = load_encounter("ED-104")
    slopes = kinematic_labs.analyze_serial_labs(encounter.serial_labs)
    creat = next(s for s in slopes if s.analyte == "creatinine_mg_dl")
    assert creat.status == SlopeStatus.VALID
    # 0.62 -> 1.16 = +87.1% (PRD §11 claims +87%)
    assert creat.pct_delta_from_baseline is not None
    assert abs(creat.pct_delta_from_baseline - 87.1) < 0.5
    # OLS slope over 36h window: ~0.36 mg/dL/day
    assert creat.slope_per_day is not None and 0.30 <= creat.slope_per_day <= 0.42
    assert "KINETIC_AKI_STAGE_1" in creat.flags  # ratio 1.87x + abs delta 0.54

    egfr = next(s for s in slopes if s.analyte == "egfr_ml_min")
    assert "KINETIC_EGFR_DECLINE" in egfr.flags
    assert egfr.slope_per_day is not None and egfr.slope_per_day <= -10

    flags = kinematic_labs.all_flags(slopes)
    assert "KINETIC_AKI_STAGE_1" in flags and "KINETIC_EGFR_DECLINE" in flags


def test_ed103_recovering_kidney_never_flags() -> None:
    encounter = load_encounter("ED-103")
    slopes = kinematic_labs.analyze_serial_labs(encounter.serial_labs)
    creat = next(s for s in slopes if s.analyte == "creatinine_mg_dl")
    assert creat.status == SlopeStatus.VALID
    assert creat.pct_delta_from_baseline is not None
    assert creat.pct_delta_from_baseline < 0  # negative velocity = recovery
    assert creat.flags == []  # PRD §11: recovering slope must NOT alert
    assert kinematic_labs.all_flags(slopes) == []


def test_ed101_flat_series_zero_flags() -> None:
    encounter = load_encounter("ED-101")
    slopes = kinematic_labs.analyze_serial_labs(encounter.serial_labs)
    assert kinematic_labs.all_flags(slopes) == []
    creat = next(s for s in slopes if s.analyte == "creatinine_mg_dl")
    assert creat.abs_delta == 0.0 and creat.pct_delta_from_baseline == 0.0


def test_insufficient_series_suppresses_flags() -> None:
    """PRD FR-1.2 edges: n < 2, and Δt < 2h (hemodilution noise)."""
    single = {"creatinine_mg_dl": [LabPoint(timestamp_hr=-36, value=0.6)]}
    (slope,) = kinematic_labs.analyze_serial_labs(single)
    assert slope.status == SlopeStatus.INSUFFICIENT_TIME_SERIES
    assert slope.flags == [] and slope.slope_per_day is None

    two_points_one_hour = {
        "creatinine_mg_dl": [
            LabPoint(timestamp_hr=0, value=0.60),
            LabPoint(timestamp_hr=1, value=2.60),  # huge spike but 1h apart
        ]
    }
    (slope,) = kinematic_labs.analyze_serial_labs(two_points_one_hour)
    assert slope.status == SlopeStatus.INSUFFICIENT_TIME_SERIES
    assert slope.flags == []


def test_unsupported_analyte_ignored() -> None:
    """Bounded surface: unknown analytes never crash the pipeline."""
    data = {
        "wbc_kul": [  # not in SUPPORTED_ANALYTES
            LabPoint(timestamp_hr=-6, value=12.0),
            LabPoint(timestamp_hr=0, value=9.0),
        ]
    }
    assert kinematic_labs.analyze_serial_labs(data) == []
