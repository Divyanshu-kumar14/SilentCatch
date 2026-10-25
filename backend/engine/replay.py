"""Replay capture store (FR-2.2 + NFR §7).

Stores REAL live stage payloads when a NEBIUS/TAVILY key exists; serves them
back instantly whenever keys are missing, budgets trip, or upstream calls fail.
When a payload was never recorded, serve_stage() returns `None`,
and pipelines fall back to the deterministic seed path (same schema, honestly
badged `seed` — never passed off as a recorded Nebius response).
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULT_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "replay_traces.json"
_SCHEMA_VERSION = 2


def _atomic_write_json(path: Path, data: dict) -> None:
    tmp_fd, tmp_name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(tmp_fd, "w") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp_name, path)
    except Exception:  # noqa: BLE001 — recorder must never kill an audit
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


class ReplayStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or _DEFAULT_PATH
        self._data: dict = self._read()

    def _read(self) -> dict:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            data = json.loads(self.path.read_text())
            if data.get("version") != _SCHEMA_VERSION:
                return {"version": _SCHEMA_VERSION, "captures": {}}
            return data
        except FileNotFoundError:
            return {"version": _SCHEMA_VERSION, "captures": {}}
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("replay_traces.json unreadable (%s) — starting fresh", exc)
            return {"version": _SCHEMA_VERSION, "captures": {}}

    def get(self, stage: str, encounter_id: str) -> dict | None:
        return self._data.get("captures", {}).get(stage, {}).get(encounter_id)

    def record(
        self, stage: str, encounter_id: str, payload: dict, meta: dict
    ) -> None:
        """Best-effort persist of a successful LIVE call (mute IO failures: log)."""
        captures = self._data.setdefault("captures", {})
        captures.setdefault(stage, {})[encounter_id] = {"meta": meta, "payload": payload}
        try:
            _atomic_write_json(self.path, self._data)
        except OSError as exc:
            logger.warning("replay capture not persisted: %s", exc)
