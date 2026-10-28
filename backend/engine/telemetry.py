"""FR-2.2 telemetry: spend ledger + best-effort per-model token pricing.

SpendLedger enforces the hard caps (PRD: $0.05/discharge live spend,
$2.00/day). When a cap trips, the pipeline switches to REPLAY_MODE for the
remainder of the day (in-memory, PRD wording — no DB dependency).
"""

from __future__ import annotations

import datetime as dt
from typing import Any

# Estimated public rates (USD per million tokens, Oct-2026 benchmark comparability).
# These are DOCUMENTED ASSUMPTIONS, not provider invoices. The benchmark labels
# every value computed from them as "estimated_from_actual_tokens". Update the
# version whenever a rate changes so saved reports stay reproducible.
PRICING_ASSUMPTIONS_VERSION: str = "2026-10-public-estimates-v1"
TOKEN_COSTS_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    # role: (prompt USD/Mtok, completion USD/Mtok)
    "vision": (0.60, 0.60),      # 3.5 Super VL 120B assumption
    "gate": (0.03, 0.03),        # Nano 30B-A3B assumption
    "reasoning": (2.00, 2.00),   # Ultra 550B-A55B assumption
    "failsafe": (0.30, 0.30),    # Super 120B assumption
}


def pricing_snapshot() -> dict[str, Any]:
    """Serializable pricing assumptions embedded in benchmark reports."""
    return {
        "version": PRICING_ASSUMPTIONS_VERSION,
        "unit": "USD per million tokens",
        "rates": {
            role: {"prompt": rates[0], "completion": rates[1]}
            for role, rates in TOKEN_COSTS_USD_PER_MTOK.items()
        },
        "note": (
            "Public list-price assumptions used only to estimate spend. "
            "Not an actual provider invoice."
        ),
    }


def estimate_cost(role: str, prompt_tokens: int, completion_tokens: int) -> float:
    in_rate, out_rate = TOKEN_COSTS_USD_PER_MTOK.get(role, (0.0, 0.0))
    return (prompt_tokens * in_rate + completion_tokens * out_rate) / 1_000_000


class SpendLedger:
    """In-memory live-spend tracker. Fraud-proofing lives in honest accounting:
    every live token cost is charged BEFORE the call result is trusted."""

    def __init__(self, per_discharge_cap: float, daily_cap: float) -> None:
        self.per_discharge_cap = per_discharge_cap
        self.daily_cap = daily_cap
        self._request_spend = 0.0
        self._day: str = dt.date.today().isoformat()
        self._day_spend = 0.0

    def start_request(self) -> None:
        self._request_spend = 0.0
        self._roll_day()

    def charge_live_call(self, cost: float) -> None:
        self._request_spend += cost
        self._day_spend += cost

    def live_call_allowed(self) -> bool:
        self._roll_day()
        return (
            self._request_spend < self.per_discharge_cap
            and self._day_spend < self.daily_cap
        )

    def cap_reason(self) -> str:
        if self._request_spend >= self.per_discharge_cap:
            return f"per-discharge cap ${self.per_discharge_cap:.2f} hit"
        if self._day_spend >= self.daily_cap:
            return f"daily cap ${self.daily_cap:.2f} hit"
        return ""

    @property
    def request_spend(self) -> float:
        return self._request_spend

    @property
    def day_spend(self) -> float:
        return self._day_spend

    def seed_day(self, spend: float) -> None:
        """Adopt the process-wide daily total so fresh request ledgers honor $/day."""
        self._day_spend = spend

    def _roll_day(self) -> None:
        today = dt.date.today().isoformat()
        if today != self._day:
            self._day = today
            self._day_spend = 0.0


# Module-level daily total — persists across request-scoped ledgers in-process.
_day_key: str = dt.date.today().isoformat()
_day_spend: float = 0.0


def _roll_module_day() -> None:
    global _day_key, _day_spend
    today = dt.date.today().isoformat()
    if today != _day_key:
        _day_key = today
        _day_spend = 0.0


def add_day_cost(cost: float) -> None:
    _roll_module_day()
    global _day_spend
    _day_spend += cost


def day_cost() -> float:
    _roll_module_day()
    return _day_spend
