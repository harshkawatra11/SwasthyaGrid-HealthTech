"""Live domain model for the logistics module (section 5.7).

All datetimes are timezone-aware UTC. On the wire they are serialised through
`model_dump(mode="json")`, which yields `YYYY-MM-DDTHH:MM:SSZ` because every
datetime field here uses the `UtcDatetime` annotation.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

from app.logistics.clock import iso

UtcDatetime = Annotated[datetime, PlainSerializer(iso, return_type=str, when_used="json")]

ShipmentStatus = Literal[
    "recommended",
    "approved",
    "loading",
    "in_transit",
    "delayed",
    "arrived",
    "delivered",
    "cancelled",
]
Priority = Literal["critical", "high", "normal"]
NodeKind = Literal["warehouse", "facility"]
ShipmentKind = Literal["replenishment", "lateral_transfer", "routine", "restock"]

TERMINAL_STATUSES = ("delivered", "cancelled")
ACTIVE_STATUSES = ("approved", "loading", "in_transit", "delayed", "arrived")


class ShipmentLine(BaseModel):
    medicine_name: str
    units: int
    cartons: int
    weight_kg: float
    pallet_slots: int
    cold_chain: bool


class Stop(BaseModel):
    """An ordered stop after the origin."""

    node_id: str
    node_kind: NodeKind
    purpose: Literal["pickup", "dropoff"]
    dwell_minutes: int = 0  # pickup 15, dropoff 0 (POD happens after arrival)


class Segment(BaseModel):
    """A trip timeline entry, all times UTC."""

    kind: Literal["load", "drive", "dwell", "incident"]
    start: UtcDatetime
    end: UtcDatetime
    node_id: str | None = None  # for load, dwell
    route_key: str | None = None  # for drive (and incident): "{from}->{to}" in routes.json
    from_fraction: float = 0.0  # for drive halves split by an incident
    to_fraction: float = 1.0
    note: str | None = None  # incident reason


class TripPlan(BaseModel):
    vehicle_id: str
    driver_id: str
    planned_start: UtcDatetime
    segments: list[Segment]
    planned_arrival: UtcDatetime  # promised ETA, excludes incidents
    projected_arrival: UtcDatetime  # includes incidents
    distance_km: float
    reefer_excursion: tuple[UtcDatetime, UtcDatetime] | None = None
    assigned_at: UtcDatetime | None = None  # when the planner picked vehicle and driver


class PodRecord(BaseModel):
    pod_id: str  # uuid from the CRM, idempotency key
    confirmed_at: UtcDatetime  # sim time when confirmed
    confirmed_by: str  # CRM displayName or "system (auto)"
    received: list[dict[str, Any]]  # [{medicine_name, units}]
    condition: Literal["ok", "damaged", "short"] = "ok"
    note: str | None = None


class Shipment(BaseModel):
    id: str  # "SHP-2" + 5-digit sequence, e.g. SHP-200123
    district_id: str
    origin_id: str
    origin_kind: NodeKind = "warehouse"  # always "warehouse" for the truck's start
    stops: list[Stop]
    destination_facility_id: str  # for a restock this is the receiving warehouse id
    lines: list[ShipmentLine]
    weight_kg: float
    pallet_slots: int
    cold_chain: bool
    priority: Priority
    source_recommendation_id: str | None = None
    kind: ShipmentKind
    status: ShipmentStatus  # stored status; live status is derived (5.9)
    created_at: UtcDatetime
    approved_at: UtcDatetime | None = None
    approved_by: str | None = None
    cancelled_at: UtcDatetime | None = None
    cancel_reason: str | None = None
    trip: TripPlan | None = None
    blocked_reason: str | None = None
    pod: PodRecord | None = None
    # Bookkeeping that is not part of the wire contract.
    reserved: bool = False  # units are reserved at the origin warehouse
    stock_dispatched: bool = False  # units have left the origin warehouse
    km_recorded: bool = False  # trip distance has been added to the vehicle odometer


class ShipmentEvent(BaseModel):
    shipment_id: str
    type: str
    at: UtcDatetime
    title: str
    detail: str | None = None
    actor: str | None = None
    lat: float | None = None
    lng: float | None = None


class VehiclePosition(BaseModel):
    shipment_id: str
    vehicle_id: str
    lat: float
    lng: float
    bearing: float
    speed_kmh: float
    progress: float
    status: ShipmentStatus
    eta: UtcDatetime
    temp_c: float | None = None


class Vehicle(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    registration: str
    vehicle_class: str = Field(alias="class")
    label: str
    capacity_kg: float
    pallet_slots: int
    cold_chain: bool
    home_warehouse_id: str
    district_id: str
    odometer_km: float
    km_since_service: float
    service_interval_km: float = 15000
    fuel_pct: int
    status: Literal["available", "maintenance"] = "available"


class Driver(BaseModel):
    id: str
    name: str
    phone_masked: str
    license_masked: str
    license_expiry: str
    home_warehouse_id: str
    shift: str
    rating: float
    years_experience: int
    languages: list[str]


class ActionLog(BaseModel):
    at: UtcDatetime
    actor: str
    action: str
    shipment_id: str | None = None
    detail: str | None = None
