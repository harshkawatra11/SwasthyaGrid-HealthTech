"""Planner, scenario, store and LogisticsService (A6). Fake clock, no sleeping."""

import random
from collections import Counter
from datetime import UTC, datetime, timedelta

import pytest

from app.core.exceptions import ShipmentStateError
from app.logistics import master, planner, roads, scenario, sim
from app.logistics.clock import IST, SimClock, iso, today_0830_ist
from app.logistics.models import Segment, Shipment, Stop, TripPlan
from app.logistics.service import LogisticsService
from app.logistics.store import JsonFileStateStore, MemoryStateStore
from app.repositories.district_repository import get_district_repository
from app.services.forecast_service import ForecastService
from app.services.recommendation_service import RecommendationService

ROUTES = roads.load_routes()
T0 = datetime(2026, 9, 26, 3, 0, tzinfo=UTC)  # 08:30 IST
ARV = "Anti-Rabies Vaccine (ARV)"


class FakeTime:
    def __init__(self, t: float = 0.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def make_service(
    store=None,
    *,
    boot: bool = True,
    background: bool = False,
    auto_pod: int = 240,
    time_start: float = 0.0,
    scale: float = 60.0,
):
    repo = get_district_repository()
    forecast = ForecastService(repo)
    recs = RecommendationService(repo, forecast)
    ft = FakeTime(time_start)
    clock = SimClock(anchor_real=ft.t, anchor_sim=T0, scale=scale, time_fn=ft)
    svc = LogisticsService(
        repo,
        forecast,
        recs,
        store or MemoryStateStore(),
        clock=clock,
        real_now=lambda: T0,
        background_traffic=background,
        auto_pod_minutes=auto_pod,
        time_scale=scale,
        scenario_start=T0,
    )
    if boot:
        svc.boot()
    return svc, ft


def go(svc: LogisticsService, ft: FakeTime, target: datetime) -> dict:
    """Move the fake clock so the service reads `target`, then tick."""
    ft.t += (target - svc.now()).total_seconds() / svc.clock.scale
    return svc.tick(target)


def statuses(svc: LogisticsService) -> Counter:
    now = svc.now()
    return Counter(svc.derived_status(s, now) for s in svc.state.shipments.values())


def kota_shipment(
    svc: LogisticsService,
    *,
    lines=None,
    kind: str = "replenishment",
    priority: str = "normal",
    dest: str = "kota_phc_4",
) -> Shipment:
    return svc.build_shipment(
        kind=kind,
        district_id="district_kota",
        origin_id="ddw_kota",
        stops=[Stop(node_id=dest, node_kind="facility", purpose="dropoff")],
        lines=lines or [("Paracetamol", 100)],
        priority=priority,
        created_at=T0,
    )


def fleet_for(svc: LogisticsService, **overrides) -> planner.FleetState:
    fleet = svc.fleet_state()
    for k, v in overrides.items():
        setattr(fleet, k, v)
    return fleet


# ---------------------------------------------------------------------------- planner


def test_planner_picks_smallest_adequate_class_and_best_driver():
    svc, _ = make_service(boot=False)
    s = kota_shipment(svc)
    plan = planner.assign(s, T0, svc.fleet_state())
    assert isinstance(plan, TripPlan)
    vehicle = svc.vehicle_by_id[plan.vehicle_id]
    assert vehicle.vehicle_class == "van"  # smallest class that carries 1.2 kg
    assert vehicle.home_warehouse_id == "ddw_kota"
    # highest rating on shift at 08:35 IST, ties broken by id
    assert plan.driver_id == "drv_034"
    assert plan.planned_start == T0 + timedelta(minutes=5)


def test_planner_capacity_moves_up_a_class_then_blocks():
    svc, _ = make_service(boot=False)
    s = kota_shipment(svc)
    s.weight_kg, s.pallet_slots = 800.0, 2
    plan = planner.assign(s, T0, svc.fleet_state())
    assert isinstance(plan, TripPlan)
    assert svc.vehicle_by_id[plan.vehicle_id].vehicle_class == "light_truck"

    s.weight_kg, s.pallet_slots = 3000.0, 2
    blocked = planner.assign(s, T0, svc.fleet_state())
    assert isinstance(blocked, planner.BlockedReason)
    assert blocked.reason == "No vehicle at DDW Kota can carry 3000 kg and 2 pallet slots"

    s.weight_kg, s.pallet_slots = 100.0, 4  # pallet slots exceed the van, light truck is fine
    plan = planner.assign(s, T0, svc.fleet_state())
    assert isinstance(plan, TripPlan)
    assert svc.vehicle_by_id[plan.vehicle_id].vehicle_class == "light_truck"


def test_planner_cold_chain_needs_a_reefer():
    svc, _ = make_service(boot=False)
    s = kota_shipment(svc, lines=[(ARV, 20)])
    assert s.cold_chain
    plan = planner.assign(s, T0, svc.fleet_state())
    assert isinstance(plan, TripPlan)
    assert svc.vehicle_by_id[plan.vehicle_id].cold_chain is True

    reefers = {v.id for v in svc.vehicles if v.home_warehouse_id == "ddw_kota" and v.cold_chain}
    blocked = planner.assign(s, T0, fleet_for(svc, maintenance=reefers))
    assert isinstance(blocked, planner.BlockedReason)
    assert blocked.reason == "No refrigerated vehicle at DDW Kota can carry this cold-chain load"


def test_planner_never_gives_a_reefer_to_a_plain_load():
    svc, _ = make_service(boot=False)
    s = kota_shipment(svc)
    plain = {v.id for v in svc.vehicles if v.home_warehouse_id == "ddw_kota" and not v.cold_chain}
    blocked = planner.assign(s, T0, fleet_for(svc, maintenance=plain))
    assert isinstance(blocked, planner.BlockedReason)


def test_planner_respects_driver_shift():
    svc, _ = make_service(boot=False)
    s = kota_shipment(svc)
    early = datetime(2026, 9, 25, 23, 30, tzinfo=UTC)  # 05:00 IST, 05:05 start
    plan = planner.assign(s, early, svc.fleet_state())
    assert isinstance(plan, TripPlan) and plan.driver_id == "drv_035"  # the 22:00-06:00 driver

    late = datetime(2026, 9, 26, 17, 0, tzinfo=UTC)  # 22:30 IST, no later shift starts today
    blocked = planner.assign(s, late, fleet_for(svc, off_duty={"drv_035"}))
    assert isinstance(blocked, planner.BlockedReason)
    assert blocked.reason == "No driver on shift at DDW Kota at 22:35"

    everyone = {d.id for d in svc.drivers if d.home_warehouse_id == "ddw_kota"}
    blocked = planner.assign(s, T0, fleet_for(svc, off_duty=everyone))
    assert isinstance(blocked, planner.BlockedReason)
    assert blocked.reason == "No driver available at DDW Kota: every driver is off duty"


def test_planner_defers_the_start_to_the_next_shift():
    svc, _ = make_service(boot=False)
    s = kota_shipment(svc)
    morning = {"drv_034", "drv_038", "drv_039", "drv_040"}  # everyone on shift at 08:35 IST
    plan = planner.assign(s, T0, fleet_for(svc, off_duty=morning))
    assert isinstance(plan, TripPlan)
    assert plan.planned_start.astimezone(IST).strftime("%H:%M") == "14:00"
    assert plan.driver_id == "drv_037"  # rating 4.8 beats 4.6 among the afternoon crew


def _worked_trip(svc: LogisticsService, driver_id: str, drive_hours: float, start_ist_hour: float):
    """A finished trip by another vehicle that already used `drive_hours` of the driver's day."""
    other = kota_shipment(svc)
    start = datetime(2026, 9, 26, 0, 0, tzinfo=IST).astimezone(UTC) + timedelta(hours=start_ist_hour)
    end = start + timedelta(hours=drive_hours)
    other.trip = TripPlan(
        vehicle_id="spare",
        driver_id=driver_id,
        planned_start=start,
        segments=[Segment(kind="drive", start=start, end=end, route_key="ddw_kota->kota_phc_4")],
        planned_arrival=end,
        projected_arrival=end,
        distance_km=100,
    )
    other.status = "delivered"
    return other


def test_planner_nine_hour_driving_limit():
    svc, _ = make_service(boot=False)
    s = kota_shipment(svc)
    kota_drivers = [d for d in svc.drivers if d.home_warehouse_id == "ddw_kota"]
    solo = [d for d in kota_drivers if d.id == "drv_034"]
    now = datetime(2026, 9, 26, 4, 0, tzinfo=UTC)  # 09:30 IST, drv_034 is on shift

    _worked_trip(svc, "drv_034", 5.0, 0.5)  # 5 h so far: the trip still fits
    fleet = fleet_for(svc, drivers=solo)
    assert isinstance(planner.assign(s, now, fleet), TripPlan)

    svc.state.shipments.clear()
    s = kota_shipment(svc)
    _worked_trip(svc, "drv_034", 8.9, 0.0)  # 8.9 h so far, the trip pushes past 9 h
    fleet = fleet_for(svc, drivers=solo)
    blocked = planner.assign(s, now, fleet)
    assert isinstance(blocked, planner.BlockedReason)
    assert blocked.reason == "No driver at DDW Kota is free with driving hours left"


def test_planner_blocked_reason_names_when_a_vehicle_frees():
    svc, _ = make_service(boot=False)
    first = kota_shipment(svc, lines=[(ARV, 20)], priority="critical")
    second = kota_shipment(svc, lines=[(ARV, 20)])
    svc.approve_shipment(first, "test", T0)
    assert first.trip is not None
    svc.approve_shipment(second, "test", T0)
    assert second.trip is None
    free_at = (sim.trip_end(first.trip) + planner.RETURN_BUFFER).astimezone(IST).strftime("%H:%M")
    assert second.blocked_reason == f"No refrigerated vehicle free at DDW Kota until {free_at}"


def test_queued_shipment_is_assigned_when_a_vehicle_frees():
    svc, _ = make_service(boot=False)
    first = kota_shipment(svc, lines=[(ARV, 20)], priority="critical")
    second = kota_shipment(svc, lines=[(ARV, 20)])
    svc.approve_shipment(first, "test", T0)
    svc.approve_shipment(second, "test", T0)
    assert second.trip is None and first.origin_id == second.origin_id == "ddw_kota"

    still = svc.run_planner(T0 + timedelta(minutes=10))
    assert still["assigned"] == []
    assert still["still_blocked"][0]["shipment_id"] == second.id

    freed = sim.trip_end(first.trip) + planner.RETURN_BUFFER + timedelta(minutes=1)
    result = svc.run_planner(freed)
    assert result["assigned"] == [second.id]
    assert second.trip is not None and second.blocked_reason is None
    assert second.trip.planned_start >= freed


def test_queue_order_is_priority_then_age():
    svc, _ = make_service(boot=False)
    a = kota_shipment(svc, priority="normal")
    b = kota_shipment(svc, priority="critical")
    c = kota_shipment(svc, priority="high")
    b.created_at = T0 + timedelta(minutes=5)
    assert [s.id for s in planner.queue_order([a, b, c])] == [b.id, c.id, a.id]


def test_planner_run_is_a_noop_without_queue():
    svc, _ = make_service()
    assert svc.planner_run() == {"assigned": [], "still_blocked": []}


# ---------------------------------------------------------------------------- initial scenario


def test_initial_scenario_counts():
    svc, _ = make_service()
    now = svc.now()
    assert now == T0
    ships = list(svc.state.shipments.values())
    st = statuses(svc)
    assert st["in_transit"] + st["delayed"] == 10
    assert st["loading"] == 4
    assert st["approved"] == 3
    assert st["arrived"] == 2

    in_flight = [s for s in ships if svc.derived_status(s, now) in ("in_transit", "delayed")]
    for s in in_flight:
        assert s.kind == "routine" and not s.cold_chain
        assert svc.vehicle_by_id[s.trip.vehicle_id].cold_chain is False
    progress = sorted(round(svc.summary(s)["progress"], 2) for s in in_flight)
    assert progress[0] < 0.2 and progress[-1] > 0.7

    queued = sorted(
        (s for s in ships if svc.derived_status(s, now) == "approved"),
        key=lambda s: s.trip.planned_start,
    )
    offsets = [int((s.trip.planned_start - now).total_seconds() // 60) for s in queued]
    assert offsets == [40, 60, 90]

    arrived = [s for s in ships if svc.derived_status(s, now) == "arrived"]
    repl = [s for s in arrived if s.kind == "replenishment"]
    assert len(repl) == 1 and repl[0].destination_facility_id == "phc_18"

    drafts = [s for s in ships if s.status == "recommended"]
    pending = [r for r in svc.recs.list(status="pending") if r["type"] in ("replenishment", "stock_transfer")]
    assert len(drafts) == len(pending) > 0
    assert {s.source_recommendation_id for s in drafts} == {r["id"] for r in pending}
    assert all(svc.derived_status(s, now) == "recommended" for s in drafts)


def test_initial_scenario_uses_distinct_vehicles_for_live_trips():
    svc, _ = make_service()
    live = [s for s in svc.state.shipments.values() if s.trip and s.status in ("loading", "in_transit", "delayed")]
    vehicles = [s.trip.vehicle_id for s in live]
    assert len(vehicles) == len(set(vehicles))


def test_routine_shipments_never_carry_cold_chain():
    svc, ft = make_service(background=True)
    t = T0
    for _ in range(24):  # 12 simulated hours in 30 minute steps
        t += timedelta(minutes=30)
        go(svc, ft, t)
    routine = [s for s in svc.state.shipments.values() if s.kind == "routine"]
    assert len(routine) > 14  # the 14 scenario loads plus generated traffic
    for s in routine:
        assert not s.cold_chain
        assert not any(x.cold_chain for x in s.lines)
        if s.trip:
            assert svc.vehicle_by_id[s.trip.vehicle_id].cold_chain is False
    assert any(s.kind == "restock" for s in svc.state.shipments.values())
    assert any(s.approved_by == scenario.ROUTINE_ACTOR for s in routine)


def test_background_traffic_can_be_disabled():
    svc, ft = make_service(background=False)
    before = len(svc.state.shipments)
    go(svc, ft, T0 + timedelta(hours=6))
    assert len(svc.state.shipments) == before


def test_ids_follow_the_documented_format():
    svc, _ = make_service()
    assert all(s.id.startswith("SHP-2") and len(s.id) == 10 for s in svc.state.shipments.values())


# ---------------------------------------------------------------------------- persistence


def test_restart_reproduces_derived_statuses_and_the_world_pauses(tmp_path):
    path = tmp_path / "state.json"
    svc1, ft1 = make_service(JsonFileStateStore(path))
    go(svc1, ft1, T0 + timedelta(minutes=95))
    svc1.flush()
    now1 = svc1.now()
    before = {s.id: svc1.summary(s, now1) for s in svc1.state.shipments.values()}
    events1 = {s.id: len(sim.derive_events(s, now1)) for s in svc1.state.shipments.values()}
    recs1 = {r["id"]: r["status"] for r in svc1.recs.list()}
    assert path.exists() and not path.with_name(path.name + ".tmp").exists()

    get_district_repository.cache_clear()  # a fresh process: nothing shared with svc1
    svc2, _ = make_service(JsonFileStateStore(path), time_start=987_654.0)  # real time moved on
    assert svc2.now() == now1  # paused while down
    after = {s.id: svc2.summary(s, svc2.now()) for s in svc2.state.shipments.values()}
    assert after == before
    assert {s.id: len(sim.derive_events(s, svc2.now())) for s in svc2.state.shipments.values()} == events1
    assert {r["id"]: r["status"] for r in svc2.recs.list()} == recs1
    assert svc2.state.scenario == svc1.state.scenario

    ft = svc2.clock.time_fn
    ft.t += 60.0  # one real minute later the world has moved by `scale` minutes
    assert svc2.now() == now1 + timedelta(seconds=60 * 60)


def test_corrupt_state_file_is_backed_up_and_rebuilt(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{not json", encoding="utf-8")
    svc, _ = make_service(JsonFileStateStore(path))
    assert statuses(svc)["loading"] == 4
    assert list(tmp_path.glob("state.json.corrupt-*"))


def test_schema_mismatch_is_rebuilt(tmp_path):
    path = tmp_path / "state.json"
    svc, _ = make_service(JsonFileStateStore(path))
    svc.flush()
    text = path.read_text(encoding="utf-8").replace('"schema_version":1', '"schema_version":99', 1)
    path.write_text(text, encoding="utf-8")
    get_district_repository.cache_clear()
    svc2, _ = make_service(JsonFileStateStore(path))
    assert svc2.state.schema_version == 1
    assert list(tmp_path.glob("state.json.corrupt-*"))


def test_reset_reanchors_the_clock_to_0830_ist():
    svc, ft = make_service()
    go(svc, ft, T0 + timedelta(hours=5))
    assert svc.now() > T0
    result = svc.reset()
    assert result == {"ok": True, "sim_now": iso(today_0830_ist(T0))}
    assert svc.now() == today_0830_ist(T0)
    assert svc.now().astimezone(IST).strftime("%H:%M") == "08:30"
    assert statuses(svc)["loading"] == 4 and statuses(svc)["arrived"] == 2
    assert svc.state.counters["shipment_seq"] == len(svc.state.shipments)


def test_set_time_scale_validates_and_keeps_now():
    svc, ft = make_service()
    ft.t += 10
    before = svc.now()
    info = svc.set_time_scale(120)
    assert info["scale"] == 120 and svc.now() == before
    with pytest.raises(ValueError):
        svc.set_time_scale(0.5)
    with pytest.raises(ValueError):
        svc.set_time_scale(601)
    assert svc.clock_info()["scenario_start"] == iso(T0)


# ---------------------------------------------------------------------------- proof of delivery


def _arrived_phc18(svc: LogisticsService) -> Shipment:
    return next(
        s
        for s in svc.state.shipments.values()
        if s.kind == "replenishment" and svc.derived_status(s) == "arrived"
    )


def _pod_args(s: Shipment, pod_id: str = "pod-1") -> dict:
    return {
        "shipment_id": s.id,
        "pod_id": pod_id,
        "facility_id": s.destination_facility_id,
        "confirmed_by": "Test nurse",
        "received": [{"medicine_name": x.medicine_name, "units": x.units} for x in s.lines],
    }


def test_pod_is_idempotent():
    svc, _ = make_service()
    s = _arrived_phc18(svc)
    first = svc.confirm_pod(**_pod_args(s))
    assert first["already_confirmed"] is False and first["stock_applied_by"] == "backend_overlay"
    assert first["shipment"]["status"] == "delivered"
    assert first["shipment"]["pod"]["confirmed_by"] == "Test nurse"
    overlay = list(svc.state.stock_overlay)
    second = svc.confirm_pod(**_pod_args(s, pod_id="pod-2"))
    assert second["already_confirmed"] is True
    assert second["shipment"]["pod"]["pod_id"] == "pod-1"
    assert svc.state.stock_overlay == overlay


def test_pod_rejects_wrong_facility_and_wrong_state():
    svc, _ = make_service()
    s = _arrived_phc18(svc)
    args = _pod_args(s)
    with pytest.raises(ShipmentStateError):
        svc.confirm_pod(**{**args, "facility_id": "kota_phc_1"})
    loading = next(x for x in svc.state.shipments.values() if svc.derived_status(x) == "loading")
    with pytest.raises(ShipmentStateError):
        svc.confirm_pod(**_pod_args(loading))
    assert svc.state.stock_overlay == []


def test_pod_in_seed_mode_raises_units_and_recomputes_risk():
    svc, _ = make_service()
    s = _arrived_phc18(svc)
    repo = svc.repo
    assert repo.live_source == "seed"
    before = {r["medicine_name"]: r["units_remaining"] for r in repo.medicine_stock_for("phc_18")}
    risk_before = svc.forecast.facility_risk_level("phc_18")
    svc.confirm_pod(**_pod_args(s))
    after = {r["medicine_name"]: r["units_remaining"] for r in repo.medicine_stock_for("phc_18")}
    for line in s.lines:
        assert after[line.medicine_name] == before[line.medicine_name] + line.units
    rank = {"healthy": 0, "monitor": 1, "stress": 2, "critical": 3}
    assert rank[svc.forecast.facility_risk_level("phc_18")] <= rank[risk_before]


def test_pod_can_lower_a_facility_risk_level():
    svc, _ = make_service()
    # Deliver a large load of the worst medicine at the most at-risk facility and watch it drop.
    fid = "kota_phc_4"
    risk_before = svc.forecast.facility_risk_level(fid)
    assert risk_before == "critical"
    rows = svc.repo.medicine_stock_for(fid)
    short = [r for r in rows if r["units_remaining"] / (r["avg_daily_consumption"] or 0.1) < 3]
    assert short
    s = kota_shipment(svc, lines=[(short[0]["medicine_name"], 2000)], dest=fid)
    svc.approve_shipment(s, "test", svc.now())
    arrive_at = sim.trip_end(s.trip)
    ft = svc.clock.time_fn
    ft.t += (arrive_at - svc.now()).total_seconds() / svc.clock.scale + 1
    svc.tick(arrive_at + timedelta(seconds=1))
    svc.confirm_pod(**_pod_args(s))
    assert svc.forecast.facility_risk_level(fid) != "critical"


def test_auto_pod_fires_for_routine_after_240_minutes():
    svc, ft = make_service()
    later = T0 + timedelta(hours=2)  # the district vans are back by then
    go(svc, ft, later)
    s = scenario.make_routine(svc, "district_kota", later, random.Random(3))
    svc.approve_shipment(s, scenario.ROUTINE_ACTOR, later)
    assert s.trip is not None, s.blocked_reason
    end = sim.trip_end(s.trip)
    go(svc, ft, end + timedelta(minutes=239))
    assert svc.derived_status(s) == "arrived" and s.pod is None
    go(svc, ft, end + timedelta(minutes=241))
    assert s.status == "delivered"
    assert s.pod is not None and s.pod.confirmed_by == "system (auto)"
    assert s.pod.confirmed_at == end + timedelta(minutes=240)
    assert {(r["medicine_name"], r["units"]) for r in s.pod.received} == {
        (x.medicine_name, x.units) for x in s.lines
    }
    assert any(e["shipment_id"] == s.id for e in svc.state.stock_overlay)


def test_auto_pod_never_fires_for_replenishment():
    svc, ft = make_service()
    s = _arrived_phc18(svc)
    go(svc, ft, T0 + timedelta(hours=30))
    assert s.pod is None
    assert svc.derived_status(s) == "arrived"
    assert s.status == "arrived"


def test_auto_pod_can_be_disabled():
    svc, ft = make_service(auto_pod=0)
    routine = next(
        s for s in svc.state.shipments.values() if s.kind == "routine" and svc.derived_status(s) == "arrived"
    )
    go(svc, ft, T0 + timedelta(hours=30))
    assert routine.pod is None


def test_auto_pod_restock_adds_warehouse_stock():
    svc, ft = make_service()
    restock = next(s for s in svc.state.shipments.values() if s.kind == "restock")
    line = restock.lines[0]
    base = svc.warehouse_available(restock.destination_facility_id, line.medicine_name)
    end = sim.trip_end(restock.trip)
    go(svc, ft, end + timedelta(minutes=241))
    assert restock.pod is not None
    assert svc.warehouse_available(restock.destination_facility_id, line.medicine_name) == base + line.units
    assert svc.state.stock_overlay == [e for e in svc.state.stock_overlay if e["shipment_id"] != restock.id]


# ---------------------------------------------------------------------------- recommendation wiring


def _pending_replenishment(svc: LogisticsService) -> dict:
    return next(
        r
        for r in svc.recs.list(status="pending")
        if r["type"] == "replenishment" and r["target_facility_id"] != "phc_18" and r["priority"] == "critical"
    )


def test_pending_recommendation_has_a_recommended_draft():
    svc, _ = make_service()
    rec = _pending_replenishment(svc)
    s = svc.state.shipments[rec["shipment_id"]]
    assert s.status == "recommended" and s.approved_at is None and s.trip is None
    assert s.source_recommendation_id == rec["id"]
    assert s.lines[0].medicine_name == rec["medicine_name"] and s.lines[0].units == rec["quantity"]
    assert s.destination_facility_id == rec["target_facility_id"]


def test_approving_converts_the_draft_and_the_lifecycle_follows():
    svc, ft = make_service()
    rec = _pending_replenishment(svc)
    draft_id = rec["shipment_id"]
    n_before = len(svc.state.shipments)
    done = svc.recs.resolve(rec["id"], "approved", actor="DM Kota")
    assert done["status"] == "approved" and done["shipment_id"] == draft_id
    assert len(svc.state.shipments) == n_before  # converted, not duplicated
    s = svc.state.shipments[draft_id]
    assert s.approved_by == "DM Kota" and s.approved_at == T0
    assert s.trip is not None, s.blocked_reason
    assert svc.derived_status(s) == "approved"
    reserved = svc.state.reservations[s.origin_id][s.lines[0].medicine_name]
    assert reserved >= s.lines[0].units

    depart = sim.first_departure(s.trip)
    go(svc, ft, depart + timedelta(minutes=1))
    assert svc.recs.get(rec["id"])["status"] == "dispatched"
    assert svc.state.reservations[s.origin_id][s.lines[0].medicine_name] == reserved - s.lines[0].units

    end = sim.trip_end(s.trip)
    go(svc, ft, end + timedelta(minutes=1))
    assert svc.derived_status(s) == "arrived"
    svc.confirm_pod(**_pod_args(s))
    assert svc.recs.get(rec["id"])["status"] == "fulfilled"
    assert svc.derived_status(s) == "delivered"


def test_modifying_with_a_quantity_updates_the_shipment_lines():
    svc, _ = make_service()
    rec = _pending_replenishment(svc)
    svc.recs.resolve(rec["id"], "modified", quantity_override="50 units", actor="DM")
    s = svc.state.shipments[rec["shipment_id"]]
    assert s.lines[0].units == 50 and s.approved_at is not None


def test_cancelling_a_shipment_cancels_the_recommendation_and_releases_stock():
    svc, _ = make_service()
    rec = _pending_replenishment(svc)
    svc.recs.resolve(rec["id"], "approved", actor="DM")
    s = svc.state.shipments[rec["shipment_id"]]
    med = s.lines[0].medicine_name
    reserved = svc.state.reservations[s.origin_id][med]
    detail = svc.cancel(s.id, "Road closed", actor="DM")
    assert detail["status"] == "cancelled" and detail["blocked_reason"] is None
    assert svc.recs.get(rec["id"])["status"] == "cancelled"
    assert svc.state.reservations[s.origin_id][med] == reserved - s.lines[0].units
    assert s.cancel_reason == "Road closed"
    with pytest.raises(ShipmentStateError):
        svc.cancel(s.id, "again")


def test_rejecting_a_recommendation_cancels_its_draft():
    svc, _ = make_service()
    rec = _pending_replenishment(svc)
    svc.recs.resolve(rec["id"], "rejected", actor="DM", note="Not needed")
    s = svc.state.shipments[rec["shipment_id"]]
    assert s.status == "cancelled" and s.cancel_reason == "Not needed"


def test_cancelling_a_draft_rejects_its_pending_recommendation():
    svc, _ = make_service()
    rec = _pending_replenishment(svc)
    detail = svc.cancel(rec["shipment_id"], "Duplicate", actor="DM")
    assert detail["status"] == "cancelled"
    assert svc.recs.get(rec["id"])["status"] == "rejected"


def test_arrived_and_delivered_shipments_cannot_be_cancelled():
    svc, _ = make_service()
    s = _arrived_phc18(svc)
    with pytest.raises(ShipmentStateError):
        svc.cancel(s.id, "too late")


def test_stock_applied_requires_a_pod():
    svc, _ = make_service()
    s = _arrived_phc18(svc)
    with pytest.raises(ShipmentStateError):
        svc.stock_applied(s.id, "pod-1")
    svc.confirm_pod(**_pod_args(s))
    assert svc.stock_applied(s.id, "pod-1") == {"ok": True}


# ---------------------------------------------------------------------------- queries and views


def test_list_and_detail_are_plain_json_dicts():
    svc, _ = make_service()
    rows = svc.list_shipments(statuses=["in_transit", "delayed"], limit=50)
    assert len(rows) == 10
    row = rows[0]
    assert set(row) >= {"id", "status", "origin", "destination", "eta", "progress", "vehicle", "driver"}
    assert row["eta"].endswith("Z") and "T" in row["eta"]

    detail = svc.get_shipment(row["id"])
    assert detail["position"]["shipment_id"] == row["id"]
    assert 2 <= len(detail["path"]) <= 400
    assert detail["events"] and detail["events"][0]["at"].endswith("Z")
    assert 0 <= detail["travelled_index"] < len(detail["path"])


def test_shipment_detail_for_a_queued_shipment_explains_nothing_wrong():
    svc, _ = make_service()
    queued = next(s for s in svc.state.shipments.values() if svc.derived_status(s) == "approved")
    d = svc.get_shipment(queued.id)
    assert d["status"] == "approved" and d["planned_start"] is not None and d["position"]["speed_kmh"] == 0


def test_facility_inbound_and_latest_active():
    svc, _ = make_service()
    items = svc.facility_inbound("phc_18")
    assert items and items[0]["status"] == "arrived"
    assert items[0]["lines"][0]["unit"] and "base_daily_consumption" in items[0]["lines"][0]
    latest = svc.latest_active_for_facility("phc_18")
    assert latest is not None and latest["destination"]["id"] == "phc_18"
    assert latest["status"] in ("approved", "loading", "in_transit", "delayed", "arrived")
    assert svc.latest_active_for_facility("no_such_facility") is None


def test_query_filters_sort_and_paging():
    svc, _ = make_service()
    page = svc.query_shipments(kind="routine", sort="created_at", limit=3)
    assert len(page["items"]) == 3 and page["total"] >= 14
    by_district = svc.query_shipments(district_id="district_kota")
    assert all(i["district_id"] == "district_kota" for i in by_district["items"])
    hit = svc.query_shipments(q=page["items"][0]["id"].lower())
    assert hit["total"] == 1
    assert svc.query_shipments(priority="critical", statuses=["loading"])["total"] == 0


def test_fleet_positions_and_schedule_are_consistent():
    svc, _ = make_service()
    pos = svc.positions()
    assert len(pos["items"]) == 14  # 10 in flight and 4 loading
    status = svc.fleet_status()
    fleet = {"vehicles_total": sum(status["vehicles_by_status"].values()), "counts": status["vehicles_by_status"]}
    assert status["drivers_on_shift"] > 0 and len(status["queued"]) == 0
    assert fleet["vehicles_total"] == 31
    assert fleet["counts"]["maintenance"] == 2
    assert fleet["counts"].get("loading") == 4
    assert fleet["counts"].get("scheduled") == 3
    drivers = svc.drivers_list()["items"]
    assert len(drivers) == 40
    sched = svc.schedule(district_id="district_kota")
    assert sched["window"]["start"] < sched["window"]["end"]
    assert len(sched["rows"]) == 5
    assert master.ddw_for_district("district_kota") == "ddw_kota"


def test_events_are_emitted_once_on_tick():
    svc, ft = make_service()
    first = go(svc, ft, T0 + timedelta(minutes=60))
    assert first["events"]
    seen = {(e["event"]["shipment_id"], e["event"]["type"], e["event"]["at"]) for e in first["events"]}
    assert len(seen) == len(first["events"])
    again = svc.tick(T0 + timedelta(minutes=60))
    assert again["events"] == []


# ---------------------------------------------------------------------------- deps


def test_deps_boots_lazily_and_uses_the_settings_state_path():
    from app.api import deps
    from app.core.config import get_settings

    svc = deps.get_logistics_service()
    assert svc.booted and svc is deps.get_logistics_service()
    assert deps.get_recommendation_service() is svc.recs
    assert get_settings().logistics_tick is False
    assert svc.state.scenario["start"]
    svc.flush()
    assert get_settings().logistics_state_path.exists()
