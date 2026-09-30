"""Vehicle and driver assignment (section 5.10).

`assign` is a pure function of the shipment, the time and a `FleetState`
snapshot: it never mutates anything. The service applies the result.
"""

import random
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.logistics import master, roads, sim
from app.logistics.clock import IST, ist_day_start
from app.logistics.models import Driver, Shipment, TripPlan, Vehicle

START_DELAY = timedelta(minutes=5)
RETURN_BUFFER = timedelta(minutes=30)
MAX_DRIVE_HOURS = 9.0
PRIORITY_RANK = {"critical": 0, "high": 1, "normal": 2}


@dataclass
class BlockedReason:
    reason: str
    driver_wait: bool = False  # a later start (shift begins, driver frees up) can fix this


@dataclass
class FleetState:
    vehicles: list[Vehicle]
    drivers: list[Driver]
    shipments: Iterable[Shipment]
    routes: roads.Routes
    warehouse_available: Callable[[str, str], int]
    warehouse_names: dict[str, str] = field(default_factory=dict)
    maintenance: set[str] = field(default_factory=set)  # vehicle ids out of service
    off_duty: set[str] = field(default_factory=set)  # driver ids unavailable
    index: "FleetIndex | None" = None

    def get_index(self, now: datetime | None = None) -> "FleetIndex":
        """Per-vehicle and per-driver trips, built once per planner pass (Appendix E R2)."""
        if self.index is None:
            self.index = FleetIndex(self.shipments, now)
        return self.index

    def record(self, shipment: Shipment) -> None:
        """Add a freshly assigned trip so the rest of the pass sees it as busy time."""
        if self.index is not None and _has_trip(shipment):
            self.index.add(shipment)


@dataclass
class Booked:
    """One trip on a vehicle or driver timeline: `[start, end)` includes the return buffer."""

    shipment: Shipment
    start: datetime
    end: datetime


class FleetIndex:
    """Trips grouped by vehicle and by driver, so `assign` never scans every shipment."""

    def __init__(self, shipments: Iterable[Shipment], now: datetime | None = None):
        self.by_vehicle: dict[str, list[Booked]] = {}
        self.by_driver: dict[str, list[Booked]] = {}
        day = ist_day_start(now) if now is not None else None
        for s in shipments:
            if not _has_trip(s):
                continue
            if day is not None and s.status == "delivered":
                # a finished trip from before today can neither overlap a new one nor count
                # towards today's km and driving hours
                trip = s.trip
                assert trip is not None
                if trip.planned_start < day and sim.trip_end(trip) + RETURN_BUFFER < now:  # type: ignore[operator]
                    continue
            self.add(s)

    def add(self, s: Shipment) -> None:
        assert s.trip is not None
        start, end = _window(s)
        booked = Booked(s, start, end)
        self.by_vehicle.setdefault(s.trip.vehicle_id, []).append(booked)
        self.by_driver.setdefault(s.trip.driver_id, []).append(booked)

    def vehicle(self, vehicle_id: str, exclude: str) -> list[Booked]:
        return [b for b in self.by_vehicle.get(vehicle_id, ()) if b.shipment.id != exclude]

    def driver(self, driver_id: str, exclude: str) -> list[Booked]:
        return [b for b in self.by_driver.get(driver_id, ()) if b.shipment.id != exclude]


def short_name(warehouse_id: str, names: dict[str, str]) -> str:
    """`ddw_kota` -> `DDW Kota`, central -> `Central Warehouse`."""
    if warehouse_id == master.CENTRAL_ID:
        return "Central Warehouse"
    full = names.get(warehouse_id, warehouse_id)
    if full.startswith("District Drug Warehouse, "):
        return "DDW " + full.removeprefix("District Drug Warehouse, ")
    return full


def shift_bounds(shift: str) -> tuple[int, int]:
    """`06:00-14:00` -> (360, 840) minutes after local midnight."""
    start, end = shift.split("-")
    sh, sm = start.split(":")
    eh, em = end.split(":")
    return int(sh) * 60 + int(sm), int(eh) * 60 + int(em)


def in_shift(driver: Driver, t: datetime) -> bool:
    start, end = shift_bounds(driver.shift)
    local = t.astimezone(IST)
    minute = local.hour * 60 + local.minute
    if start < end:
        return start <= minute < end
    return minute >= start or minute < end  # crosses midnight


def _has_trip(s: Shipment) -> bool:
    return s.trip is not None and s.status != "cancelled"


def _window(s: Shipment) -> tuple[datetime, datetime]:
    trip = s.trip
    assert trip is not None
    return trip.planned_start, sim.trip_end(trip) + RETURN_BUFFER


def _overlaps(a: tuple[datetime, datetime], b: tuple[datetime, datetime]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def choose_origin(shipment: Shipment, fleet: FleetState) -> str:
    """Origin warehouse for a shipment (5.10 step 1)."""
    if shipment.kind == "restock":
        return master.CENTRAL_ID
    ddw = master.ddw_for_district(shipment.district_id)
    if shipment.kind == "lateral_transfer":
        return ddw
    for line in shipment.lines:
        if fleet.warehouse_available(ddw, line.medicine_name) < line.units:
            return master.CENTRAL_ID
    return ddw


def km_today(vehicle_id: str, shipments: Iterable[Shipment], now: datetime) -> float:
    day = ist_day_start(now)
    return sum(
        s.trip.distance_km
        for s in shipments
        if _has_trip(s) and s.trip and s.trip.vehicle_id == vehicle_id
        and ist_day_start(s.trip.planned_start) == day
    )


def drive_hours_today(driver_id: str, shipments: Iterable[Shipment], now: datetime) -> float:
    day = ist_day_start(now)
    return sum(
        sim.trip_drive_hours(s.trip)
        for s in shipments
        if _has_trip(s) and s.trip and s.trip.driver_id == driver_id
        and ist_day_start(s.trip.planned_start) == day
    )


def _km_today_booked(booked: Iterable[Booked], now: datetime) -> float:
    day = ist_day_start(now)
    return sum(
        b.shipment.trip.distance_km  # type: ignore[union-attr]
        for b in booked
        if ist_day_start(b.shipment.trip.planned_start) == day  # type: ignore[union-attr]
    )


def _drive_hours_booked(booked: Iterable[Booked], now: datetime) -> float:
    day = ist_day_start(now)
    return sum(
        sim.trip_drive_hours(b.shipment.trip)  # type: ignore[arg-type]
        for b in booked
        if ist_day_start(b.shipment.trip.planned_start) == day  # type: ignore[union-attr]
    )


def assign(shipment: Shipment, now: datetime, fleet: FleetState) -> TripPlan | BlockedReason:
    """Pick a vehicle and a driver and build the trip, or explain why not (5.10)."""
    origin = shipment.origin_id
    wh = short_name(origin, fleet.warehouse_names)
    cold = shipment.cold_chain
    kind_word = "refrigerated vehicle" if cold else "vehicle"
    index = fleet.get_index(now)

    pool = [v for v in fleet.vehicles if v.home_warehouse_id == origin]
    working = [v for v in pool if v.status != "maintenance" and v.id not in fleet.maintenance]
    if not working:
        return BlockedReason(f"No vehicle available at {wh}: every vehicle is in maintenance")
    fits = [
        v
        for v in working
        if v.capacity_kg >= shipment.weight_kg
        and v.pallet_slots >= shipment.pallet_slots
        and v.cold_chain == cold
    ]
    if not fits:
        if cold:
            return BlockedReason(f"No refrigerated vehicle at {wh} can carry this cold-chain load")
        return BlockedReason(
            f"No vehicle at {wh} can carry {shipment.weight_kg:.0f} kg "
            f"and {shipment.pallet_slots} pallet slots"
        )

    crew = [d for d in fleet.drivers if d.home_warehouse_id == origin and d.id not in fleet.off_duty]
    if not crew:
        return BlockedReason(f"No driver available at {wh}: every driver is off duty")
    fits.sort(
        key=lambda v: (v.capacity_kg, _km_today_booked(index.vehicle(v.id, shipment.id), now), v.id)
    )

    earliest = now + START_DELAY
    first_failure: BlockedReason | None = None
    for start in _candidate_starts(crew, earliest, index, shipment.id):
        result = _attempt(shipment, start, now, fits, crew, index, fleet, wh, kind_word)
        if isinstance(result, TripPlan):
            return result
        first_failure = first_failure or result
        if not result.driver_wait:
            break
    assert first_failure is not None
    return first_failure


def _candidate_starts(
    crew: list[Driver], earliest: datetime, index: FleetIndex, exclude: str
) -> list[datetime]:
    """`now + 5 min`, then each later shift start and driver release time of the same IST day
    (5.10 step 5: the start is the latest of now, vehicle free and driver shift start)."""
    day = ist_day_start(earliest)
    starts = {earliest}
    for d in crew:
        t = day + timedelta(minutes=shift_bounds(d.shift)[0])
        if t > earliest:
            starts.add(t)
        for b in index.driver(d.id, exclude):
            if earliest < b.end < day + timedelta(days=1):
                starts.add(b.end)
    return sorted(starts)


def _attempt(
    shipment: Shipment,
    start: datetime,
    now: datetime,
    fits: list[Vehicle],
    crew: list[Driver],
    index: FleetIndex,
    fleet: FleetState,
    wh: str,
    kind_word: str,
) -> TripPlan | BlockedReason:
    earliest_free: datetime | None = None
    vehicle_ok: list[tuple[Vehicle, TripPlan]] = []
    for v in fits:
        try:
            trial = sim.build_trip(shipment, v, crew[0], start, fleet.routes)
        except sim.MissingRouteError as exc:
            return BlockedReason(f"No road route for {exc.args[0]}")
        window = (start, sim.trip_end(trial) + RETURN_BUFFER)
        clash = [
            b.end for b in index.vehicle(v.id, shipment.id) if _overlaps((b.start, b.end), window)
        ]
        if clash:
            free_at = max(clash)
            earliest_free = free_at if earliest_free is None else min(earliest_free, free_at)
            continue
        vehicle_ok.append((v, trial))

    if not vehicle_ok:
        until = ""
        if earliest_free is not None:
            until = f" until {earliest_free.astimezone(IST).strftime('%H:%M')}"
        return BlockedReason(f"No {kind_word} free at {wh}{until}")

    on_shift = [d for d in crew if in_shift(d, start)]
    if not on_shift:
        return BlockedReason(
            f"No driver on shift at {wh} at {start.astimezone(IST).strftime('%H:%M')}", driver_wait=True
        )

    all_busy = True
    for v, trial in vehicle_ok:
        window = (start, sim.trip_end(trial) + RETURN_BUFFER)
        hours = sim.trip_drive_hours(trial)
        free_drivers = []
        for d in on_shift:
            mine = index.driver(d.id, shipment.id)
            if any(_overlaps((b.start, b.end), window) for b in mine):
                continue
            if _drive_hours_booked(mine, now) + hours > MAX_DRIVE_HOURS:
                all_busy = False
                continue
            free_drivers.append(d)
        if not free_drivers:
            continue
        driver = min(free_drivers, key=lambda d: (-d.rating, d.id))
        return sim.build_trip(shipment, v, driver, start, fleet.routes, assigned_at=now)
    if all_busy:
        return BlockedReason(f"No driver at {wh} is free at {start.astimezone(IST).strftime('%H:%M')}", driver_wait=True)
    return BlockedReason(f"No driver at {wh} is free with driving hours left")


def queue_order(shipments: Iterable[Shipment]) -> list[Shipment]:
    """Queued shipments in retry order: priority, then creation time, then id."""
    return sorted(shipments, key=lambda s: (PRIORITY_RANK[s.priority], s.created_at, s.id))


def scenario_rng(seed: int, *parts: object) -> random.Random:
    import hashlib

    digest = hashlib.sha1("|".join(str(p) for p in (seed, *parts)).encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))
