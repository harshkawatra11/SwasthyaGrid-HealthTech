"""Logistics state and its JSON file store (section 5.13)."""

import json
import logging
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from app.logistics.models import ActionLog, Shipment

logger = logging.getLogger("swasthyagrid")

SCHEMA_VERSION = 1
ARCHIVE_NAME = "logistics_archive.jsonl"


class LogisticsState(BaseModel):
    schema_version: int = SCHEMA_VERSION
    scenario: dict[str, Any] = Field(default_factory=dict)  # {seed, start, time_scale}
    clock: dict[str, Any] = Field(default_factory=dict)  # {last_sim_now}
    counters: dict[str, int] = Field(default_factory=lambda: {"shipment_seq": 0})
    recommendations: dict[str, dict] = Field(default_factory=dict)
    rec_episodes: dict[str, int] = Field(default_factory=dict)
    rec_keys: dict[str, str] = Field(default_factory=dict)
    rec_candidate_keys: list[str] = Field(default_factory=list)
    shipments: dict[str, Shipment] = Field(default_factory=dict)
    actions: list[ActionLog] = Field(default_factory=list)
    fleet: dict[str, dict] = Field(default_factory=dict)  # {vehicle_id: {odometer_km, km_since_service, status_override}}
    crew: dict[str, dict] = Field(default_factory=dict)  # {driver_id: {status_override}}
    reservations: dict[str, dict[str, int]] = Field(default_factory=dict)
    warehouse_adjust: dict[str, dict[str, int]] = Field(default_factory=dict)
    stock_overlay: list[dict] = Field(default_factory=list)
    background: dict[str, int] = Field(default_factory=dict)  # last generated slot per stream


class StateStore:
    """Interface: `load()` returns a state or None, `save(state)` persists it."""

    def load(self) -> LogisticsState | None:  # pragma: no cover - interface
        raise NotImplementedError

    def save(self, state: LogisticsState) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    # Archive of terminal shipments older than 24 sim hours (Appendix E R4). Optional.
    def append_archive(self, shipments: list[Shipment]) -> None:  # pragma: no cover - interface
        pass

    def load_archive(self) -> list[Shipment]:  # pragma: no cover - interface
        return []

    def clear_archive(self) -> None:  # pragma: no cover - interface
        pass

    def backup(self) -> None:  # pragma: no cover - interface
        pass


class MemoryStateStore(StateStore):
    """Keeps the state as JSON text in memory; used by tests and when no path is set."""

    def __init__(self):
        self._text: str | None = None
        self._archive: list[str] = []

    def load(self) -> LogisticsState | None:
        return LogisticsState.model_validate_json(self._text) if self._text else None

    def save(self, state: LogisticsState) -> None:
        self._text = state.model_dump_json()

    def append_archive(self, shipments: list[Shipment]) -> None:
        self._archive.extend(s.model_dump_json() for s in shipments)

    def load_archive(self) -> list[Shipment]:
        return [Shipment.model_validate_json(line) for line in self._archive]

    def clear_archive(self) -> None:
        self._archive = []

    def backup(self) -> None:
        self._text = None
        self._archive = []


class JsonFileStateStore(StateStore):
    """Atomic JSON file (write `*.tmp`, then `os.replace`)."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self._lock = threading.Lock()

    def load(self) -> LogisticsState | None:
        if not self.path.exists():
            return None
        try:
            raw = self.path.read_text(encoding="utf-8")
            data = json.loads(raw)
            if data.get("schema_version") != SCHEMA_VERSION:
                raise ValueError(f"schema_version {data.get('schema_version')} != {SCHEMA_VERSION}")
            return LogisticsState.model_validate(data)
        except Exception as exc:
            stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            backup = self.path.with_name(f"{self.path.name}.corrupt-{stamp}")
            try:
                os.replace(self.path, backup)
            except OSError:
                logger.warning("Could not back up the unreadable logistics state file", exc_info=True)
            logger.warning("Logistics state unreadable (%s); backed up to %s and rebuilding", exc, backup.name)
            return None

    def save(self, state: LogisticsState) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(state.model_dump_json(), encoding="utf-8")
            os.replace(tmp, self.path)

    # ------------------------------------------------------------------ archive

    @property
    def archive_path(self) -> Path:
        return self.path.with_name(ARCHIVE_NAME)

    def append_archive(self, shipments: list[Shipment]) -> None:
        if not shipments:
            return
        with self._lock:
            self.archive_path.parent.mkdir(parents=True, exist_ok=True)
            with self.archive_path.open("a", encoding="utf-8") as fh:
                for s in shipments:
                    fh.write(s.model_dump_json() + "\n")

    def load_archive(self) -> list[Shipment]:
        if not self.archive_path.exists():
            return []
        out: list[Shipment] = []
        seen: set[str] = set()
        for line in self.archive_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                s = Shipment.model_validate_json(line)
            except Exception:  # a torn last line after a crash is not worth failing the boot
                logger.warning("Skipping an unreadable archive line", exc_info=True)
                continue
            if s.id not in seen:
                seen.add(s.id)
                out.append(s)
        return out

    def clear_archive(self) -> None:
        with self._lock:
            self.archive_path.unlink(missing_ok=True)

    def backup(self) -> None:
        """Move a stale state file (and its archive) aside so the scenario is rebuilt."""
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        for path, tag in ((self.path, "stale"), (self.archive_path, "stale")):
            if path.exists():
                try:
                    os.replace(path, path.with_name(f"{path.name}.{tag}-{stamp}"))
                except OSError:
                    logger.warning("Could not back up %s", path.name, exc_info=True)
