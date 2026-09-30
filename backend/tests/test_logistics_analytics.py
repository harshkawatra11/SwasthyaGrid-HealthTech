"""Analytics (A7): a ten shipment fixture with hand computed expectations.

Evaluation time T is 2026-09-26 10:00 IST (04:30Z). IST day: 2026-09-25T18:30Z to
2026-09-26T18:30Z.

History (5):            created        departed  arrived  delivered  min   on time  driver vehicle
  h1 kota   today        02:00Z         02:20Z    03:00Z   03:30Z     40    yes      d1     v1
  h2 kota   today        23:30Z (-1d)   00:00Z    01:00Z   01:30Z     60    no       d1     v1
  h3 kota   yesterday    09-25 02:00Z   03:30Z    05:30Z   06:00Z     120   yes      d1     v2
  h4 alwar  3 days ago   09-23 03:00Z   04:30Z    05:00Z   05:30Z     30    yes      d2     v3
  h5 alwar  10 days ago  09-16 03:00Z   03:30Z    04:30Z   05:00Z     90    no       d2     v3
Live (5):
  L1 kota  in transit          drive 04:10Z-05:10Z, driver d3, v4, to kota_phc_4
  L2 kota  delayed, cold chain drive 03:50Z-05:00Z (projected 05:30Z), excursion 04:00Z, v5, from wh_central
  L3 alwar delivered today     drive 01:20Z-02:20Z, POD 04:00Z, d2, v3
  L4 kota  recommended draft   no trip
  L5 kota  arrived, awaiting POD  drive 03:00Z-04:00Z, d1, v7, 40 km
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.logistics import analytics
from app.logistics.models import (
    PodRecord,
    Segment,
    Shipment,
    ShipmentLine,
    Stop,
    TripPlan,
    Vehicle,
)

T = datetime(2026, 9, 26, 4, 30, tzinfo=UTC)


def z(day: int, hh: int, mm: int = 0, month: int = 9) -> datetime:
    return datetime(2026, month, day, hh, mm, tzinfo=UTC)


def hrow(hid, district, created, departed, arrived, delivered, minutes, on_time, driver, vehicle, **kw):
    row = {
        "id": hid,
        "district_id": district,
        "origin_id": "ddw_" + district.removeprefix("district_"),
        "destination_id": "kota_phc_4",
        "kind": "replenishment",
        "priority": "normal",
        "created_at": created.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "departed_at": departed.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "arrived_at": arrived.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "delivered_at": delivered.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "delivered",
        "actual_minutes": minutes,
        "on_time": on_time,
        "cold_chain": False,
        "vehicle_id": vehicle,
        "driver_id": driver,
    }
    row.update(kw)
    return row


HISTORY = [
    hrow("h1", "district_kota", z(26, 2), z(26, 2, 20), z(26, 3), z(26, 3, 30), 40, True, "d1", "v1"),
    hrow("h2", "district_kota", z(25, 23, 30), z(26, 0), z(26, 1), z(26, 1, 30), 60, False, "d1", "v1"),
    hrow("h3", "district_kota", z(25, 2), z(25, 3, 30), z(25, 5, 30), z(25, 6), 120, True, "d1", "v2"),
    hrow("h4", "district_alwar", z(23, 3), z(23, 4, 30), z(23, 5), z(23, 5, 30), 30, True, "d2", "v3"),
    hrow("h5", "district_alwar", z(16, 3), z(16, 3, 30), z(16, 4, 30), z(16, 5), 90, False, "d2", "v3"),
]


def trip(vehicle, driver, load_start, drive_start, drive_end, projected=None, km=40.0, excursion=None):
    return TripPlan(
        vehicle_id=vehicle,
        driver_id=driver,
        planned_start=load_start,
        segments=[
            Segment(kind="load", start=load_start, end=drive_start, node_id="ddw_kota"),
            Segment(kind="drive", start=drive_start, end=projected or drive_end, route_key="a->b"),
        ],
        planned_arrival=drive_end,
        projected_arrival=projected or drive_end,
        distance_km=km,
        reefer_excursion=excursion,
    )


def shipment(sid, district, origin, dest, created, **kw) -> Shipment:
    base = {
        "id": sid,
        "district_id": district,
        "origin_id": origin,
        "origin_kind": "warehouse",
        "stops": [Stop(node_id=dest, node_kind="facility", purpose="dropoff")],
        "destination_facility_id": dest,
        "lines": [ShipmentLine(medicine_name="ORS", units=10, cartons=1, weight_kg=1.0, pallet_slots=1, cold_chain=False)],
        "weight_kg": 1.0,
        "pallet_slots": 1,
        "cold_chain": False,
        "priority": "normal",
        "source_recommendation_id": None,
        "kind": "replenishment",
        "status": "recommended",
        "created_at": created,
    }
    base.update(kw)
    return Shipment(**base)


def live_shipments() -> list[Shipment]:
    l1 = shipment(
        "L1", "district_kota", "ddw_kota", "kota_phc_4", z(26, 3, 40),
        approved_at=z(26, 3, 45), status="approved",
        trip=trip("v4", "d3", z(26, 3, 50), z(26, 4, 10), z(26, 5, 10)),
    )
    l2 = shipment(
        "L2", "district_kota", "wh_central", "kota_phc_4", z(26, 3, 20),
        approved_at=z(26, 3, 25), status="approved", cold_chain=True,
        trip=trip("v5", "d4", z(26, 3, 30), z(26, 3, 50), z(26, 5, 0), projected=z(26, 5, 30),
                  excursion=(z(26, 4, 0), z(26, 4, 14))),
    )
    l3 = shipment(
        "L3", "district_alwar", "ddw_alwar", "alwar_phc_1", z(26, 0, 30),
        approved_at=z(26, 0, 35), status="delivered",
        trip=trip("v3", "d2", z(26, 1, 0), z(26, 1, 20), z(26, 2, 20), km=30.0),
        pod=PodRecord(pod_id="p", confirmed_at=z(26, 4, 0), confirmed_by="x", received=[]),
    )
    l4 = shipment("L4", "district_kota", "ddw_kota", "kota_phc_4", z(26, 4, 0))
    l5 = shipment(
        "L5", "district_kota", "ddw_kota", "kota_phc_4", z(26, 2, 20),
        approved_at=z(26, 2, 25), status="approved",
        trip=trip("v7", "d1", z(26, 2, 40), z(26, 3, 0), z(26, 4, 0), km=40.0),
    )
    return [l1, l2, l3, l4, l5]


def vehicle(vid: str, district: str, status: str = "available") -> Vehicle:
    return Vehicle.model_validate(
        {
            "id": vid, "registration": vid.upper(), "class": "van", "label": vid, "capacity_kg": 750,
            "pallet_slots": 2, "cold_chain": False, "home_warehouse_id": "ddw_x", "district_id": district,
            "odometer_km": 0, "km_since_service": 0, "fuel_pct": 80, "status": status,
        }
    )


VEHICLES = [
    vehicle("v1", "district_kota"), vehicle("v2", "district_kota"), vehicle("v3", "district_alwar"),
    vehicle("v4", "district_kota"), vehicle("v5", "district_kota"), vehicle("v6", "district_alwar"),
    vehicle("v7", "district_kota"), vehicle("v8", "district_kota", "maintenance"),
]


def test_fixture_derives_the_intended_statuses():
    from app.logistics import sim

    got = {s.id: sim.derive_status(s, T) for s in live_shipments()}
    assert got == {
        "L1": "in_transit", "L2": "delayed", "L3": "delivered", "L4": "recommended", "L5": "arrived",
    }


def test_kpis_state():
    k = analytics.kpis(None, T, HISTORY, live_shipments(), VEHICLES)
    assert k["sim_now"] == "2026-09-26T04:30:00Z"
    assert k["delivered_today"] == 3  # h1, h2, L3 (h3 was yesterday)
    assert k["in_transit_now"] == 1  # L1
    assert k["delayed_now"] == 1  # L2
    assert k["on_time_rate_today"] == 0.75  # arrived today: h1 yes, h2 no, L3 yes, L5 yes
    assert k["on_time_rate_7d"] == 0.833  # h1 h2 h3 h4 L3 L5: five of six
    assert k["avg_transit_hours_7d"] == 1.03  # (40 + 60 + 120 + 30 + 60 + 60) / 6 min
    assert k["vehicles_in_transit"] == 2  # v4, v5
    assert k["vehicles_available"] == 5  # v1 v2 v3 v6 v7 (v8 in maintenance, v4 v5 moving)
    assert k["pending_approvals"] == 1  # L4
    assert k["cold_chain_active"] == 1  # L2
    assert k["cold_chain_breaches_today"] == 1  # L2 excursion began 04:00Z


def test_kpis_district_scope_and_unavailable_vehicles():
    k = analytics.kpis("district_kota", T, HISTORY, live_shipments(), VEHICLES, unavailable_vehicles=["v7"])
    assert k["delivered_today"] == 2  # h1, h2
    assert k["on_time_rate_today"] == 0.667  # h1 yes, h2 no, L5 yes
    assert k["on_time_rate_7d"] == 0.75  # h1 h2 h3 L5
    assert k["vehicles_available"] == 2  # v1 v2 (v7 flagged out, v8 maintenance, v4 v5 moving)
    assert k["pending_approvals"] == 1
    other = analytics.kpis("district_alwar", T, HISTORY, live_shipments(), VEHICLES)
    assert other["delivered_today"] == 1 and other["in_transit_now"] == 0
    assert other["vehicles_available"] == 2 and other["cold_chain_active"] == 0


def test_kpis_with_no_data_have_no_rates():
    k = analytics.kpis("district_udaipur", T, HISTORY, live_shipments(), VEHICLES)
    assert k["delivered_today"] == 0
    assert k["on_time_rate_today"] is None and k["on_time_rate_7d"] is None
    assert k["avg_transit_hours_7d"] is None and k["vehicles_available"] == 0


def test_kpis_before_a_shipment_exists_ignores_it():
    early = z(26, 0, 10)
    k = analytics.kpis(None, early, HISTORY, live_shipments(), VEHICLES)
    assert k["pending_approvals"] == 0 and k["in_transit_now"] == 0
    assert k["delivered_today"] == 0  # h2 is delivered at 01:30Z, after `early`


def test_volume_series():
    pts = analytics.volume_series(None, T, HISTORY, live_shipments(), days=3)["points"]
    assert [p["date"] for p in pts] == ["2026-09-24", "2026-09-25", "2026-09-26"]
    assert pts[0] == {"date": "2026-09-24", "shipments": 0, "delivered": 0, "avg_transit_hours": None, "on_time_rate": None}
    assert pts[1] == {"date": "2026-09-25", "shipments": 1, "delivered": 1, "avg_transit_hours": 2.0, "on_time_rate": 1.0}
    # today: created h1 h2 L1..L5 = 7, delivered h1 h2 L3, (40 + 60 + 60) / 3 min = 0.89 h, on time 2 of 3
    assert pts[2] == {"date": "2026-09-26", "shipments": 7, "delivered": 3, "avg_transit_hours": 0.89, "on_time_rate": 0.667}
    kota = analytics.volume_series("district_kota", T, HISTORY, live_shipments(), days=1)["points"]
    assert kota[0]["shipments"] == 6 and kota[0]["delivered"] == 2


def test_volume_series_default_is_90_days_oldest_first():
    pts = analytics.volume_series(None, T, HISTORY, [])["points"]
    assert len(pts) == 90 and pts[-1]["date"] == "2026-09-26" and pts[0]["date"] == "2026-06-29"
    assert pts == sorted(pts, key=lambda p: p["date"])


def test_status_breakdown():
    out = analytics.status_breakdown(None, T, live_shipments())
    assert out["date"] == "2026-09-26"
    assert out["counts"] == {
        "recommended": 1, "approved": 0, "loading": 0, "in_transit": 1, "delayed": 1,
        "arrived": 1, "delivered": 1, "cancelled": 0,
    }
    assert analytics.status_breakdown("district_alwar", T, live_shipments())["counts"]["delivered"] == 1


def test_status_breakdown_counts_todays_cancellations_only():
    today = shipment("C1", "district_kota", "ddw_kota", "kota_phc_4", z(26, 3), status="cancelled", cancelled_at=z(26, 4))
    old = shipment("C2", "district_kota", "ddw_kota", "kota_phc_4", z(24, 3), status="cancelled", cancelled_at=z(24, 4))
    counts = analytics.status_breakdown("district_kota", T, [today, old])["counts"]
    assert counts["cancelled"] == 1


def test_driver_stats():
    d1 = analytics.driver_stats("d1", T, HISTORY, live_shipments(), rating=4.5)
    assert d1["deliveries_30d"] == 3  # h1 h2 h3 (L5 is still awaiting POD)
    assert d1["on_time_rate_30d"] == 0.667
    assert d1["avg_rating"] == 4.5
    assert d1["hours_today"] == 2.67  # L5 1 h + h1 40 min + h2 1 h
    assert d1["km_today"] == 40.0
    d2 = analytics.driver_stats("d2", T, HISTORY, live_shipments())
    assert d2["deliveries_30d"] == 3 and d2["on_time_rate_30d"] == 0.667  # h4 yes, h5 no, L3 yes
    assert d2["hours_today"] == 1.0 and d2["km_today"] == 30.0
    nobody = analytics.driver_stats("dx", T, HISTORY, live_shipments())
    assert nobody["deliveries_30d"] == 0 and nobody["on_time_rate_30d"] is None and nobody["hours_today"] == 0.0


def test_driver_km_is_prorated_for_a_trip_in_progress():
    half = shipment(
        "P1", "district_kota", "ddw_kota", "kota_phc_4", z(26, 3), approved_at=z(26, 3), status="approved",
        trip=trip("v9", "d9", z(26, 3, 30), z(26, 3, 30), z(26, 5, 30), km=100.0),
    )
    stats = analytics.driver_stats("d9", z(26, 4, 30), [], [half])
    assert stats["hours_today"] == 1.0 and stats["km_today"] == 50.0


def test_vehicle_utilisation():
    rows = {r["vehicle_id"]: r["utilisation_7d"] for r in analytics.vehicle_utilisation(None, T, HISTORY, live_shipments(), VEHICLES)}
    hours = {
        "v1": 1 + 40 / 60,  # h2 1 h, h1 40 min
        "v2": 2.0,  # h3
        "v3": 0.5 + 4 / 3,  # h4 30 min (h5 is outside the window), L3 from 01:00 to 02:20
        "v4": 40 / 60,  # L1 loads at 03:50Z, T is 04:30Z
        "v5": 1.0,  # L2 from 03:30Z to T
        "v6": 0.0,
        "v7": 4 / 3,  # L5 02:40Z to 04:00Z
        "v8": 0.0,
    }
    assert rows == {k: round(v / 168, 3) for k, v in hours.items()}
    kota = analytics.vehicle_utilisation("district_kota", T, HISTORY, live_shipments(), VEHICLES)
    assert {r["vehicle_id"] for r in kota} == {"v1", "v2", "v4", "v5", "v7", "v8"}


def test_warehouse_flow():
    rows = [
        {"medicine_name": "Anti-Rabies Vaccine (ARV)", "units": 100, "batch_no": "B1", "expiry_date": "2026-10-15"},
        {"medicine_name": "ORS", "units": 5000, "batch_no": "B2", "expiry_date": "2027-06-01"},
        {"medicine_name": "Zinc", "units": 10, "batch_no": "B3", "expiry_date": None},
    ]
    flow = analytics.warehouse_flow(
        "ddw_kota", T, HISTORY, live_shipments(), rows,
        reservations={"Anti-Rabies Vaccine (ARV)": 30},
        adjustments={"Anti-Rabies Vaccine (ARV)": -20},
        daily_consumption={"Anti-Rabies Vaccine (ARV)": 10.0, "ORS": 500.0},
    )
    assert flow["outbound_today"] == 4  # h1, h2, L1, L5 (L2 leaves wh_central, L4 has not left)
    assert flow["reserved_units"] == 30
    by = {x["medicine_name"]: x for x in flow["stock"]}
    arv = by["Anti-Rabies Vaccine (ARV)"]
    assert (arv["units"], arv["reserved"], arv["days_of_cover"], arv["expiring_soon"]) == (80, 30, 5.0, True)
    assert by["ORS"]["days_of_cover"] == 10.0 and by["ORS"]["expiring_soon"] is False
    assert by["Zinc"]["days_of_cover"] is None and by["Zinc"]["expiring_soon"] is False
    assert flow["low_cover_medicines"] == 1  # only ARV is under 7 days
    central = analytics.warehouse_flow("wh_central", T, HISTORY, live_shipments(), [])
    assert central["outbound_today"] == 1  # L2


def test_facility_inbound_orders_by_eta_and_skips_inactive():
    rows = analytics.facility_inbound("kota_phc_4", T, live_shipments())
    assert [r["shipment_id"] for r in rows] == ["L5", "L1", "L2"]
    assert [r["status"] for r in rows] == ["arrived", "in_transit", "delayed"]
    assert rows[2]["delay_minutes"] == 30 and rows[0]["eta"] == z(26, 4)
    assert analytics.facility_inbound("alwar_phc_1", T, live_shipments()) == []  # L3 is delivered
    early = analytics.facility_inbound("kota_phc_4", z(26, 3, 0), live_shipments())
    assert [r["shipment_id"] for r in early] == ["L5"]  # L1 and L2 are created later


def test_records_from_history_respect_time():
    at = z(26, 3, 15)  # h1 arrived at 03:00Z but is delivered at 03:30Z
    rec = analytics.record_from_history(HISTORY[0], at)
    assert rec is not None and rec.status == "arrived" and rec.delivered_at is None
    assert rec.on_time is True and rec.actual_minutes == 40
    assert analytics.record_from_history(HISTORY[0], z(26, 1)) is None  # not created yet
    mid = analytics.record_from_history(HISTORY[0], z(26, 2, 40))
    assert mid is not None and mid.status == "in_transit" and mid.on_time is None


@pytest.mark.parametrize("scope", [None, "district_kota"])
def test_kpis_are_pure(scope):
    ships = live_shipments()
    a = analytics.kpis(scope, T, HISTORY, ships, VEHICLES)
    b = analytics.kpis(scope, T + timedelta(0), HISTORY, ships, VEHICLES)
    assert a == b
    assert all(s.status in ("approved", "delivered", "recommended") for s in ships)  # nothing mutated
