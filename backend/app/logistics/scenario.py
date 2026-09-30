"""Initial scenario and background traffic (section 5.11).

The functions take the `LogisticsService` and mutate its state. They are kept
out of `service.py` so the scenario can be read (and tuned) on its own.
"""

import hashlib
import math
import random
from datetime import datetime, timedelta
from typing import Any

from app.logistics import master, planner, sim
from app.logistics.catalog import medicines
from app.logistics.models import Driver, Shipment, Stop, Vehicle

ROUTINE_ACTOR = "system: routine schedule"
SLOT_MINUTES = 30
ROUTINE_PROBABILITY = 0.35
MAX_UNASSIGNED_ROUTINE = 6  # per district; beyond this no new routine load is generated
RESTOCK_HOURS = 6
ROUTINE_COVER_DAYS = 14
RESTOCK_DAYS = 10
CATCH_UP_SLOTS = 48
IN_FLIGHT_PROGRESS = [0.10 + i * (0.75 / 9) for i in range(10)]  # 10% ... 85%
LOADING_COUNT = 4
SCHEDULED_OFFSETS_MIN = (40, 60, 90)
PHC_WITH_CRM_LOGIN = "phc_18"


def _slot_rng(district_id: str, slot: int) -> random.Random:
    digest = hashlib.sha1(f"{district_id}|{slot}".encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


def _noncold() -> list[str]:
    return sorted(name for name, m in medicines().items() if not m["cold_chain"])


# --------------------------------------------------------------------------- shipment makers


def make_routine(svc, district_id: str, created_at: datetime, rng: random.Random) -> Shipment | None:
    """A routine, non-cold-chain top-up from the district warehouse (never uses a reefer)."""
    facilities = sorted(svc.repo.facilities_in(district_id), key=lambda f: f["id"])
    if not facilities:
        return None
    noncold = set(_noncold())

    def low_rows(fid: str) -> list[tuple[float, str, float]]:
        out = []
        for row in svc.repo.medicine_stock_for(fid):
            if row["medicine_name"] not in noncold:
                continue
            c = float(row.get("avg_daily_consumption") or 0) or 0.1
            cover = row["units_remaining"] / c
            if cover < ROUTINE_COVER_DAYS:
                out.append((cover, row["medicine_name"], c))
        return sorted(out)

    needy = [f for f in facilities if low_rows(f["id"])]
    dest = rng.choice(needy or facilities)
    picks = low_rows(dest["id"])[:2]
    if not picks:
        rows = [
            r for r in svc.repo.medicine_stock_for(dest["id"]) if r["medicine_name"] in noncold
        ]
        rng.shuffle(rows)
        picks = [
            (0.0, r["medicine_name"], float(r.get("avg_daily_consumption") or 0) or 0.1)
            for r in rows[: rng.choice([1, 2])]
        ]
    if not picks:
        name = rng.choice(sorted(noncold))
        picks = [(0.0, name, float(medicines()[name]["base_daily_consumption"]))]
    lines = [(med, max(10, math.ceil(ROUTINE_COVER_DAYS * c))) for _, med, c in picks]
    return svc.build_shipment(
        kind="routine",
        district_id=district_id,
        origin_id=master.ddw_for_district(district_id),
        stops=[Stop(node_id=dest["id"], node_kind="facility", purpose="dropoff")],
        lines=lines,
        priority="normal",
        created_at=created_at,
    )


def make_restock(
    svc, district_id: str, created_at: datetime, allow_cold: bool = True
) -> Shipment | None:
    """A central-to-DDW restock of the two medicines with the least district cover."""
    ddw = master.ddw_for_district(district_id)
    cat = medicines()
    consumption: dict[str, float] = {}
    for f in svc.repo.facilities_in(district_id):
        for row in svc.repo.medicine_stock_for(f["id"]):
            consumption[row["medicine_name"]] = consumption.get(row["medicine_name"], 0.0) + float(
                row.get("avg_daily_consumption") or 0
            )
    ranked = sorted(
        (svc.warehouse_available(ddw, med) / c, med, c)
        for med, c in consumption.items()
        if c > 0 and med in cat and (allow_cold or not cat[med]["cold_chain"])
    )
    if not ranked:
        return None
    lines = [(med, max(50, math.ceil(RESTOCK_DAYS * c))) for _, med, c in ranked[:2]]
    return svc.build_shipment(
        kind="restock",
        district_id=district_id,
        origin_id=master.CENTRAL_ID,
        stops=[Stop(node_id=ddw, node_kind="warehouse", purpose="dropoff")],
        lines=lines,
        priority="normal",
        created_at=created_at,
    )


# --------------------------------------------------------------------------- background traffic


def _restock_active(svc, ddw: str) -> bool:
    return any(
        s.kind == "restock" and s.destination_facility_id == ddw for s in svc.active_shipments()
    )


def _unassigned_routine(svc) -> dict[str, int]:
    """Routine shipments approved but still without a trip, per district."""
    counts: dict[str, int] = {}
    for s in svc.active_shipments():
        if s.kind == "routine" and s.trip is None and s.approved_at is not None:
            counts[s.district_id] = counts.get(s.district_id, 0) + 1
    return counts


def background_step(svc, now: datetime) -> list[Shipment]:
    """Routine and restock shipments for every slot that has elapsed since the last tick."""
    start = svc.scenario_start()
    if now <= start:
        return []
    elapsed = now - start
    slot = int(elapsed // timedelta(minutes=SLOT_MINUTES))
    slot6 = int(elapsed // timedelta(hours=RESTOCK_HOURS))
    bg = svc.state.background
    created: list[Shipment] = []
    districts = [d["id"] for d in svc.repo.districts]
    backlog = _unassigned_routine(svc)

    for sl in range(max(bg.get("routine_slot", 0) + 1, slot - CATCH_UP_SLOTS + 1), slot + 1):
        slot_time = start + timedelta(minutes=SLOT_MINUTES * sl)
        for district_id in districts:
            rng = _slot_rng(district_id, sl)
            if rng.random() >= ROUTINE_PROBABILITY:
                continue
            if backlog.get(district_id, 0) >= MAX_UNASSIGNED_ROUTINE:
                continue  # the queue is bounded: no capacity means no new routine load
            s = make_routine(svc, district_id, slot_time, rng)
            if s is not None:
                svc.approve_shipment(s, ROUTINE_ACTOR, now)
                created.append(s)
                if s.trip is None:
                    backlog[district_id] = backlog.get(district_id, 0) + 1
    bg["routine_slot"] = max(bg.get("routine_slot", 0), slot)

    for sl in range(max(bg.get("restock_slot", 0) + 1, slot6 - 3), slot6 + 1):
        slot_time = start + timedelta(hours=RESTOCK_HOURS * sl)
        for district_id in districts:
            if _restock_active(svc, master.ddw_for_district(district_id)):
                continue
            s = make_restock(svc, district_id, slot_time)
            if s is not None:
                svc.approve_shipment(s, ROUTINE_ACTOR, now)
                created.append(s)
    bg["restock_slot"] = max(bg.get("restock_slot", 0), slot6)
    return created


# --------------------------------------------------------------------------- initial scenario


class _Allocator:
    """Hands out distinct vehicles and drivers while the initial trips are laid out."""

    def __init__(self, svc):
        self.svc = svc
        self.used_vehicles: set[str] = set()
        self.used_drivers: set[str] = set()

    def _vehicles(self, origin: str, s: Shipment) -> list[Vehicle]:
        return sorted(
            (
                v
                for v in self.svc.vehicles
                if v.home_warehouse_id == origin
                and v.status != "maintenance"
                and v.capacity_kg >= s.weight_kg
                and v.pallet_slots >= s.pallet_slots
                and v.cold_chain == s.cold_chain
            ),
            key=lambda v: (v.capacity_kg, v.id),
        )

    def _drivers(self, origin: str, at: datetime) -> list[Driver]:
        return sorted(
            (
                d
                for d in self.svc.drivers
                if d.home_warehouse_id == origin and planner.in_shift(d, at)
            ),
            key=lambda d: (-d.rating, d.id),
        )

    def has_capacity(self, origin: str, at: datetime) -> bool:
        vehicles = [
            v
            for v in self.svc.vehicles
            if v.home_warehouse_id == origin
            and v.status != "maintenance"
            and not v.cold_chain
            and v.id not in self.used_vehicles
        ]
        drivers = [d for d in self._drivers(origin, at) if d.id not in self.used_drivers]
        return bool(vehicles and drivers)

    def take(
        self, origin: str, s: Shipment, at: datetime, reuse: bool = False
    ) -> tuple[Vehicle, Driver] | None:
        vehicles = self._vehicles(origin, s)
        drivers = self._drivers(origin, at) or [
            d for d in self.svc.drivers if d.home_warehouse_id == origin
        ]
        v = next((x for x in vehicles if x.id not in self.used_vehicles), None)
        d = next((x for x in drivers if x.id not in self.used_drivers), None)
        if reuse:
            v = v or (vehicles[0] if vehicles else None)
            d = d or (drivers[0] if drivers else None)
        if v is None or d is None:
            return None
        self.used_vehicles.add(v.id)
        self.used_drivers.add(d.id)
        return v, d


def _trip(svc, s: Shipment, v: Vehicle, d: Driver, start: datetime, assigned_at: datetime):
    return sim.build_trip(s, v, d, start, svc.routes, assigned_at=assigned_at)


def _place_in_flight(svc, s: Shipment, v: Vehicle, d: Driver, now: datetime, progress: float):
    """Back-date the trip so that at `now` the vehicle has covered `progress` of its drive time."""
    trial = _trip(svc, s, v, d, now, now)
    load = (trial.segments[0].end - trial.segments[0].start).total_seconds()
    drive = sum((g.end - g.start).total_seconds() for g in trial.segments if g.kind == "drive")
    start = now - timedelta(seconds=load + progress * drive)
    trip = _trip(svc, s, v, d, start, start)
    s.trip = trip
    if sim.derive_status(s, now) not in ("in_transit", "delayed"):  # traffic factor moved it
        drive = sum((g.end - g.start).total_seconds() for g in trip.segments if g.kind == "drive")
        start = now - timedelta(seconds=load + progress * drive)
        s.trip = _trip(svc, s, v, d, start, start)


def _place_loading(svc, s: Shipment, v: Vehicle, d: Driver, now: datetime):
    trial = _trip(svc, s, v, d, now, now)
    load = (trial.segments[0].end - trial.segments[0].start).total_seconds()
    start = now - timedelta(seconds=0.4 * load)
    s.trip = _trip(svc, s, v, d, start, start)


def _place_arrived(svc, s: Shipment, v: Vehicle, d: Driver, now: datetime, minutes_ago: int):
    """Back-date the trip so that it ended `minutes_ago` minutes before `now`."""
    trial = _trip(svc, s, v, d, now, now)
    end = sim.trip_end(trial)
    start = now - timedelta(minutes=minutes_ago) - (end - now)
    s.trip = _trip(svc, s, v, d, start, start)
    if sim.derive_status(s, now) != "arrived":
        gap = sim.trip_end(s.trip) - (now - timedelta(minutes=minutes_ago))
        s.trip = _trip(svc, s, v, d, start - gap, start - gap)


def _stamp(s: Shipment, when: datetime):
    """Creation and approval times consistent with a trip that starts at `when`."""
    s.created_at = when - timedelta(minutes=25)


def build_initial_scenario(svc, start: datetime, seed: int) -> None:
    """10 in flight, 4 loading, 3 queued restocks, 2 arrived awaiting POD (5.11)."""
    rng = random.Random(seed)
    alloc = _Allocator(svc)
    districts = [d["id"] for d in svc.repo.districts]
    bg = svc.state.background
    bg["routine_slot"] = 0
    bg["restock_slot"] = 0

    plan: list[Any] = [("flight", p) for p in IN_FLIGHT_PROGRESS] + [("loading", 0.0)] * LOADING_COUNT
    cursor = 0
    for kind, progress in plan:
        s = v = d = None
        for step in range(len(districts)):
            district_id = districts[(cursor + step) % len(districts)]
            ddw = master.ddw_for_district(district_id)
            if not alloc.has_capacity(ddw, start):
                continue
            s = make_routine(svc, district_id, start, rng)
            cursor = (cursor + step + 1) % len(districts)
            break
        if s is None:
            raise RuntimeError("initial scenario ran out of vehicles or drivers")
        s.origin_id = planner.choose_origin(s, svc.fleet_state())
        pair = alloc.take(s.origin_id, s, start)
        assert pair is not None
        v, d = pair
        if kind == "flight":
            _place_in_flight(svc, s, v, d, start, progress)
        else:
            _place_loading(svc, s, v, d, start)
        _stamp(s, s.trip.planned_start)  # type: ignore[union-attr]
        svc.approve_shipment(s, ROUTINE_ACTOR, s.created_at + timedelta(minutes=2), plan=False)
        s.trip.assigned_at = s.approved_at  # type: ignore[union-attr]

    for i, offset in enumerate(SCHEDULED_OFFSETS_MIN):
        district_id = districts[i % len(districts)]
        s = make_restock(svc, district_id, start - timedelta(minutes=10), allow_cold=False)
        if s is None:
            continue
        trip_start = start + timedelta(minutes=offset)
        pair = alloc.take(master.CENTRAL_ID, s, trip_start)
        if pair is None:
            raise RuntimeError("no central vehicle for the scheduled restock")
        svc.approve_shipment(s, ROUTINE_ACTOR, start - timedelta(minutes=5), plan=False)
        s.trip = _trip(svc, s, pair[0], pair[1], trip_start, s.approved_at)

    _arrived_replenishment(svc, alloc, start)
    _arrived_routine(svc, alloc, start, rng, districts)


def _arrived_replenishment(svc, alloc: _Allocator, start: datetime) -> None:
    """One `arrived` replenishment to the PHC that has a CRM login, linked to its recommendation."""
    recs = [
        r
        for r in svc.recs.list(status="pending")
        if r["type"] == "replenishment" and r["target_facility_id"] == PHC_WITH_CRM_LOGIN
    ]
    rank = {"critical": 0, "high": 1, "normal": 2}
    recs.sort(key=lambda r: (rank[r["priority"]], -r["confidence"], r["id"]))

    def place(s: Shipment) -> None:
        pair = alloc.take(s.origin_id, s, start, reuse=True)
        assert pair is not None
        _place_arrived(svc, s, pair[0], pair[1], start, minutes_ago=20)
        s.created_at = s.trip.planned_start - timedelta(hours=1)  # type: ignore[union-attr]
        s.approved_at = s.created_at + timedelta(minutes=5)
        s.trip.assigned_at = s.approved_at  # type: ignore[union-attr]

    if recs:
        rec = recs[0]
        svc._overrides[rec["id"]] = place
        svc.recs.resolve(rec["id"], "approved", actor="District officer")
        return
    s = svc.build_shipment(
        kind="replenishment",
        district_id=svc.repo.district_id_for_facility(PHC_WITH_CRM_LOGIN),
        origin_id=master.ddw_for_district(svc.repo.district_id_for_facility(PHC_WITH_CRM_LOGIN)),
        stops=[Stop(node_id=PHC_WITH_CRM_LOGIN, node_kind="facility", purpose="dropoff")],
        lines=[("Paracetamol", 300), ("ORS", 300)],
        priority="high",
        created_at=start,
    )
    svc.approve_shipment(s, "District officer", start, plan=False)
    place(s)


def _arrived_routine(svc, alloc: _Allocator, start: datetime, rng, districts: list[str]) -> None:
    district_id = next((d for d in districts if d != "district_jaipur_rural"), districts[0])
    s = make_routine(svc, district_id, start, rng)
    if s is None:
        return
    s.origin_id = planner.choose_origin(s, svc.fleet_state())
    pair = alloc.take(s.origin_id, s, start, reuse=True)
    assert pair is not None
    _place_arrived(svc, s, pair[0], pair[1], start, minutes_ago=45)
    s.created_at = s.trip.planned_start - timedelta(minutes=25)  # type: ignore[union-attr]
    svc.approve_shipment(s, ROUTINE_ACTOR, s.created_at + timedelta(minutes=2), plan=False)
    s.trip.assigned_at = s.approved_at  # type: ignore[union-attr]
