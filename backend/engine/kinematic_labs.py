"""Deterministic Kinematic Lab Engine (PRD FR-1.2) — NumPy OLS velocity math.

Contract:
- Input:  time-ordered serial labs, >=2 points, per analyte (mg/dL etc.).
- Output: one KinematicSlope per analyte: OLS slope (per hour & per day),
  %-delta from firstReading, plus KDIGO-velocity risk flags.
- Edge cases (PRD): n < 2 OR time span < 2h  ->  INSUFFICIENT_TIME_SERIES and NO
  flags ever (kinetic alerts suppressed). Recovering creatinine (ED-103) never
  flags AKI — flags fire on RISING trajectory only.

Clinical grounding (verified via KDIGO 2012, Oct 2026):
- AKI Stage 1: creatinine >= 0.3 mg/dL rise within 48h OR 1.5–1.9x baseline.
- AKI Stage 2: 2.0–2.9x baseline. Stage 3: >= 3.0x baseline.
"""

from __future__ import annotations

import numpy as np

from backend.schemas import KinematicSlope, LabPoint, SlopeStatus

MIN_TIME_SPAN_H: float = 2.0  # PRD FR-1.2 edge: hemodilution noise below this
# KDIGO 2012 creatinine bands (ratio of last to first reading)
AKI_STAGE_BANDS: list[tuple[str, float, float]] = [
    ("KINETIC_AKI_STAGE_3", 3.0, float("inf")),
    ("KINETIC_AKI_STAGE_2", 2.0, 3.0),
    ("KINETIC_AKI_STAGE_1", 1.5, 2.0),
]
AKI_ABS_DELTA_G_DL: float = 0.3  # KDIGO stage-1 absolute criterion (48h window)
EGFR_DECLINE_SLOPE_PER_DAY: float = -10.0  # mg/min/day velocity alarm floor
HEMOGLOBIN_DROP_G_DL: float = -1.5  # occult hemorrhage threshold
PLATELET_PCT_DROP: float = -30.0  # consumptive-trend threshold

SUPPORTED_ANALYTES: tuple[str, ...] = (
    "creatinine_mg_dl",
    "egfr_ml_min",
    "hemoglobin_g_dl",
    "potassium_mmol_l",
    "platelets",
)


def _ols_slope(points: list[LabPoint]) -> float:
    """NumPy least-squares slope dy/dt in per-hour units (deterministic)."""
    t = np.array([p.timestamp_hr for p in points], dtype=float)
    y = np.array([p.value for p in points], dtype=float)
    slope_per_hour, _ = np.polyfit(t, y, deg=1)
    return float(slope_per_hour)


def _analyze(analyte: str, points: list[LabPoint]) -> KinematicSlope:
    n = len(points)
    slope = KinematicSlope(analyte=analyte, status=SlopeStatus.VALID, n_points=n)

    last, first = points[-1], points[0]
    slope.first_value, slope.last_value = first.value, last.value
    span_h = abs(last.timestamp_hr - first.timestamp_hr)
    if n < 2 or span_h < MIN_TIME_SPAN_H or first.value == 0:
        # PRD edge: no slope possible -> suppress every kinetic alert (fail silent).
        slope.status = SlopeStatus.INSUFFICIENT_TIME_SERIES
        slope.slope_per_hour = _ols_slope(points) if n >= 2 else None
        slope.slope_per_day = None
        return slope

    slope.slope_per_hour = _ols_slope(points)
    slope.slope_per_day = slope.slope_per_hour * 24.0
    slope.abs_delta = last.value - first.value
    slope.pct_delta_from_baseline = slope.abs_delta / first.value * 100.0
    slope.flags = _flags(analyte, slope)
    return slope


def _flags(analyte: str, slope: KinematicSlope) -> list[str]:
    assert slope.abs_delta is not None and slope.pct_delta_from_baseline is not None
    assert slope.slope_per_day is not None and slope.last_value is not None
    ratio = slope.last_value / slope.first_value if slope.first_value else 0.0
    pct = slope.pct_delta_from_baseline

    if analyte == "creatinine_mg_dl":
        # Rising trajectory only: recovering kidneys (ED-103) must stay silent.
        if slope.abs_delta >= AKI_ABS_DELTA_G_DL:
            for flag, lo, hi in AKI_STAGE_BANDS:
                if lo <= ratio < hi:
                    return [flag]
        if ratio >= AKI_STAGE_BANDS[0][1]:
            return [AKI_STAGE_BANDS[0][0]]
    elif analyte == "egfr_ml_min" and slope.slope_per_day <= EGFR_DECLINE_SLOPE_PER_DAY:
        return ["KINETIC_EGFR_DECLINE"]
    elif analyte == "hemoglobin_g_dl" and slope.abs_delta <= HEMOGLOBIN_DROP_G_DL:
        return ["OCCULT_HEMORRHAGE_SLOPE"]
    elif analyte == "platelets" and pct <= PLATELET_PCT_DROP:
        return ["OCCULT_HEMORRHAGE_SLOPE"]
    elif analyte == "potassium_mmol_l" and (slope.last_value >= 5.2 and pct >= 20.0):
        return ["KINETIC_HYPERKALEMIA_SLOPE"]
    return []


def analyze_serial_labs(serial_labs: dict[str, list[LabPoint]]) -> list[KinematicSlope]:
    """Analyze every supported analyte; unknown analytes are ignored (bounded surface)."""
    return [
        _analyze(analyte, sorted(points, key=lambda p: p.timestamp_hr))
        for analyte, points in serial_labs.items()
        if analyte in SUPPORTED_ANALYTES
    ]


def all_flags(slopes: list[KinematicSlope]) -> list[str]:
    """Flat, de-duplicated, order-stable list of kinetic risk flags."""
    seen: list[str] = []
    for slope in slopes:
        for flag in slope.flags:
            if flag not in seen:
                seen.append(flag)
    return seen
