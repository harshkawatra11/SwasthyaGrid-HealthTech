"""Domain core: clock, models and the pure simulator (A4). No sleeping, fixed times."""

import random
from datetime import UTC, datetime, timedelta
from itertools import pairwise

import pytest

from app.logistics import roads, sim
from app.logistics.clock import IST, SimClock, iso, parse_iso, today_0830_ist
from app.logistics.models import (
    Driver,
    PodRecord,
    Shipment,
    ShipmentLine,
    Stop,
    Vehicle,
)

ROUTES = roads.load_routes()
T0 = datetime(2026, 9, 26, 3, 0, tzinfo=UTC)  # 08:30 IST


class FixedRng(random.Random):
    """`random()` returns scripted values; other draws stay seeded and deterministic."""

    def __init__(self, *values: float):
        super().__init__(7)
        self._values = list(values)

    def random(self):
        return self._values.pop(0) if self._values else 0.99


def make_vehicle(cls="van", vid="RJ20GB4821") -> Vehicle:
    spec = sim.VEHICLE_CLASSES[cls]
    return Vehicle(
        id=vid,
        registration="RJ20 GB 4821",
        vehicle_class=cls,
        label=cls,
        capacity_kg=spec["capacity_kg"],
        pallet_slots=spec["pallet_slots"],
        cold_chain=spec["cold_chain"],
        home_warehouse_id="ddw_kota",
        district_id="district_kota",
        odometer_km=50000,
        km_since_service=1000,
        fuel_pct=80,
    )


DRIVER = Driver(
    id="drv_001",
    name="Test Driver",
    phone_masked="+91 9xxxx x0000",
    license_masked="RJ20 2010 xxx123",
    license_expiry="2031-01-01",
    home_warehouse_id="ddw_kota",
    shift="06:00-14:00",
    rating=4.5,
    years_experience=8,
    languages=["Hindi"],
)


def make_shipment(
    sid="SHP-200001",
    stops=None,
    kind="replenishment",
    cold=False,
    origin="ddw_kota",
    dest="kota_phc_4",
    approved=True,
) -> Shipment:
    stops = stops or [Stop(node_id=dest, node_kind="facility", purpose="dropoff")]
    line = ShipmentLine(
        medicine_name="Anti-Rabies Vaccine (ARV)" if cold else "Paracetamol",
        units=120,
        cartons=2,
        weight_kg=4.4,
        pallet_slots=1,
        cold_chain=cold,
    )
    return Shipment(
        id=sid,
        district_id="district_kota",
        origin_id=origin,
        stops=stops,
        destination_facility_id=stops[-1].node_id,
        lines=[line],
        weight_kg=4.4,
        pallet_slots=1,
        cold_chain=cold,
        priority="critical",
        kind=kind,
        status="approved" if approved else "recommended",
        created_at=T0 - timedelta(minutes=30),
        approved_at=T0 - timedelta(minutes=20) if approved else None,
        approved_by="Officer",
    )


def trip_for(shipment, start=T0, rng=None, cls="van"):
    rng = rng or FixedRng(0.99, 0.99)
    trip = sim.build_trip(shipment, make_vehicle(cls), DRIVER, start, ROUTES, rng)
    shipment.trip = trip
    return trip


def end_point(key):
    coords, _ = roads.decoded(ROUTES[key]["polyline"])
    return coords[-1]


# ------------------------------------------------------------------------ clock


def test_clock_scales_and_rescales_with_fake_time():
    now = [1000.0]
    clock = SimClock(anchor_real=1000.0, anchor_sim=T0, scale=60, time_fn=lambda: now[0])
    assert clock.now() == T0
    now[0] = 1060.0
    assert clock.now() == T0 + timedelta(hours=1)
    clock.rescale(1)
    assert clock.scale == 1
    assert clock.now() == T0 + timedelta(hours=1)
    now[0] = 1090.0
    assert clock.now() == T0 + timedelta(hours=1, seconds=30)
    assert clock.now(real=1060.0) == T0 + timedelta(hours=1)
    clock.reanchor(T0)
    assert clock.now() == T0


def test_time_helpers_round_trip():
    dt = datetime(2026, 9, 26, 3, 0, 5, tzinfo=UTC)
    assert iso(dt) == "2026-09-26T03:00:05Z"
    assert parse_iso("2026-09-26T03:00:05Z") == dt
    assert parse_iso("2026-09-26T08:30:05+05:30") == dt
    assert iso(datetime(2026, 9, 26, 3, 0, tzinfo=UTC)) == "2026-09-26T03:00:00Z"
    assert today_0830_ist(datetime(2026, 9, 26, 18, 0, tzinfo=UTC)) == T0
    assert T0.astimezone(IST).hour == 8


# ------------------------------------------------------------------------ helpers


def test_load_minutes_capped_and_traffic_factor():
    assert sim.load_minutes(1) == 18
    assert sim.load_minutes(3) == 30
    assert sim.load_minutes(12) == 45
    assert sim.traffic_factor(datetime(2026, 9, 26, 3, 30, tzinfo=UTC)) == 1.2  # 09:00 IST
    assert sim.traffic_factor(datetime(2026, 9, 26, 3, 0, tzinfo=UTC)) == 1.0  # 08:30 IST
    assert sim.traffic_factor(datetime(2026, 9, 26, 13, 0, tzinfo=UTC)) == 1.2  # 18:30 IST


def test_shipment_rng_is_deterministic_per_id():
    a = [sim.shipment_rng("SHP-1").random() for _ in range(3)]
    b = [sim.shipment_rng("SHP-1").random() for _ in range(3)]
    c = sim.shipment_rng("SHP-2").random()
    assert a == b
    assert c != a[0]


def test_pick_vehicle_class_smallest_adequate():
    assert sim.pick_vehicle_class(100, 1, False) == "van"
    assert sim.pick_vehicle_class(100, 1, True) == "reefer_van"
    assert sim.pick_vehicle_class(1000, 3, False) == "light_truck"
    assert sim.pick_vehicle_class(100, 1, False, central=True) == "medium_truck"
    assert sim.pick_vehicle_class(100, 1, True, central=True) == "reefer_truck"
    assert sim.pick_vehicle_class(9000, 1, False) is None


def test_estimate_trip_minutes_matches_route_and_class():
    r = ROUTES["ddw_kota->kota_phc_4"]
    est = sim.estimate_trip_minutes(ROUTES, "ddw_kota", ["kota_phc_4"], 1, "van")
    assert est == pytest.approx(18 + r["duration_s"] / 60 * 1.25)
    lateral = sim.estimate_trip_minutes(
        ROUTES, "ddw_kota", ["kota_phc_1", "kota_phc_4"], 1, "van", pickups=1
    )
    assert lateral > est - 1


def test_missing_route_raises():
    s = make_shipment(dest="nowhere")
    with pytest.raises(sim.MissingRouteError):
        sim.build_trip(s, make_vehicle(), DRIVER, T0, ROUTES, FixedRng())


# ------------------------------------------------------------------------ trips and status


def test_one_leg_status_sequence():
    s = make_shipment()
    approved_at = s.approved_at
    assert sim.derive_status(make_shipment(approved=False), T0) == "recommended"
    assert sim.derive_status(s, approved_at - timedelta(minutes=1)) == "recommended"
    assert sim.derive_status(s, T0) == "approved"  # approved, no trip yet

    start = T0 + timedelta(minutes=10)
    trip = trip_for(s, start=start)
    kinds = [seg.kind for seg in trip.segments]
    assert kinds == ["load", "drive"]
    assert sim.derive_status(s, start - timedelta(minutes=1)) == "approved"
    assert sim.derive_status(s, start + timedelta(minutes=1)) == "loading"
    drive = trip.segments[1]
    mid = drive.start + (drive.end - drive.start) / 2
    assert sim.derive_status(s, mid) == "in_transit"
    assert sim.derive_status(s, trip.projected_arrival) == "arrived"
    assert trip.planned_arrival == trip.projected_arrival
    assert trip.segments[0].end - trip.segments[0].start == timedelta(minutes=18)

    s.status = "delivered"
    assert sim.derive_status(s, mid) == "delivered"
    s.status = "cancelled"
    assert sim.derive_status(s, mid) == "cancelled"


def test_lateral_two_leg_trip_has_pickup_dwell():
    stops = [
        Stop(node_id="kota_phc_1", node_kind="facility", purpose="pickup", dwell_minutes=15),
        Stop(node_id="kota_phc_4", node_kind="facility", purpose="dropoff"),
    ]
    s = make_shipment(stops=stops, kind="lateral_transfer")
    trip = trip_for(s)
    assert [seg.kind for seg in trip.segments] == ["load", "drive", "dwell", "drive"]
    dwell = trip.segments[2]
    assert dwell.end - dwell.start == timedelta(minutes=15)
    assert dwell.node_id == "kota_phc_1"
    assert trip.segments[1].route_key == "ddw_kota->kota_phc_1"
    assert trip.segments[3].route_key == "kota_phc_1->kota_phc_4"
    assert sim.derive_status(s, dwell.start + timedelta(minutes=5)) == "in_transit"
    pos = sim.position(s, dwell.start + timedelta(minutes=5), ROUTES)
    assert pos.speed_kmh == 0
    types = [e.type for e in sim.derive_events(s, trip.projected_arrival)]
    assert types.index("arrived_pickup") < types.index("departed_pickup") < types.index("arrived")


def test_incident_makes_status_delayed_during_and_after():
    s = make_shipment()
    trip = trip_for(s, rng=FixedRng(0.0, 0.99))  # incident, no excursion
    kinds = [seg.kind for seg in trip.segments]
    assert kinds == ["load", "drive", "incident", "drive"]
    inc = trip.segments[2]
    assert inc.note in sim.INCIDENT_REASONS
    minutes = (inc.end - inc.start).total_seconds() / 60
    assert minutes in sim.INCIDENT_MINUTES
    assert trip.projected_arrival - trip.planned_arrival == inc.end - inc.start
    assert sim.derive_status(s, inc.start + timedelta(seconds=1)) == "delayed"
    after = trip.segments[3]
    assert sim.derive_status(s, after.start + timedelta(seconds=1)) == "delayed"
    assert sim.delay_minutes(s) == round(minutes)
    # Before the incident the ETA is already pushed out, so the status is delayed too.
    assert sim.derive_status(s, trip.segments[1].start) == "delayed"
    assert sim.derive_status(s, trip.projected_arrival) == "arrived"
    # The two drive halves cover the whole route.
    assert trip.segments[1].to_fraction == trip.segments[3].from_fraction == inc.from_fraction
    assert 0.25 <= inc.from_fraction <= 0.8


def test_position_progress_is_monotonic_and_ends_at_destination():
    s = make_shipment()
    trip = trip_for(s, rng=FixedRng(0.0, 0.99))
    t = trip.planned_start - timedelta(minutes=2)
    last = -1.0
    while t <= trip.projected_arrival + timedelta(minutes=5):
        pos = sim.position(s, t, ROUTES)
        assert pos.progress >= last
        assert 0 <= pos.bearing <= 360
        last = pos.progress
        t += timedelta(minutes=1)
    final = sim.position(s, trip.projected_arrival + timedelta(minutes=30), ROUTES)
    lat, lng = end_point("ddw_kota->kota_phc_4")
    assert roads.haversine_m(final.lat, final.lng, lat, lng) < 30
    assert final.progress == 1.0
    assert final.speed_kmh == 0


def test_speed_zero_while_loading_and_dwelling_and_positive_driving():
    stops = [
        Stop(node_id="kota_phc_1", node_kind="facility", purpose="pickup", dwell_minutes=15),
        Stop(node_id="kota_phc_4", node_kind="facility", purpose="dropoff"),
    ]
    s = make_shipment(stops=stops, kind="lateral_transfer")
    trip = trip_for(s)
    load, d1, dwell, _d2 = trip.segments
    assert sim.position(s, load.start + timedelta(minutes=1), ROUTES).speed_kmh == 0
    assert sim.position(s, dwell.start + timedelta(minutes=1), ROUTES).speed_kmh == 0
    mid = d1.start + (d1.end - d1.start) / 2
    driving = sim.position(s, mid, ROUTES)
    assert driving.speed_kmh > 0
    assert 0 < driving.progress < 1
    before = sim.position(s, trip.planned_start - timedelta(hours=1), ROUTES)
    assert before.progress == 0 and before.speed_kmh == 0
    at_pickup = sim.position(s, dwell.start + timedelta(minutes=1), ROUTES)
    lat, lng = end_point("ddw_kota->kota_phc_1")
    assert roads.haversine_m(at_pickup.lat, at_pickup.lng, lat, lng) < 30


def test_incident_position_is_stationary_on_the_route():
    s = make_shipment()
    trip = trip_for(s, rng=FixedRng(0.0, 0.99))
    inc = trip.segments[2]
    a = sim.position(s, inc.start + timedelta(minutes=1), ROUTES)
    b = sim.position(s, inc.end - timedelta(minutes=1), ROUTES)
    assert (a.lat, a.lng) == (b.lat, b.lng)
    assert a.speed_kmh == 0


def test_position_none_without_trip_and_ease_is_monotonic():
    assert sim.position(make_shipment(), T0, ROUTES) is None
    values = [sim._ease(i / 1000) for i in range(1001)]
    assert values[0] == 0 and values[-1] == pytest.approx(1.0)
    assert all(b >= a for a, b in pairwise(values))
    assert sim._ease(0.5) == 0.5


def test_events_are_deterministic_and_ordered():
    names = {"ddw_kota": "District Drug Warehouse, Kota", "kota_phc_4": "PHC Kota-4"}
    ctx = sim.EventContext(names=names, vehicle_registration="RJ20 GB 4821", driver_name="Test Driver")

    def derive():
        s = make_shipment()
        trip_for(s, rng=sim.shipment_rng(s.id))
        return s, [e.model_dump(mode="json") for e in sim.derive_events(s, T0 + timedelta(days=1), ROUTES, ctx)]

    s1, first = derive()
    _, second = derive()
    assert first == second
    times = [e["at"] for e in first]
    assert times == sorted(times)
    titles = [e["title"] for e in first]
    assert "Departed District Drug Warehouse, Kota" in titles
    assert "Arrived at PHC Kota-4" in titles
    assert first[0]["type"] == "created"
    # Nothing after `t`.
    early = sim.derive_events(s1, s1.created_at)
    assert [e.type for e in early] == ["created"]
    for e in first:
        assert e["at"].endswith("Z") and len(e["at"]) == 20


def test_pod_and_cancel_events():
    s = make_shipment()
    trip = trip_for(s)
    s.pod = PodRecord(
        pod_id="p1",
        confirmed_at=trip.projected_arrival + timedelta(minutes=10),
        confirmed_by="PHC Officer",
        received=[{"medicine_name": "Paracetamol", "units": 120}],
    )
    s.status = "delivered"
    types = [e.type for e in sim.derive_events(s, T0 + timedelta(days=1), ROUTES)]
    assert types[-1] == "pod_confirmed"

    c = make_shipment(sid="SHP-200002")
    trip = trip_for(c)
    c.cancelled_at = trip.segments[1].start
    c.cancel_reason = "Duplicate indent"
    c.status = "cancelled"
    events = sim.derive_events(c, T0 + timedelta(days=1), ROUTES)
    assert events[-1].type == "cancelled"
    assert events[-1].title == "Cancelled: Duplicate indent"
    assert "arrived" not in [e.type for e in events]


def test_reefer_excursion_breach_then_recovered_and_temperature():
    s = make_shipment(cold=True)
    trip = trip_for(s, rng=FixedRng(0.99, 0.0), cls="reefer_van")  # no incident, excursion
    assert trip.reefer_excursion is not None
    begin, end = trip.reefer_excursion
    assert end - begin == timedelta(minutes=14)
    types = [e.type for e in sim.derive_events(s, trip.projected_arrival, ROUTES)]
    assert types.index("cold_chain_breach") < types.index("cold_chain_recovered")
    normal = sim.temperature_at(s, trip.planned_start)
    assert 4.0 <= normal <= 5.2
    late = sim.temperature_at(s, end - timedelta(seconds=30))
    assert late > 8.0
    assert sim.position(s, begin + timedelta(minutes=1), ROUTES).temp_c is not None
    assert sim.temperature_at(make_shipment(), T0) is None
    assert sim.temperature_at(make_shipment(cold=True), T0) is None  # no trip yet


def test_reefer_without_excursion_has_no_breach_events():
    s = make_shipment(cold=True)
    trip = trip_for(s, rng=FixedRng(0.99, 0.99), cls="reefer_van")
    assert trip.reefer_excursion is None
    types = [e.type for e in sim.derive_events(s, trip.projected_arrival, ROUTES)]
    assert "cold_chain_breach" not in types


def test_traffic_factor_applied_at_0900_ist():
    quiet = trip_for(make_shipment(), start=datetime(2026, 9, 26, 6, 30, tzinfo=UTC))  # 12:00 IST
    peak = trip_for(make_shipment(), start=datetime(2026, 9, 26, 3, 30, tzinfo=UTC))  # 09:00 IST
    quiet_drive = quiet.segments[1].end - quiet.segments[1].start
    peak_drive = peak.segments[1].end - peak.segments[1].start
    assert peak_drive.total_seconds() == pytest.approx(quiet_drive.total_seconds() * 1.2, abs=2)
    base = ROUTES["ddw_kota->kota_phc_4"]["duration_s"] * 1.25
    assert quiet_drive.total_seconds() == pytest.approx(base, abs=1)


def test_trip_helpers_and_serialisation():
    s = make_shipment()
    trip = trip_for(s, rng=FixedRng(0.0, 0.99))
    assert sim.first_departure(trip) == trip.segments[1].start
    assert sim.trip_end(trip) == trip.projected_arrival
    assert sim.trip_drive_hours(trip) > 0
    dumped = trip.model_dump(mode="json")
    assert dumped["planned_start"] == iso(trip.planned_start)
    assert dumped["segments"][0]["start"].endswith("Z")
    round_trip = Shipment.model_validate(s.model_dump(mode="json"))
    assert round_trip.trip.projected_arrival == trip.projected_arrival
