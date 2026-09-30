"""Trip planning and status derivation: pure functions (section 5.9).

Nothing here reads a clock or mutates state. Every function takes the time it
should evaluate at, so tests use fixed datetimes and never sleep. Events and
positions are derived from the shipment's stored trip plan, which means a
restart reproduces exactly the same history.
"""

import hashlib
import math
import random
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.logistics import roads
from app.logistics.clock import ist_hour
from app.logistics.models import (
    Driver,
    Segment,
    Shipment,
    ShipmentEvent,
    ShipmentStatus,
    TripPlan,
    Vehicle,
    VehiclePosition,
)

# Vehicle classes (5.3): capacity, pallet slots, cold chain, speed factor over OSRM car time.
VEHICLE_CLASSES: dict[str, dict] = {
    "van": {"capacity_kg": 750, "pallet_slots": 2, "cold_chain": False, "speed_factor": 1.25},
    "light_truck": {"capacity_kg": 2500, "pallet_slots": 6, "cold_chain": False, "speed_factor": 1.35},
    "reefer_van": {"capacity_kg": 1200, "pallet_slots": 3, "cold_chain": True, "speed_factor": 1.30},
    "medium_truck": {"capacity_kg": 7000, "pallet_slots": 12, "cold_chain": False, "speed_factor": 1.50},
    "reefer_truck": {"capacity_kg": 3000, "pallet_slots": 6, "cold_chain": True, "speed_factor": 1.45},
}

INCIDENT_PROBABILITY = 0.18
INCIDENT_MINUTES = [12, 18, 25, 40, 55]
INCIDENT_REASONS = [
    "Traffic congestion",
    "Checkpost inspection",
    "Tyre puncture",
    "Road works diversion",
    "Weather slowdown",
]
PEAK_HOURS_IST = (9, 10, 17, 18, 19)
DELAY_GRACE = timedelta(minutes=10)
PICKUP_DWELL_MINUTES = 15
REEFER_EXCURSION_PROBABILITY = 0.05
REEFER_EXCURSION_MINUTES = 14
REEFER_LIMIT_C = 8.0
EASE_EDGE = 0.03


class MissingRouteError(KeyError):
    """A trip was requested for a pair with no entry in routes.json."""


# --------------------------------------------------------------------------- helpers


def speed_factor(vehicle_class: str) -> float:
    return VEHICLE_CLASSES[vehicle_class]["speed_factor"]


def traffic_factor(start: datetime) -> float:
    return 1.2 if ist_hour(start) in PEAK_HOURS_IST else 1.0


def load_minutes(pallet_slots: int) -> int:
    return min(45, 12 + 6 * pallet_slots)


def shipment_rng(shipment_id: str) -> random.Random:
    """Deterministic RNG keyed by the shipment id."""
    digest = hashlib.sha1(shipment_id.encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


def _secs(minutes: float) -> timedelta:
    return timedelta(seconds=round(minutes * 60))


def pick_vehicle_class(
    weight_kg: float, pallet_slots: int, cold_chain: bool, central: bool = False
) -> str | None:
    """Smallest adequate class (least capacity) for a load, at a DDW or at central."""
    allowed = ("medium_truck", "reefer_truck") if central else ("van", "light_truck", "reefer_van")
    fits = [
        (spec["capacity_kg"], name)
        for name, spec in VEHICLE_CLASSES.items()
        if name in allowed
        and spec["capacity_kg"] >= weight_kg
        and spec["pallet_slots"] >= pallet_slots
        and spec["cold_chain"] == cold_chain  # reefers are kept free for cold-chain loads
    ]
    return min(fits)[1] if fits else None


def estimate_trip_minutes(
    routes: roads.Routes,
    origin_id: str,
    stop_ids: list[str],
    pallet_slots: int,
    vehicle_class: str,
    pickups: int = 0,
) -> float:
    """Load plus drive time by road for a class, with no traffic factor (recommendation ETA)."""
    total = float(load_minutes(pallet_slots)) + PICKUP_DWELL_MINUTES * pickups
    prev = origin_id
    for stop in stop_ids:
        r = routes[roads.route_key(prev, stop)]
        total += r["duration_s"] / 60.0 * speed_factor(vehicle_class)
        prev = stop
    return total


# --------------------------------------------------------------------------- planning


@dataclass
class _Item:
    kind: str
    seconds: int
    node_id: str | None = None
    route_key: str | None = None
    from_fraction: float = 0.0
    to_fraction: float = 1.0
    note: str | None = None


def build_trip(
    shipment: Shipment,
    vehicle: Vehicle,
    driver: Driver,
    start: datetime,
    routes: roads.Routes,
    rng: random.Random | None = None,
    assigned_at: datetime | None = None,
) -> TripPlan:
    """Build the timeline for a shipment starting at `start` (5.9 steps 1 to 5)."""
    rng = rng or shipment_rng(shipment.id)
    factor = speed_factor(vehicle.vehicle_class)

    # Plan without the incident so traffic factors depend only on the planned timeline.
    items: list[_Item] = [
        _Item("load", round(load_minutes(shipment.pallet_slots) * 60), node_id=shipment.origin_id)
    ]
    cursor = start + timedelta(seconds=items[0].seconds)
    prev = shipment.origin_id
    distance_m = 0.0
    for stop in shipment.stops:
        key = roads.route_key(prev, stop.node_id)
        route = routes.get(key)
        if route is None:
            raise MissingRouteError(key)
        seconds = round(route["duration_s"] * factor * traffic_factor(cursor))
        items.append(_Item("drive", seconds, route_key=key))
        cursor += timedelta(seconds=seconds)
        distance_m += route["distance_m"]
        if stop.purpose == "pickup" and stop.dwell_minutes > 0:
            dwell = round(stop.dwell_minutes * 60)
            items.append(_Item("dwell", dwell, node_id=stop.node_id))
            cursor += timedelta(seconds=dwell)
        prev = stop.node_id
    planned_arrival = cursor

    # Incident: one drive segment is split around it (step 3).
    incident_seconds = 0
    if rng.random() < INCIDENT_PROBABILITY:
        drive_idx = [i for i, it in enumerate(items) if it.kind == "drive"]
        idx = rng.choice(drive_idx)
        q = rng.uniform(0.25, 0.8)
        minutes = rng.choice(INCIDENT_MINUTES)
        reason = rng.choice(INCIDENT_REASONS)
        drive = items[idx]
        first = round(drive.seconds * q)
        incident_seconds = minutes * 60
        items[idx : idx + 1] = [
            _Item("drive", first, route_key=drive.route_key, from_fraction=0.0, to_fraction=q),
            _Item(
                "incident",
                incident_seconds,
                route_key=drive.route_key,
                from_fraction=q,
                to_fraction=q,
                note=reason,
            ),
            _Item(
                "drive",
                drive.seconds - first,
                route_key=drive.route_key,
                from_fraction=q,
                to_fraction=1.0,
            ),
        ]

    segments: list[Segment] = []
    t = start
    for it in items:
        end = t + timedelta(seconds=it.seconds)
        segments.append(
            Segment(
                kind=it.kind,  # type: ignore[arg-type]
                start=t,
                end=end,
                node_id=it.node_id,
                route_key=it.route_key,
                from_fraction=it.from_fraction,
                to_fraction=it.to_fraction,
                note=it.note,
            )
        )
        t = end
    projected_arrival = t

    excursion = None
    if shipment.cold_chain and rng.random() < REEFER_EXCURSION_PROBABILITY:
        drive_total = sum((s.end - s.start).total_seconds() for s in segments if s.kind == "drive")
        target = 0.4 * drive_total
        acc = 0.0
        for s in segments:
            if s.kind != "drive":
                continue
            dur = (s.end - s.start).total_seconds()
            if acc + dur >= target:
                begin = s.start + timedelta(seconds=target - acc)
                begin = begin.replace(microsecond=0)
                excursion = (begin, begin + timedelta(minutes=REEFER_EXCURSION_MINUTES))
                break
            acc += dur

    return TripPlan(
        vehicle_id=vehicle.id,
        driver_id=driver.id,
        planned_start=start,
        segments=segments,
        planned_arrival=planned_arrival,
        projected_arrival=projected_arrival,
        distance_km=round(distance_m / 1000.0, 2),
        reefer_excursion=excursion,
        assigned_at=assigned_at,
    )


def trip_drive_hours(trip: TripPlan) -> float:
    secs = sum((s.end - s.start).total_seconds() for s in trip.segments if s.kind == "drive")
    return secs / 3600.0


def trip_end(trip: TripPlan) -> datetime:
    return trip.segments[-1].end if trip.segments else trip.projected_arrival


def first_departure(trip: TripPlan) -> datetime:
    for s in trip.segments:
        if s.kind == "drive":
            return s.start
    return trip.planned_start


# --------------------------------------------------------------------------- status


def derive_status(shipment: Shipment, t: datetime) -> ShipmentStatus:
    """Live status at time `t`, evaluated in the order of section 5.9."""
    if shipment.status in ("delivered", "cancelled"):
        return shipment.status
    if shipment.approved_at is None or shipment.approved_at > t:
        return "recommended"
    trip = shipment.trip
    if trip is None or t < trip.planned_start:
        return "approved"
    delayed = trip.projected_arrival > trip.planned_arrival + DELAY_GRACE
    for seg in trip.segments:
        if seg.start <= t < seg.end:
            if seg.kind == "load":
                return "loading"
            if seg.kind == "incident":
                return "delayed"
            return "delayed" if delayed else "in_transit"
    return "arrived"


def delay_minutes(shipment: Shipment) -> int:
    trip = shipment.trip
    if trip is None:
        return 0
    return max(0, round((trip.projected_arrival - trip.planned_arrival).total_seconds() / 60))


# --------------------------------------------------------------------------- position


def _ease(f: float) -> float:
    """Quadratic ease at both ends, identity in between, continuous and monotonic."""
    if f < EASE_EDGE:
        return f * f / EASE_EDGE
    if f > 1.0 - EASE_EDGE:
        g = 1.0 - f
        return 1.0 - g * g / EASE_EDGE
    return f


def _temp_c(shipment: Shipment, trip: TripPlan, t: datetime) -> float:
    minutes = (t - trip.planned_start).total_seconds() / 60.0
    base = 4.6 + 0.5 * math.sin(minutes / 17.0)
    if trip.reefer_excursion:
        begin, end = trip.reefer_excursion
        if begin <= t < end:
            frac = (t - begin).total_seconds() / max(1.0, (end - begin).total_seconds())
            return base + (9.2 - base) * frac
    return base


def temperature_at(shipment: Shipment, t: datetime) -> float | None:
    if not shipment.cold_chain or shipment.trip is None:
        return None
    return round(_temp_c(shipment, shipment.trip, t), 1)


@dataclass
class Locus:
    lat: float
    lng: float
    bearing: float
    speed_kmh: float
    travelled_m: float
    total_m: float


def _drive_m(seg: Segment, routes: roads.Routes) -> float:
    route = routes[seg.route_key]  # type: ignore[index]
    return (seg.to_fraction - seg.from_fraction) * roads.route_geometry_m(route["polyline"])


def locate(trip: TripPlan, t: datetime, routes: roads.Routes) -> Locus:
    """Where the vehicle is at `t`, from the trip timeline and the decoded route geometry."""
    drives = [s for s in trip.segments if s.kind == "drive"]
    total_m = sum(_drive_m(s, routes) for s in drives)
    first = drives[0]
    first_poly = routes[first.route_key]["polyline"]  # type: ignore[index]
    start_lat, start_lng, start_bearing, _ = roads.point_at(first_poly, first.from_fraction)

    travelled = 0.0
    last_point = (start_lat, start_lng, start_bearing)
    for seg in trip.segments:
        if t < seg.start:
            break
        if seg.kind == "load":
            if seg.start <= t < seg.end:
                return Locus(start_lat, start_lng, start_bearing, 0.0, 0.0, total_m)
            continue
        poly = routes[seg.route_key]["polyline"] if seg.route_key else None  # type: ignore[index]
        if seg.kind == "drive":
            length = _drive_m(seg, routes)
            if seg.start <= t < seg.end:
                span = (seg.end - seg.start).total_seconds()
                f = (t - seg.start).total_seconds() / span if span > 0 else 1.0
                frac = seg.from_fraction + _ease(f) * (seg.to_fraction - seg.from_fraction)
                lat, lng, bearing, _ = roads.point_at(poly, frac)  # type: ignore[arg-type]
                hours = span / 3600.0
                speed = (length / 1000.0 / hours) if hours > 0 else 0.0
                done = travelled + (frac - seg.from_fraction) * roads.route_geometry_m(poly)  # type: ignore[arg-type]
                return Locus(lat, lng, bearing, speed, done, total_m)
            travelled += length
            lat, lng, bearing, _ = roads.point_at(poly, seg.to_fraction)  # type: ignore[arg-type]
            last_point = (lat, lng, bearing)
        elif seg.kind == "incident":
            if seg.start <= t < seg.end:
                lat, lng, bearing, _ = roads.point_at(poly, seg.from_fraction)  # type: ignore[arg-type]
                return Locus(lat, lng, bearing, 0.0, travelled, total_m)
        elif seg.kind == "dwell" and seg.start <= t < seg.end:
            return Locus(*last_point[:2], last_point[2], 0.0, travelled, total_m)
    return Locus(*last_point[:2], last_point[2], 0.0, travelled, total_m)


def position(shipment: Shipment, t: datetime, routes: roads.Routes) -> VehiclePosition | None:
    trip = shipment.trip
    if trip is None:
        return None
    locus = locate(trip, t, routes)
    progress = 0.0 if locus.total_m <= 0 else min(1.0, max(0.0, locus.travelled_m / locus.total_m))
    return VehiclePosition(
        shipment_id=shipment.id,
        vehicle_id=trip.vehicle_id,
        lat=round(locus.lat, 6),
        lng=round(locus.lng, 6),
        bearing=round(locus.bearing % 360.0, 1),
        speed_kmh=round(locus.speed_kmh, 1),
        progress=round(progress, 4),
        status=derive_status(shipment, t),
        eta=trip.projected_arrival,
        temp_c=temperature_at(shipment, t),
    )


# --------------------------------------------------------------------------- events


@dataclass
class EventContext:
    """Optional naming context so event titles read like the design (5.9)."""

    names: Mapping[str, str]
    vehicle_registration: str | None = None
    driver_name: str | None = None

    def name(self, node_id: str) -> str:
        return self.names.get(node_id, node_id)


def _lines_summary(shipment: Shipment) -> str:
    return ", ".join(f"{ln.medicine_name} {ln.units}" for ln in shipment.lines)


def derive_events(
    shipment: Shipment,
    t: datetime,
    routes: roads.Routes | None = None,
    ctx: EventContext | None = None,
) -> list[ShipmentEvent]:
    """Every event of the shipment whose time is at or before `t`, oldest first."""
    ctx = ctx or EventContext(names={})
    events: list[ShipmentEvent] = []

    def add(type_: str, at: datetime, title: str, detail=None, actor=None, locate_at=True):
        lat = lng = None
        if locate_at and routes is not None and shipment.trip is not None:
            try:
                locus = locate(shipment.trip, at, routes)
                lat, lng = round(locus.lat, 6), round(locus.lng, 6)
            except KeyError:
                pass
        events.append(
            ShipmentEvent(
                shipment_id=shipment.id,
                type=type_,
                at=at,
                title=title,
                detail=detail,
                actor=actor,
                lat=lat,
                lng=lng,
            )
        )

    add("created", shipment.created_at, "Shipment created", _lines_summary(shipment), locate_at=False)
    if shipment.approved_at:
        add(
            "approved",
            shipment.approved_at,
            "Approved",
            actor=shipment.approved_by,
            locate_at=False,
        )
    trip = shipment.trip
    if trip is not None:
        assigned = trip.assigned_at or shipment.approved_at or shipment.created_at
        who = " and ".join(x for x in (ctx.vehicle_registration, ctx.driver_name) if x)
        add(
            "vehicle_assigned",
            assigned,
            "Vehicle and driver assigned",
            who or f"{trip.vehicle_id}, {trip.driver_id}",
            locate_at=False,
        )
        seen_first_drive = False
        prev_seg: Segment | None = None
        for seg in trip.segments:
            if seg.kind == "load":
                add("loading_started", seg.start, f"Loading at {ctx.name(shipment.origin_id)}")
            elif seg.kind == "drive":
                if not seen_first_drive:
                    add("departed", seg.start, f"Departed {ctx.name(shipment.origin_id)}")
                    seen_first_drive = True
                elif prev_seg is not None and prev_seg.kind == "dwell":
                    add(
                        "departed_pickup",
                        seg.start,
                        f"Departed {ctx.name(prev_seg.node_id or '')}",
                    )
            elif seg.kind == "dwell":
                add(
                    "arrived_pickup",
                    seg.start,
                    f"Arrived at {ctx.name(seg.node_id or '')} for pickup",
                )
            elif seg.kind == "incident":
                minutes = round((seg.end - seg.start).total_seconds() / 60)
                add("incident_started", seg.start, f"Delay: {seg.note} ({minutes} min)")
                add("incident_cleared", seg.end, "Delay cleared")
            prev_seg = seg
        if trip.reefer_excursion:
            begin, end = trip.reefer_excursion
            add("cold_chain_breach", begin, f"Cold chain breach: above {REEFER_LIMIT_C:.0f} C")
            add("cold_chain_recovered", end, "Cold chain recovered")
        add(
            "arrived",
            trip_end(trip),
            f"Arrived at {ctx.name(shipment.destination_facility_id)}",
            "Awaiting proof of delivery",
        )
    if shipment.pod:
        add(
            "pod_confirmed",
            shipment.pod.confirmed_at,
            f"Delivery confirmed by {shipment.pod.confirmed_by}",
            shipment.pod.note,
            actor=shipment.pod.confirmed_by,
            locate_at=False,
        )
    if shipment.cancelled_at:
        add(
            "cancelled",
            shipment.cancelled_at,
            f"Cancelled: {shipment.cancel_reason or 'no reason given'}",
            locate_at=False,
        )
        events = [
            e
            for e in events
            if e.type in ("created", "approved", "vehicle_assigned", "cancelled")
            or e.at <= shipment.cancelled_at
        ]

    events = [e for e in events if e.at <= t]
    order = {id(e): i for i, e in enumerate(events)}
    events.sort(key=lambda e: (e.at, order[id(e)]))
    return events
