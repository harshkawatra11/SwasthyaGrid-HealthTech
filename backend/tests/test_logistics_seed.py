import json
import sys
from collections import Counter
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.logistics.polyline import decode, encode

DATA = Path(__file__).resolve().parents[1] / "data"
IST = timezone(timedelta(hours=5, minutes=30))


def _load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def seed():
    return _load("seed_districts.json")


@pytest.fixture(scope="module")
def logistics():
    return _load("seed_logistics.json")


@pytest.fixture(scope="module")
def routes():
    return _load("routes.json")["routes"]


@pytest.fixture(scope="module")
def history():
    return _load("seed_logistics_history.json")["shipments"]


def test_polyline_known_string():
    encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    assert decode(encoded) == [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    assert encode(decode(encoded)) == encoded


def test_warehouses(logistics):
    whs = logistics["warehouses"]
    assert len(whs) == 6
    assert {w["type"] for w in whs} == {"central", "district"}
    assert [w["id"] for w in whs if w["type"] == "central"] == ["wh_central"]
    assert all(w["cold_room"] for w in whs)


def test_warehouse_stock_shape(logistics):
    stock = logistics["warehouse_stock"]
    assert len(stock) == 6 * 7
    ref = datetime.fromisoformat(logistics["_meta"]["reference_start"])
    soon = [
        r for r in stock
        if r["warehouse_id"] != "wh_central"
        and datetime.fromisoformat(r["expiry_date"]).replace(tzinfo=UTC) - ref < timedelta(days=45)
    ]
    assert len(soon) == 2
    ddw_sum: Counter = Counter()
    for r in stock:
        if r["warehouse_id"] != "wh_central":
            ddw_sum[r["medicine_name"]] += r["units"]
    for r in stock:
        if r["warehouse_id"] == "wh_central":
            assert r["units"] == 5 * ddw_sum[r["medicine_name"]]


def test_vehicles(logistics, seed):
    vehicles = logistics["vehicles"]
    assert len(vehicles) == 31
    assert len({v["registration"] for v in vehicles}) == 31
    assert len({v["id"] for v in vehicles}) == 31
    rto = {d["id"]: d["rto_code"] for d in seed["districts"]}
    for v in vehicles:
        assert v["registration"].startswith(rto[v["district_id"]] + " G")
        assert v["id"] == v["registration"].replace(" ", "")
    maint = [v for v in vehicles if v["status"] == "maintenance"]
    assert len(maint) == 2
    assert {v["class"] for v in maint} == {"van", "light_truck"}
    assert len({v["district_id"] for v in maint}) == 2
    assert Counter(v["class"] for v in vehicles) == {
        "van": 10, "light_truck": 10, "reefer_van": 5, "medium_truck": 4, "reefer_truck": 2,
    }


def test_drivers(logistics):
    drivers = logistics["drivers"]
    assert len(drivers) == 40
    assert len({d["name"] for d in drivers}) == 40
    per_wh = Counter(d["home_warehouse_id"] for d in drivers)
    assert per_wh["wh_central"] == 5
    assert all(n == 7 for wh, n in per_wh.items() if wh != "wh_central")
    night = Counter(d["home_warehouse_id"] for d in drivers if d["shift"] == "22:00-06:00")
    assert set(night) == set(per_wh)
    assert all(n == 1 for n in night.values())


def test_routes_cover_every_planner_pair(seed, logistics, routes):
    ddws = [w for w in logistics["warehouses"] if w["type"] == "district"]
    required = [f"wh_central->{w['id']}" for w in ddws]
    required += [f"wh_central->{f['id']}" for f in seed["facilities"]]
    for w in ddws:
        required += [f"{w['id']}->{f['id']}" for f in seed["facilities"] if f["district_id"] == w["district_id"]]
    for d in seed["districts"]:
        fids = [f["id"] for f in seed["facilities"] if f["district_id"] == d["id"]]
        required += [f"{a}->{b}" for a in fids for b in fids if a != b]
    assert len(required) == 5 + 40 + 40 + 5 * 56
    missing = [k for k in required if k not in routes]
    assert not missing


def test_route_polylines_decode(routes):
    for key, r in routes.items():
        assert len(decode(r["polyline"])) >= 2, key
        assert r["distance_m"] > 0 and r["duration_s"] > 0
        assert r["source"] in ("osrm", "synthetic")


def test_reverse_route_is_mirrored(routes):
    fwd = decode(routes["kota_phc_1->kota_phc_2"]["polyline"])
    rev = decode(routes["kota_phc_2->kota_phc_1"]["polyline"])
    assert rev == list(reversed(fwd))


def test_history_daily_counts_match_poisson_means(history):
    lam = {
        "district_jaipur_rural": 5, "district_alwar": 4, "district_bikaner": 3,
        "district_udaipur": 4, "district_kota": 4,
    }
    per_day: dict[str, Counter] = {d: Counter() for d in lam}
    for s in history:
        if s["kind"] != "replenishment":
            continue
        day = datetime.fromisoformat(s["created_at"]).astimezone(IST).date()
        per_day[s["district_id"]][day] += 1
    for district, expected in lam.items():
        mean = sum(per_day[district].values()) / 90
        assert abs(mean - expected) <= 0.25 * expected, (district, mean)


def test_history_cancel_share_and_shape(history):
    cancelled = sum(1 for s in history if s["status"] == "cancelled")
    assert 0.01 <= cancelled / len(history) <= 0.06
    assert len({s["id"] for s in history}) == len(history)
    for s in history:
        assert s["status"] in ("delivered", "cancelled")
        if s["status"] == "delivered":
            assert s["delivered_at"] and s["actual_minutes"] and s["on_time"] in (True, False)
        else:
            assert s["delivered_at"] is None


def test_history_uses_only_known_routes(history, routes):
    for s in history:
        assert f"{s['origin_id']}->{s['destination_id']}" in routes


def test_synthetic_route_fallback():
    sys.path.insert(0, str(DATA.parent / "scripts"))
    import build_routes

    r = build_routes.synthetic_route((26.9, 75.8), (27.5, 76.6))
    assert r["source"] == "synthetic"
    assert len(decode(r["polyline"])) == 7
    assert r["distance_m"] > 0 and r["duration_s"] > 0
    assert r == build_routes.synthetic_route((26.9, 75.8), (27.5, 76.6))
