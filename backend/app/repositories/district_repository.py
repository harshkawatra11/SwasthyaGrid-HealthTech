import base64
import binascii
import hashlib
import json
import logging
import time
from collections.abc import Callable, Iterable
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.exceptions import DistrictNotFoundError, FacilityNotFoundError

logger = logging.getLogger("swasthyagrid")

REFRESH_TTL_SECONDS = 20
FIRESTORE_RETRY_SECONDS = 300
DEFAULT_REORDER_THRESHOLD_DAYS = 5

FIRESTORE_COLLECTIONS = (
    "facilities",
    "medicine_stock",
    "beds",
    "doctors",
    "diagnostics",
)


def _service_account_info(raw: str) -> dict[str, Any]:
    """Parse FIREBASE_SERVICE_ACCOUNT, which is raw JSON or base64 of that JSON."""
    text = raw.strip()
    if not text.startswith("{"):
        try:
            text = base64.b64decode(text, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as exc:
            raise ValueError("FIREBASE_SERVICE_ACCOUNT is neither JSON nor base64 JSON") from exc
    return json.loads(text)


def build_firestore_client():
    """Firestore client from the configured service account, else ADC."""
    from google.cloud import firestore

    settings = get_settings()
    info: dict[str, Any] | None = None
    if settings.firebase_service_account:
        info = _service_account_info(settings.firebase_service_account)
    elif settings.firebase_service_account_file:
        with open(settings.firebase_service_account_file, encoding="utf-8") as f:
            info = json.load(f)
    if info is None:
        return firestore.Client()

    from google.oauth2 import service_account

    credentials = service_account.Credentials.from_service_account_info(info)
    return firestore.Client(project=info.get("project_id"), credentials=credentials)


class DistrictRepository:
    """Abstracts the district data store.

    Tries live Firestore first (the CRM's source of truth); if Firestore is
    unreachable or empty (e.g. not yet seeded), falls back to the bundled
    seed JSON so the app always has something to serve. Data is refreshed on
    a short TTL so edits made in the CRM propagate into forecasts and
    recommendations without a backend restart.

    Covers five districts and forty facilities. `district_id` is required on
    every facility row; Firestore-authored facilities are trusted to carry it
    just like every other CRM-editable field.
    """

    def __init__(self, seed_path: Path, client_factory: Callable[[], Any] | None = None):
        self._seed_path = seed_path
        self._client_factory = client_factory or build_firestore_client
        self._data: dict[str, Any] = self._load_json()
        self._version = 0
        self._last_refresh = time.monotonic()
        self._firestore_client = None
        self._retry_client_at = 0.0
        self._live_source = "seed"
        self._stock_overlay: Callable[[], Iterable[dict[str, Any]]] | None = None
        self._try_refresh_from_firestore(force=True)
        if get_settings().data_source == "firestore" and self._live_source != "firestore":
            raise RuntimeError("DATA_SOURCE=firestore but Firestore is unavailable or empty")

    @property
    def live_source(self) -> str:
        """Where the data currently served comes from: "firestore" or "seed"."""
        return self._live_source

    def invalidate(self) -> None:
        """Force the next read to refresh from the source and bump the version."""
        self._last_refresh = float("-inf")
        self._retry_client_at = 0.0
        self._version += 1

    def set_stock_overlay(self, provider: Callable[[], Iterable[dict[str, Any]]] | None) -> None:
        """Register a provider of `{facility_id, medicine_name, units, ...}` overlay entries.

        Applied only while serving the seed JSON; with live Firestore the CRM
        increments stock itself, so applying the overlay would double count.
        """
        self._stock_overlay = provider

    def _load_json(self) -> dict[str, Any]:
        with open(self._seed_path, encoding="utf-8") as f:
            return json.load(f)

    def _get_firestore_client(self):
        if get_settings().data_source == "seed":
            return None
        if self._firestore_client is not None:
            return self._firestore_client
        if time.monotonic() < self._retry_client_at:
            return None
        try:
            self._firestore_client = self._client_factory()
            return self._firestore_client
        except Exception:
            logger.info("Firestore unavailable, using bundled seed JSON.", exc_info=True)
            self._retry_client_at = time.monotonic() + FIRESTORE_RETRY_SECONDS
            return None

    def _load_from_firestore(self) -> dict[str, Any] | None:
        client = self._get_firestore_client()
        if client is None:
            return None
        try:
            data: dict[str, Any] = {}
            for name in FIRESTORE_COLLECTIONS:
                docs = [d.to_dict() | {"_doc_id": d.id} for d in client.collection(name).stream()]
                data[name] = docs

            if not data.get("facilities"):
                # Firestore not seeded yet — stay on JSON fallback.
                return None

            # Fields not yet CRM-editable stay sourced from the JSON seed.
            base = self._load_json()
            data["districts"] = base["districts"]
            data["footfall_forecast"] = base["footfall_forecast"]
            data["footfall_breakdown_tomorrow"] = base["footfall_breakdown_tomorrow"]
            data["causal_chain"] = base["causal_chain"]
            data["demand_factors"] = base.get("demand_factors", {})

            # normalize CRM-authored doc ids into the field names services expect
            for m in data["medicine_stock"]:
                m["id"] = m.pop("_doc_id", None) or m.get("id")
            for d in data["doctors"]:
                d["doctor_id"] = d.pop("_doc_id", None) or d.get("doctor_id")
            for f in data["facilities"]:
                f["id"] = f.pop("_doc_id", None) or f.get("id")

            return data
        except Exception:
            logger.warning("Failed to read Firestore, using bundled seed JSON.", exc_info=True)
            return None

    def _try_refresh_from_firestore(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and (now - self._last_refresh) < REFRESH_TTL_SECONDS:
            return
        self._last_refresh = now

        fresh = self._load_from_firestore()
        if fresh is None:
            return

        new_hash = hashlib.sha256(json.dumps(fresh, sort_keys=True, default=str).encode()).hexdigest()
        old_hash = getattr(self, "_data_hash", None)
        if new_hash != old_hash:
            self._data = fresh
            self._data_hash = new_hash
            self._version += 1
        self._live_source = "firestore"

    @property
    def version(self) -> int:
        self._try_refresh_from_firestore()
        return self._version

    @property
    def districts(self) -> list[dict[str, Any]]:
        self._try_refresh_from_firestore()
        return self._data["districts"]

    def district(self, district_id: str) -> dict[str, Any]:
        for d in self.districts:
            if d["id"] == district_id:
                return d
        raise DistrictNotFoundError(district_id)

    @property
    def facilities(self) -> list[dict[str, Any]]:
        self._try_refresh_from_firestore()
        return self._data["facilities"]

    def facilities_in(self, district_id: str | None) -> list[dict[str, Any]]:
        if district_id is None:
            return self.facilities
        return [f for f in self.facilities if f["district_id"] == district_id]

    def facility(self, facility_id: str) -> dict[str, Any]:
        for f in self.facilities:
            if f["id"] == facility_id:
                return f
        raise FacilityNotFoundError(facility_id)

    @property
    def medicine_stock(self) -> list[dict[str, Any]]:
        self._try_refresh_from_firestore()
        return self._data["medicine_stock"]

    def medicine_stock_for(self, facility_id: str) -> list[dict[str, Any]]:
        rows = [m for m in self.medicine_stock if m["facility_id"] == facility_id]
        if self._live_source != "seed" or self._stock_overlay is None:
            return rows
        added: dict[str, int] = {}
        for entry in self._stock_overlay():
            if entry["facility_id"] == facility_id:
                added[entry["medicine_name"]] = added.get(entry["medicine_name"], 0) + int(entry["units"])
        if not added:
            return rows
        out = []
        for row in rows:
            extra = added.pop(row["medicine_name"], 0)
            out.append({**row, "units_remaining": row["units_remaining"] + extra} if extra else row)
        for name, units in added.items():
            out.append(self._new_stock_row(facility_id, name, units))
        return out

    @staticmethod
    def _new_stock_row(facility_id: str, medicine_name: str, units: int) -> dict[str, Any]:
        """Stock row for a medicine the facility did not carry before a delivery."""
        from app.logistics.catalog import medicines

        base = medicines().get(medicine_name, {}).get("base_daily_consumption", 1)
        return {
            "facility_id": facility_id,
            "medicine_name": medicine_name,
            "units_remaining": units,
            "avg_daily_consumption": int(base),
            "reorder_threshold_days": DEFAULT_REORDER_THRESHOLD_DAYS,
        }

    @property
    def beds(self) -> list[dict[str, Any]]:
        self._try_refresh_from_firestore()
        return self._data["beds"]

    @property
    def doctors(self) -> list[dict[str, Any]]:
        self._try_refresh_from_firestore()
        return self._data["doctors"]

    @property
    def diagnostics(self) -> list[dict[str, Any]]:
        self._try_refresh_from_firestore()
        return self._data["diagnostics"]

    def footfall_forecast_for(self, district_id: str) -> list[dict[str, Any]]:
        return self._data["footfall_forecast"].get(district_id, [])

    def footfall_breakdown_tomorrow_for(self, district_id: str) -> dict[str, Any]:
        return self._data["footfall_breakdown_tomorrow"].get(district_id, {})

    def causal_chain_for(self, district_id: str) -> dict[str, Any]:
        return self._data["causal_chain"].get(district_id, {})

    def demand_factors_for(self, facility_id: str) -> list[str]:
        return self._data.get("demand_factors", {}).get(facility_id, [])

    def district_id_for_facility(self, facility_id: str) -> str:
        return self.facility(facility_id)["district_id"]


@lru_cache
def get_district_repository() -> DistrictRepository:
    return DistrictRepository(get_settings().seed_data_path)
