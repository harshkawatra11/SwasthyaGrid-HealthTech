"""Wire shapes for the logistics queries (section 6.3).

`LogisticsService` builds these and returns `model_dump(mode="json")` dicts, so
datetimes come out as `YYYY-MM-DDTHH:MM:SSZ`. The API layer reuses the same
classes as `response_model`s.
"""

from typing import Any, Literal

from pydantic import BaseModel

from app.logistics.models import (
    NodeKind,
    PodRecord,
    Priority,
    Segment,
    ShipmentEvent,
    ShipmentKind,
    ShipmentLine,
    ShipmentStatus,
    UtcDatetime,
    VehiclePosition,
)


class NodeRef(BaseModel):
    id: str
    name: str
    kind: NodeKind | None = None


class DriverRef(BaseModel):
    id: str
    name: str


class ShipmentSummary(BaseModel):
    id: str
    status: ShipmentStatus
    priority: Priority
    kind: ShipmentKind
    district_id: str
    origin: NodeRef
    destination: NodeRef
    lines_summary: str
    weight_kg: float
    pallet_slots: int
    cold_chain: bool
    created_at: UtcDatetime
    planned_start: UtcDatetime | None = None
    planned_arrival: UtcDatetime | None = None
    eta: UtcDatetime | None = None
    delay_minutes: int = 0
    progress: float = 0.0
    vehicle: dict[str, Any] | None = None  # {id, registration, class}
    driver: DriverRef | None = None
    source_recommendation_id: str | None = None
    blocked_reason: str | None = None


class StopView(BaseModel):
    node_id: str
    node_kind: NodeKind
    name: str
    purpose: Literal["pickup", "dropoff"]
    lat: float
    lng: float


class RecommendationRef(BaseModel):
    id: str
    subject: str
    priority: str
    confidence: int
    reasons: list[str]


class TemperaturePoint(BaseModel):
    at: UtcDatetime
    temp_c: float


class ShipmentDetail(ShipmentSummary):
    lines: list[ShipmentLine]
    stops: list[StopView]
    segments: list[Segment]
    path: list[list[float]]
    travelled_index: int
    position: VehiclePosition | None = None
    events: list[ShipmentEvent]
    pod: PodRecord | None = None
    recommendation: RecommendationRef | None = None
    temperature: list[TemperaturePoint] = []


class InboundLine(BaseModel):
    medicine_name: str
    units: int
    unit: str
    cold_chain: bool
    base_daily_consumption: float


class InboundItem(ShipmentSummary):
    lines: list[InboundLine]


class GanttSegment(BaseModel):
    kind: str
    start: UtcDatetime
    end: UtcDatetime


class GanttTrip(BaseModel):
    shipment_id: str
    status: ShipmentStatus
    segments: list[GanttSegment]
    label: str
