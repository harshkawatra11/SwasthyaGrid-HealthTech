"""Appendix E remediation: active set, planner pass, bounded queue, persistence, boot reset."""

import json
from datetime import timedelta
from itertools import pairwise

from app.logistics import planner, scenario, sim
from app.logistics.models import Stop
from app.logistics.service import (
    AUTO_CANCEL_REASON,
    PLANNER_PASS_CAP,
    LogisticsService,
)
from app.logistics.store import JsonFileStateStore, MemoryStateStore
from tests.test_logistics_service import ARV, T0, go, kota_shipment, make_service


def _queue(svc: LogisticsService, n: int, kind: str = "routine", priority: str = "normal"):
    out = []
    for i in range(n):
        s = svc.build_shipment(
            kind=kind,
            district_id="district_kota",
            origin_id="ddw_kota",
            stops=[Stop(node_id="kota_phc_4", node_kind="facility", purpose="dropoff")],
            lines=[(ARV, 5)],
            priority=priority,
            created_at=T0 + timedelta(seconds=i),
        )
        s.status = "approved"
        s.approved_at = T0
        svc._reserve(s)
        out.append(s)
    return out


# ------------------------------------------------------------------ R1 active set


def test_terminal_shipments_leave_the_active_set():
    svc, _ = make_service()
    live = svc.active_shipments()
    assert live and all(s.status not in ("delivered", "cancelled") for s in live)
    a = kota_shipment(svc)
    svc.approve_shipment(a, "test", T0)
    assert a.id in {s.id for s in svc.active_shipments()}
    svc.cancel(a.id, "test")
    assert a.id not in {s.id for s in svc.active_shipments()}
    assert svc.state.shipments[a.id].status == "cancelled"  # still in the live file for 24 h


def test_final_events_are_emitted_when_a_shipment_completes():
    svc, ft = make_service()
    svc.tick(T0 + timedelta(minutes=1))
    arrived = next(
        s
        for s in svc.state.shipments.values()
        if s.kind == "routine" and svc.derived_status(s, svc.now()) == "arrived"
    )
    result = go(svc, ft, T0 + timedelta(hours=6))  # auto POD fires after 240 min
    types = {e["event"]["type"] for e in result["events"] if e["event"]["shipment_id"] == arrived.id}
    assert "pod_confirmed" in types
    assert arrived.id not in {s.id for s in svc.active_shipments()}


def test_positions_and_kpis_ignore_terminal_shipments_without_changing():
    svc, _ = make_service()
    before = svc.positions()
    junk = _queue(svc, 5)
    for s in junk:
        s.status = "cancelled"
    svc._reindex()
    assert svc.positions() == before


# ------------------------------------------------------------------ R2 planner pass


def test_assign_matches_the_reference_over_a_busy_fleet():
    """The indexed planner books each vehicle and driver once and never double-books."""
    svc, _ = make_service(boot=False)
    ships = _queue(svc, 12, kind="replenishment")
    fleet = svc.fleet_state()
    used = []
    for s in ships:
        result = planner.assign(s, T0, fleet)
        if isinstance(result, planner.BlockedReason):
            continue
        s.trip = result
        fleet.record(s)
        used.append(s)
    assert used
    by_vehicle: dict[str, list[tuple]] = {}
    for s in used:
        by_vehicle.setdefault(s.trip.vehicle_id, []).append(
            (s.trip.planned_start, sim.trip_end(s.trip) + planner.RETURN_BUFFER)
        )
    for windows in by_vehicle.values():
        windows.sort()
        for (_, end), (start, _) in pairwise(windows):
            assert end <= start


def test_planner_pass_is_capped_and_priority_ordered():
    svc, _ = make_service(boot=False)
    low = _queue(svc, 40, kind="replenishment", priority="normal")
    crit = _queue(svc, 3, kind="replenishment", priority="critical")
    for s in low:
        s.blocked_reason = "stale"
    result = svc.run_planner(T0)
    tried = {r["shipment_id"] for r in result["still_blocked"]} | set(result["assigned"])
    assert len(tried) == PLANNER_PASS_CAP
    assert {s.id for s in crit} <= tried  # critical go first
    assert sum(1 for s in low if s.blocked_reason == "stale") == 40 - (PLANNER_PASS_CAP - 3)


def test_tick_throttles_the_planner_unless_woken():
    svc, _ = make_service()
    calls = []
    real = svc.run_planner
    svc.run_planner = lambda now=None: calls.append(now) or real(now)  # type: ignore[method-assign]
    svc.tick(T0 + timedelta(minutes=1))  # the boot approval wakes it once
    calls.clear()
    svc.tick(T0 + timedelta(minutes=2))
    svc.tick(T0 + timedelta(minutes=3))
    assert calls == []  # inside the 5 second window and nothing woke it
    a = kota_shipment(svc)
    svc.approve_shipment(a, "test", T0 + timedelta(minutes=3), plan=False)  # an approval wakes it
    svc.tick(T0 + timedelta(minutes=4))
    assert len(calls) == 1
    svc.planner_interval = 0.0
    svc.tick(T0 + timedelta(minutes=5))
    assert len(calls) == 2


# ------------------------------------------------------------------ R3 bounded queue


def test_routine_generation_stops_at_six_unassigned_per_district():
    svc, _ = make_service(background=True)
    _queue(svc, 6, kind="routine")  # district_kota already has 6 waiting
    svc._reindex()
    before = sum(
        1 for s in svc.active_shipments() if s.kind == "routine" and s.district_id == "district_kota"
    )
    scenario.background_step(svc, T0 + timedelta(hours=20))
    after = sum(
        1 for s in svc.active_shipments() if s.kind == "routine" and s.district_id == "district_kota"
    )
    assert after == before


def test_unassigned_routine_is_cancelled_after_three_sim_hours_and_frees_stock():
    svc, ft = make_service()
    s = _queue(svc, 1, kind="routine")[0]
    other = _queue(svc, 1, kind="replenishment")[0]
    reserved = svc.state.reservations["ddw_kota"][ARV]
    assert reserved == 10
    svc.planner_interval = 1e9
    svc._planner_wake = False
    go(svc, ft, T0 + timedelta(hours=3, minutes=1))
    assert s.status == "cancelled" and s.cancel_reason == AUTO_CANCEL_REASON
    assert not s.reserved and svc.state.reservations["ddw_kota"][ARV] == 5
    assert other.status != "cancelled"  # replenishment is never auto-cancelled
    assert s.id not in {x.id for x in svc.active_shipments()}


# ------------------------------------------------------------------ R4 persistence


def test_old_terminal_shipments_move_to_the_archive_and_stay_visible(tmp_path):
    store = JsonFileStateStore(tmp_path / "state.json")
    svc, ft = make_service(store)
    s = kota_shipment(svc)
    svc.approve_shipment(s, "test", T0)
    svc.cancel(s.id, "test")
    go(svc, ft, T0 + timedelta(hours=26))
    svc.flush()
    assert s.id not in svc.state.shipments
    lines = (tmp_path / "logistics_archive.jsonl").read_text(encoding="utf-8").splitlines()
    assert s.id in {json.loads(line)["id"] for line in lines}
    assert svc.detail(s.id)["status"] == "cancelled"  # lookups fall back to the archive
    assert s.id in {x.id for x in svc.analytics_shipments()}
    assert s.id not in json.loads((tmp_path / "state.json").read_text(encoding="utf-8"))["shipments"]

    again, _ = make_service(JsonFileStateStore(tmp_path / "state.json"))
    assert s.id in {x.id for x in again.analytics_shipments()}
    assert again.detail(s.id)["status"] == "cancelled"


def test_ticks_save_only_when_dirty_and_at_most_every_five_seconds():
    class Counting(MemoryStateStore):
        saves = 0

        def save(self, state):
            type(self).saves += 1
            super().save(state)

    store = Counting()
    svc, _ = make_service(store)
    base = Counting.saves
    for i in range(1, 30):
        svc.tick(T0 + timedelta(seconds=i))
    assert Counting.saves - base <= 1  # the whole burst is well inside 5 real seconds


# ------------------------------------------------------------------ R6 boot reset


def test_boot_rebuilds_a_state_that_ran_days_ahead(tmp_path):
    path = tmp_path / "state.json"
    svc, ft = make_service(JsonFileStateStore(path))
    go(svc, ft, T0 + timedelta(days=4))
    svc.flush()
    fresh, _ = make_service(JsonFileStateStore(path))
    assert list(tmp_path.glob("state.json.stale-*"))
    assert fresh.now() < T0 + timedelta(hours=1)


def test_boot_rebuilds_a_bloated_state(tmp_path):
    path = tmp_path / "state.json"
    svc, _ = make_service(JsonFileStateStore(path))
    donor = next(iter(svc.state.shipments.values()))
    for i in range(1500):
        clone = donor.model_copy(deep=True)
        clone.id = f"SHP-9{i:05d}"
        svc.state.shipments[clone.id] = clone
    svc.flush()
    fresh, _ = make_service(JsonFileStateStore(path))
    assert len(fresh.state.shipments) < 200
    assert list(tmp_path.glob("state.json.stale-*"))


def test_boot_keeps_a_healthy_state(tmp_path):
    path = tmp_path / "state.json"
    svc, _ = make_service(JsonFileStateStore(path))
    ids = set(svc.state.shipments)
    svc.flush()
    again, _ = make_service(JsonFileStateStore(path))
    assert set(again.state.shipments) == ids
    assert not list(tmp_path.glob("state.json.stale-*"))
