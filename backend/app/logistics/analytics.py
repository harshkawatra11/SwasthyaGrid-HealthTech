"""Aggregations over the 90 day history plus the live state at time t (section 5.14).

Everything here is a pure function: inputs are plain data (history rows, `Shipment`
objects, vehicles), the evaluation time is an argument, and nothing is read from a
clock or mutated. History rows and live shipments are first normalised into a
`TripRecord` so every metric treats both the same way.

Conventions (chosen where the plan is silent):
- A "day" is the IST calendar day of `t`; windows such as "7 days" end at `t`.
- `scope` is a district id or `None` for the whole state.
- A ratio with an empty denominator is `None`, never 0, so the UI can show a dash.
- `in_transit_now` and `delayed_now` are disjoint (a delayed shipment is not counted
  as in transit).
- History rows carry no distance and no cold-chain excursion flag, so `km_today` and
  cold-chain breaches come from live shipments only.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from app.logistics import sim
from app.logistics.clock import IST, iso, ist_day_start, parse_iso
from app.logistics.models import Shipment, Vehicle

STATUSES = (
    "recommended",
    "approved",
    "loading",
    "in_transit",
    "delayed",
    "arrived",
    "delivered",
    "cancelled",
)
MOVING = ("loading", "in_transit", "delayed")
ACTIVE = ("approved", "loading", "in_transit", "delayed", "arrived")
LOW_COVER_DAYS = 7.0
EXPIRING_SOON_DAYS = 60
ON_TIME_GRACE_MINUTES = 10.0


@dataclass(frozen=True)
class TripRecord:
    """One shipment, from history or from live state, as seen at time t."""

    id: str
    district_id: str
    origin_id: str
    destination_id: str
    kind: str
    priority: str
    status: str
    created_at: datetime
    departed_at: datetime | None
    arrived_at: datetime | None
    delivered_at: datetime | None
    actual_minutes: float | None
    on_time: bool | None
    cold_chain: bool
    vehicle_id: str | None
    driver_id: str | None
    live: bool


# --------------------------------------------------------------------------- normalising


def _dt(value: str | None) -> datetime | None:
    return parse_iso(value) if value else None


def record_from_history(row: dict[str, Any], t: datetime) -> TripRecord | None:
    """History row as it was known at `t`; rows created after `t` do not exist yet."""
    created = parse_iso(row["created_at"])
    if created > t:
        return None
    departed, arrived, delivered = (_dt(row.get(k)) for k in ("departed_at", "arrived_at", "delivered_at"))
    status = row["status"]
    if status == "delivered" and (delivered is None or delivered > t):
        status = "arrived" if arrived and arrived <= t else "in_transit" if departed and departed <= t else "approved"
    known_arrival = arrived is not None and arrived <= t
    return TripRecord(
        id=row["id"],
        district_id=row["district_id"],
        origin_id=row["origin_id"],
        destination_id=row["destination_id"],
        kind=row.get("kind", "replenishment"),
        priority=row["priority"],
        status=status,
        created_at=created,
        departed_at=departed if departed and departed <= t else None,
        arrived_at=arrived if known_arrival else None,
        delivered_at=delivered if delivered and delivered <= t else None,
        actual_minutes=row.get("actual_minutes") if known_arrival else None,
        on_time=row.get("on_time") if known_arrival else None,
        cold_chain=bool(row.get("cold_chain")),
        vehicle_id=row.get("vehicle_id"),
        driver_id=row.get("driver_id"),
        live=False,
    )


def record_from_shipment(s: Shipment, t: datetime) -> TripRecord | None:
    if s.created_at > t:
        return None
    trip = s.trip
    status = sim.derive_status(s, t)
    departed = arrived = None
    actual = None
    on_time = None
    if trip is not None:
        first = sim.first_departure(trip)
        end = sim.trip_end(trip)
        departed = first if first <= t else None
        if end <= t:
            arrived = end
            actual = (end - first).total_seconds() / 60.0
            planned = (trip.planned_arrival - first).total_seconds() / 60.0
            on_time = actual <= planned + ON_TIME_GRACE_MINUTES
    return TripRecord(
        id=s.id,
        district_id=s.district_id,
        origin_id=s.origin_id,
        destination_id=s.destination_facility_id,
        kind=s.kind,
        priority=s.priority,
        status=status,
        created_at=s.created_at,
        departed_at=departed,
        arrived_at=arrived,
        delivered_at=s.pod.confirmed_at if s.pod is not None and s.pod.confirmed_at <= t else None,
        actual_minutes=actual,
        on_time=on_time,
        cold_chain=s.cold_chain,
        vehicle_id=trip.vehicle_id if trip else None,
        driver_id=trip.driver_id if trip else None,
        live=True,
    )


def build_records(
    history: Iterable[dict[str, Any]], shipments: Iterable[Shipment], t: datetime
) -> list[TripRecord]:
    out: list[TripRecord] = []
    for row in history:
        rec = record_from_history(row, t)
        if rec is not None:
            out.append(rec)
    for s in shipments:
        rec = record_from_shipment(s, t)
        if rec is not None:
            out.append(rec)
    return out


def _in_scope(scope: str | None, district_id: str) -> bool:
    return scope is None or district_id == scope


def _day_bounds(t: datetime) -> tuple[datetime, datetime]:
    start = ist_day_start(t)
    return start, start + timedelta(days=1)


def _between(value: datetime | None, start: datetime, end: datetime) -> bool:
    return value is not None and start <= value < end


def _rate(hits: int, total: int) -> float | None:
    return round(hits / total, 3) if total else None


def _mean_hours(minutes: list[float]) -> float | None:
    return round(sum(minutes) / len(minutes) / 60.0, 2) if minutes else None


def _arrived_in(recs: Iterable[TripRecord], start: datetime, end: datetime) -> list[TripRecord]:
    return [r for r in recs if r.status != "cancelled" and _between(r.arrived_at, start, end)]


# --------------------------------------------------------------------------- kpis


def _excursion_started(s: Shipment, start: datetime, end: datetime) -> bool:
    trip = s.trip
    return bool(
        s.cold_chain
        and trip is not None
        and trip.reefer_excursion is not None
        and start <= trip.reefer_excursion[0] < end
        and s.status != "cancelled"
    )


def kpis(
    scope: str | None,
    t: datetime,
    history: Iterable[dict[str, Any]],
    shipments: Iterable[Shipment],
    vehicles: Iterable[Vehicle],
    unavailable_vehicles: Iterable[str] = (),
) -> dict[str, Any]:
    """Headline numbers for the control room (5.14)."""
    live = [s for s in shipments if _in_scope(scope, s.district_id)]
    recs = [r for r in build_records(history, live, t) if _in_scope(scope, r.district_id)]
    day_start, day_end = _day_bounds(t)
    week_start = t - timedelta(days=7)
    day_end = min(day_end, t + timedelta(seconds=1))

    delivered_today = sum(1 for r in recs if _between(r.delivered_at, day_start, day_end))
    today_arrived = _arrived_in(recs, day_start, day_end)
    week_arrived = _arrived_in(recs, week_start, t + timedelta(seconds=1))

    live_recs = [r for r in recs if r.live]
    moving_vehicles = {r.vehicle_id for r in live_recs if r.status in ("in_transit", "delayed") and r.vehicle_id}
    busy = {r.vehicle_id for r in live_recs if r.status in (*MOVING, "approved") and r.vehicle_id}
    out_of_service = set(unavailable_vehicles)
    fleet = [v for v in vehicles if _in_scope(scope, v.district_id)]
    available = [
        v
        for v in fleet
        if v.status != "maintenance" and v.id not in out_of_service and v.id not in busy
    ]
    cold_live = [s for s in live if s.cold_chain and sim.derive_status(s, t) in ("loading", "in_transit", "delayed", "arrived")]
    breaches = sum(1 for s in live if _excursion_started(s, day_start, min(day_end, t + timedelta(seconds=1))))

    return {
        "scope": scope,
        "sim_now": iso(t),
        "delivered_today": delivered_today,
        "in_transit_now": sum(1 for r in live_recs if r.status == "in_transit"),
        "delayed_now": sum(1 for r in live_recs if r.status == "delayed"),
        "on_time_rate_today": _rate(sum(1 for r in today_arrived if r.on_time), len(today_arrived)),
        "on_time_rate_7d": _rate(sum(1 for r in week_arrived if r.on_time), len(week_arrived)),
        "avg_transit_hours_7d": _mean_hours([r.actual_minutes for r in week_arrived if r.actual_minutes is not None]),
        "vehicles_in_transit": len(moving_vehicles),
        "vehicles_available": len(available),
        "pending_approvals": sum(1 for r in live_recs if r.status == "recommended"),
        "cold_chain_active": len(cold_live),
        "cold_chain_breaches_today": breaches,
    }


# --------------------------------------------------------------------------- series


def volume_series(
    scope: str | None,
    t: datetime,
    history: Iterable[dict[str, Any]],
    shipments: Iterable[Shipment],
    days: int = 90,
) -> dict[str, list[dict[str, Any]]]:
    """Per IST day, oldest first, ending with the day of `t`."""
    recs = [r for r in build_records(history, shipments, t) if _in_scope(scope, r.district_id)]
    last = ist_day_start(t)
    points: list[dict[str, Any]] = []
    for offset in range(days - 1, -1, -1):
        start = last - timedelta(days=offset)
        end = start + timedelta(days=1)
        created = [r for r in recs if _between(r.created_at, start, end)]
        delivered = [r for r in recs if _between(r.delivered_at, start, end)]
        timed = [r for r in delivered if r.actual_minutes is not None]
        judged = [r for r in delivered if r.on_time is not None]
        points.append(
            {
                "date": start.astimezone(IST).strftime("%Y-%m-%d"),
                "shipments": len(created),
                "delivered": len(delivered),
                "avg_transit_hours": _mean_hours([r.actual_minutes for r in timed if r.actual_minutes is not None]),
                "on_time_rate": _rate(sum(1 for r in judged if r.on_time), len(judged)),
            }
        )
    return {"points": points}


def status_breakdown(
    scope: str | None, t: datetime, shipments: Iterable[Shipment]
) -> dict[str, Any]:
    """Live shipments that matter today: still open, or finished (delivered or cancelled) today."""
    start, end = _day_bounds(t)
    counts = dict.fromkeys(STATUSES, 0)
    for s in shipments:
        if not _in_scope(scope, s.district_id) or s.created_at > t:
            continue
        status = sim.derive_status(s, t)
        if status in ("delivered", "cancelled"):
            closed = s.pod.confirmed_at if status == "delivered" and s.pod else s.cancelled_at
            if not _between(closed, start, end):
                continue
        counts[status] += 1
    return {"date": start.astimezone(IST).strftime("%Y-%m-%d"), "counts": counts}


# --------------------------------------------------------------------------- drivers and vehicles


def _overlap_hours(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> float:
    lo, hi = max(a0, b0), min(a1, b1)
    return max(0.0, (hi - lo).total_seconds() / 3600.0)


def driver_stats(
    driver_id: str,
    t: datetime,
    history: Iterable[dict[str, Any]],
    shipments: Iterable[Shipment],
    rating: float | None = None,
) -> dict[str, Any]:
    """Deliveries and on-time rate over 30 days, plus hours and km for the current day."""
    shipments = list(shipments)
    recs = [r for r in build_records(history, shipments, t) if r.driver_id == driver_id]
    window = t - timedelta(days=30)
    delivered = [
        r for r in recs if r.status != "cancelled" and _between(r.delivered_at, window, t + timedelta(seconds=1))
    ]
    judged = [r for r in delivered if r.on_time is not None]
    day_start, day_end = _day_bounds(t)
    hours = 0.0
    km = 0.0
    for s in shipments:
        trip = s.trip
        if trip is None or trip.driver_id != driver_id or s.status == "cancelled":
            continue
        if not (day_start <= trip.planned_start < day_end) or trip.planned_start > t:
            continue
        for seg in trip.segments:
            if seg.kind == "drive":
                hours += _overlap_hours(seg.start, seg.end, day_start, min(day_end, t))
        total = sim.trip_drive_hours(trip)
        done = sum(
            _overlap_hours(g.start, g.end, day_start, min(day_end, t)) for g in trip.segments if g.kind == "drive"
        )
        km += trip.distance_km * (done / total if total else 0.0)
    for r in recs:
        if not r.live and r.departed_at and r.actual_minutes and _between(r.departed_at, day_start, day_end):
            hours += _overlap_hours(
                r.departed_at, r.departed_at + timedelta(minutes=r.actual_minutes), day_start, min(day_end, t)
            )
    return {
        "driver_id": driver_id,
        "deliveries_30d": len(delivered),
        "on_time_rate_30d": _rate(sum(1 for r in judged if r.on_time), len(judged)),
        "avg_rating": rating,
        "hours_today": round(hours, 2),
        "km_today": round(km, 1),
    }


def vehicle_utilisation(
    scope: str | None,
    t: datetime,
    history: Iterable[dict[str, Any]],
    shipments: Iterable[Shipment],
    vehicles: Iterable[Vehicle],
) -> list[dict[str, Any]]:
    """Share of the last 7 days each vehicle spent on trips (loading to arrival), 0..1."""
    window = t - timedelta(days=7)
    busy: dict[str, float] = {}
    for row in history:
        vid = row.get("vehicle_id")
        if not vid or row["status"] != "delivered" or not row.get("departed_at") or not row.get("arrived_at"):
            continue
        busy[vid] = busy.get(vid, 0.0) + _overlap_hours(
            parse_iso(row["departed_at"]), parse_iso(row["arrived_at"]), window, t
        )
    for s in shipments:
        if s.trip is None or s.status == "cancelled":
            continue
        busy[s.trip.vehicle_id] = busy.get(s.trip.vehicle_id, 0.0) + _overlap_hours(
            s.trip.planned_start, sim.trip_end(s.trip), window, t
        )
    total_hours = 7 * 24.0
    return [
        {"vehicle_id": v.id, "utilisation_7d": round(min(1.0, busy.get(v.id, 0.0) / total_hours), 3)}
        for v in vehicles
        if _in_scope(scope, v.district_id)
    ]


# --------------------------------------------------------------------------- warehouses and facilities


def warehouse_flow(
    warehouse_id: str,
    t: datetime,
    history: Iterable[dict[str, Any]],
    shipments: Iterable[Shipment],
    stock_rows: Iterable[dict[str, Any]],
    reservations: dict[str, int] | None = None,
    adjustments: dict[str, int] | None = None,
    daily_consumption: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Outbound count, reserved units and days of cover per medicine for one warehouse.

    `stock_rows` are the warehouse's base rows (`medicine_name, units, batch_no, expiry_date`),
    `adjustments` the net change since the seed (receipts minus departures), `reservations`
    the units held for approved shipments and `daily_consumption` the district's daily use.
    """
    reservations = reservations or {}
    adjustments = adjustments or {}
    daily_consumption = daily_consumption or {}
    day_start, day_end = _day_bounds(t)
    end = min(day_end, t + timedelta(seconds=1))
    outbound = sum(
        1
        for r in build_records(history, shipments, t)
        if r.origin_id == warehouse_id and r.status != "cancelled" and _between(r.departed_at, day_start, end)
    )
    stock = []
    for row in stock_rows:
        med = row["medicine_name"]
        units = int(row["units"]) + adjustments.get(med, 0)
        reserved = reservations.get(med, 0)
        use = daily_consumption.get(med, 0.0)
        cover = round((units - reserved) / use, 1) if use > 0 else None
        expiry = row.get("expiry_date")
        soon = False
        if expiry:
            soon = date.fromisoformat(expiry) <= (t.astimezone(IST) + timedelta(days=EXPIRING_SOON_DAYS)).date()
        stock.append(
            {
                "medicine_name": med,
                "units": units,
                "reserved": reserved,
                "days_of_cover": cover,
                "batch_no": row.get("batch_no"),
                "expiry_date": expiry,
                "expiring_soon": soon,
            }
        )
    return {
        "warehouse_id": warehouse_id,
        "outbound_today": outbound,
        "reserved_units": sum(reservations.values()),
        "low_cover_medicines": sum(1 for x in stock if x["days_of_cover"] is not None and x["days_of_cover"] < LOW_COVER_DAYS),
        "stock": stock,
    }


def facility_inbound(facility_id: str, t: datetime, shipments: Iterable[Shipment]) -> list[dict[str, Any]]:
    """Active shipments heading to a facility, soonest ETA first (shipments without an ETA last)."""
    far = datetime.max.replace(tzinfo=t.tzinfo)
    rows = []
    for s in shipments:
        if s.destination_facility_id != facility_id or s.created_at > t:
            continue
        status = sim.derive_status(s, t)
        if status not in ACTIVE:
            continue
        rows.append(
            {
                "shipment_id": s.id,
                "status": status,
                "priority": s.priority,
                "kind": s.kind,
                "eta": s.trip.projected_arrival if s.trip else None,
                "delay_minutes": sim.delay_minutes(s),
            }
        )
    rows.sort(key=lambda r: (r["eta"] or far, r["shipment_id"]))
    return rows
