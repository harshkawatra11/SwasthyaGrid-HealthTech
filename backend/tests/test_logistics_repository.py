import base64
import json
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.repositories import district_repository as dr
from app.repositories.district_repository import DistrictRepository
from app.services.forecast_service import ForecastService

SEED = Path(__file__).resolve().parents[1] / "data" / "seed_districts.json"
SEED_DATA = json.loads(SEED.read_text(encoding="utf-8"))
ARV = "Anti-Rabies Vaccine (ARV)"


class FakeDoc:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return dict(self._data)


class FakeCollection:
    def __init__(self, docs):
        self._docs = docs

    def stream(self):
        return iter(self._docs)


class FakeFirestore:
    """Serves the seed data as Firestore documents; tests can mutate `store`."""

    def __init__(self):
        self.reads = 0
        self.store = {
            "facilities": [
                FakeDoc(f["id"], {k: v for k, v in f.items() if k != "id"}) for f in SEED_DATA["facilities"]
            ],
            "medicine_stock": [FakeDoc(f"m{i}", m) for i, m in enumerate(SEED_DATA["medicine_stock"])],
            "beds": [FakeDoc(b["facility_id"], b) for b in SEED_DATA["beds"]],
            "doctors": [
                FakeDoc(d["doctor_id"], {k: v for k, v in d.items() if k != "doctor_id"})
                for d in SEED_DATA["doctors"]
            ],
            "diagnostics": [FakeDoc(f"diag_{i}", d) for i, d in enumerate(SEED_DATA["diagnostics"])],
        }

    def collection(self, name):
        self.reads += 1
        return FakeCollection(self.store[name])


def set_source(monkeypatch, value):
    monkeypatch.setenv("DATA_SOURCE", value)
    get_settings.cache_clear()


def test_seed_mode_never_builds_a_client(monkeypatch):
    set_source(monkeypatch, "seed")

    def boom():
        raise AssertionError("client must not be built in seed mode")

    repo = DistrictRepository(SEED, client_factory=boom)
    assert repo.live_source == "seed"
    assert len(repo.facilities) == 40


def test_auto_prefers_firestore(monkeypatch):
    set_source(monkeypatch, "auto")
    fake = FakeFirestore()
    repo = DistrictRepository(SEED, client_factory=lambda: fake)
    assert repo.live_source == "firestore"
    assert fake.reads > 0


def test_auto_falls_back_to_seed_and_retries_after_backoff(monkeypatch):
    set_source(monkeypatch, "auto")
    calls = []

    def factory():
        calls.append(1)
        raise RuntimeError("no credentials")

    repo = DistrictRepository(SEED, client_factory=factory)
    assert repo.live_source == "seed"
    assert len(calls) == 1

    # Inside the backoff window a forced refresh does not retry the client.
    repo._last_refresh = float("-inf")
    _ = repo.facilities
    assert len(calls) == 1

    # invalidate() clears the backoff, so a working client is picked up.
    fake = FakeFirestore()
    repo._client_factory = lambda: fake
    repo.invalidate()
    _ = repo.facilities
    assert repo.live_source == "firestore"


def test_firestore_mode_raises_at_boot_when_unavailable(monkeypatch):
    set_source(monkeypatch, "firestore")

    def factory():
        raise RuntimeError("no credentials")

    with pytest.raises(RuntimeError):
        DistrictRepository(SEED, client_factory=factory)


def test_firestore_mode_ok_when_available(monkeypatch):
    set_source(monkeypatch, "firestore")
    repo = DistrictRepository(SEED, client_factory=lambda: FakeFirestore())
    assert repo.live_source == "firestore"


def test_invalidate_forces_refresh(monkeypatch):
    set_source(monkeypatch, "auto")
    fake = FakeFirestore()
    repo = DistrictRepository(SEED, client_factory=lambda: fake)
    before = repo.version

    fake.store["medicine_stock"][0] = FakeDoc("m0", {**SEED_DATA["medicine_stock"][0], "units_remaining": 9999})
    # Inside the TTL window nothing changes.
    assert repo.medicine_stock[0]["units_remaining"] != 9999
    repo.invalidate()
    assert repo.medicine_stock[0]["units_remaining"] == 9999
    assert repo.version > before


def test_overlay_applied_on_seed(monkeypatch):
    set_source(monkeypatch, "seed")
    repo = DistrictRepository(SEED)
    base = {m["medicine_name"]: m["units_remaining"] for m in repo.medicine_stock_for("kota_phc_4")}
    new_med = "Paracetamol"
    assert new_med not in base
    overlay = [
        {"facility_id": "kota_phc_4", "medicine_name": ARV, "units": 100, "shipment_id": "S1", "at": "x"},
        {"facility_id": "kota_phc_4", "medicine_name": new_med, "units": 50, "shipment_id": "S1", "at": "x"},
        {"facility_id": "other", "medicine_name": ARV, "units": 7, "shipment_id": "S2", "at": "x"},
    ]
    repo.set_stock_overlay(lambda: overlay)
    after = {m["medicine_name"]: m for m in repo.medicine_stock_for("kota_phc_4")}
    assert after[ARV]["units_remaining"] == base[ARV] + 100
    assert after[new_med]["units_remaining"] == 50
    assert after[new_med]["avg_daily_consumption"] == 15
    # The underlying rows are not mutated.
    raw = {m["medicine_name"]: m["units_remaining"] for m in repo.medicine_stock if m["facility_id"] == "kota_phc_4"}
    assert raw == base


def test_overlay_can_change_risk_level(monkeypatch):
    set_source(monkeypatch, "seed")
    repo = DistrictRepository(SEED)
    fs = ForecastService(repo)
    assert fs.facility_risk_level("kota_phc_4") == "critical"
    repo.set_stock_overlay(lambda: [{"facility_id": "kota_phc_4", "medicine_name": ARV, "units": 500}])
    assert fs.facility_risk_level("kota_phc_4") != "critical"


def test_overlay_ignored_on_firestore(monkeypatch):
    set_source(monkeypatch, "auto")
    repo = DistrictRepository(SEED, client_factory=lambda: FakeFirestore())
    plain = repo.medicine_stock_for("kota_phc_4")
    repo.set_stock_overlay(lambda: [{"facility_id": "kota_phc_4", "medicine_name": ARV, "units": 500}])
    assert repo.medicine_stock_for("kota_phc_4") == plain


def test_zero_consumption_guard_k6(monkeypatch):
    set_source(monkeypatch, "auto")
    fake = FakeFirestore()
    doc = fake.store["medicine_stock"][0]
    fake.store["medicine_stock"][0] = FakeDoc(doc.id, {**doc.to_dict(), "avg_daily_consumption": 0})
    repo = DistrictRepository(SEED, client_factory=lambda: fake)
    facility_id = doc.to_dict()["facility_id"]
    assert ForecastService(repo).medicine_forecast(facility_id)


def test_bed_without_facility_id_guard_k7(monkeypatch):
    set_source(monkeypatch, "auto")
    fake = FakeFirestore()
    orphan = {"occupied": 3, "predicted_occupancy_tomorrow_pct": 1, "predicted_occupancy_next_week_pct": 1}
    fake.store["beds"].insert(0, FakeDoc("orphan", orphan))
    repo = DistrictRepository(SEED, client_factory=lambda: fake)
    fid = SEED_DATA["beds"][0]["facility_id"]
    assert ForecastService(repo).bed_forecast(fid)["facility_id"] == fid


def test_service_account_parsing_raw_and_base64():
    info = {"type": "service_account", "project_id": "p"}
    raw = json.dumps(info)
    assert dr._service_account_info(raw) == info
    assert dr._service_account_info(base64.b64encode(raw.encode()).decode()) == info
    with pytest.raises(ValueError):
        dr._service_account_info("not-valid-!!")


def test_build_client_uses_service_account_when_set(monkeypatch):
    info = {"type": "service_account", "project_id": "proj-x"}
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT", base64.b64encode(json.dumps(info).encode()).decode())
    get_settings.cache_clear()
    captured = {}

    from google.cloud import firestore
    from google.oauth2 import service_account

    def fake_creds(cls, i):
        captured["info"] = i
        return "creds"

    monkeypatch.setattr(service_account.Credentials, "from_service_account_info", classmethod(fake_creds))
    monkeypatch.setattr(firestore, "Client", lambda **kw: captured.setdefault("kw", kw))
    dr.build_firestore_client()
    assert captured["info"] == info
    assert captured["kw"]["project"] == "proj-x"
    assert captured["kw"]["credentials"] == "creds"
