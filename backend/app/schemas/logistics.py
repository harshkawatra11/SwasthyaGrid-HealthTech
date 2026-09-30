"""Response and request models for the logistics API (section 6.3).

The shipment shapes live in `app.logistics.views` (the service builds them); the
classes are re-exported here so the router and the fixture exporter import one module.
Class names are the ones the frontend type aliases expect (section 9.1).
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.logistics.models import ShipmentEvent, UtcDatetime, VehiclePosition
from app.logistics.views import (
    GanttSegment,
    GanttTrip,
    InboundItem,
    ShipmentDetail,
    ShipmentSummary,
)

__all__ = [
    "ClockState",
    "DriverDetail",
    "DriverSummary",
    "GanttSegment",
    "GanttTrip",
    "InboundItem",
    "InboundResponse",
    "LogisticsKpis",
    "PlannerRunResponse",
    "PodLine",
    "PodRequest",
    "PodResponse",
    "PositionsResponse",
    "ResetRequest",
    "ResetResponse",
    "ScheduleResponse",
    "ShipmentDetail",
    "ShipmentEvent",
    "ShipmentList",
    "ShipmentSummary",
    "StatusBreakdown",
    "StockAppliedRequest",
    "StockAppliedResponse",
    "TimeScaleRequest",
    "VehicleDetail",
    "VehiclePosition",
    "VehicleSummary",
    "VolumeSeries",
    "WarehouseDetail",
    "WarehouseSummary",
]

VehicleLiveStatus = Literal[
    "available", "scheduled", "loading", "in_transit", "delayed", "returning", "maintenance"
]
DriverLiveStatus = Literal["off_shift", "available", "assigned", "driving", "resting"]


class ClockState(BaseModel):
    sim_now: UtcDatetime
    scale: float
    scenario_start: UtcDatetime
    background_traffic: bool
    paused: bool = False


class TimeScaleRequest(BaseModel):
    scale: float = Field(ge=1, le=600)


class ResetRequest(BaseModel):
    seed: int | None = None


class ResetResponse(BaseModel):
    ok: bool
    sim_now: UtcDatetime


class LogisticsKpis(BaseModel):
    scope: str | None = None
    sim_now: UtcDatetime
    delivered_today: int
    in_transit_now: int
    delayed_now: int
    on_time_rate_today: float | None = None
    on_time_rate_7d: float | None = None
    avg_transit_hours_7d: float | None = None
    vehicles_in_transit: int
    vehicles_available: int
    pending_approvals: int
    cold_chain_active: int
    cold_chain_breaches_today: int


class VolumePoint(BaseModel):
    date: str
    shipments: int
    delivered: int
    avg_transit_hours: float | None = None
    on_time_rate: float | None = None


class VolumeSeries(BaseModel):
    points: list[VolumePoint]


class StatusBreakdown(BaseModel):
    date: str
    counts: dict[str, int]


class WarehouseSummary(BaseModel):
    id: str
    name: str
    type: str
    district_id: str
    lat: float
    lng: float
    capacity_pallets: int
    docks: int
    cold_room: bool
    outbound_today: int
    reserved_units: int
    low_cover_medicines: int


class WarehouseStockRow(BaseModel):
    medicine_name: str
    units: int
    reserved: int
    days_of_cover: float | None = None
    batch_no: str | None = None
    expiry_date: str | None = None
    expiring_soon: bool


class WarehouseDetail(WarehouseSummary):
    stock: list[WarehouseStockRow]
    outbound: list[ShipmentSummary]


class WarehouseList(BaseModel):
    items: list[WarehouseSummary]


class VehicleSummary(BaseModel):
    id: str
    registration: str
    class_: str = Field(alias="class")
    label: str
    capacity_kg: float
    pallet_slots: int
    cold_chain: bool
    home_warehouse_id: str
    district_id: str
    live_status: VehicleLiveStatus
    current_shipment_id: str | None = None
    position: VehiclePosition | None = None
    utilisation_7d: float
    km_since_service: float
    service_due: bool
    fuel_pct: int

    model_config = {"populate_by_name": True}


class CargoSlot(BaseModel):
    index: int
    state: Literal["loaded", "reserved", "empty"]
    medicine_name: str | None = None
    shipment_id: str | None = None
    cold_chain: bool = False
    weight_kg: float | None = None


class Cargo(BaseModel):
    slots: list[CargoSlot]
    used_kg: float
    used_slots: int


class VehicleDetail(VehicleSummary):
    cargo: Cargo
    schedule: list[GanttTrip]
    trips_7d: int
    odometer_km: float


class VehicleList(BaseModel):
    items: list[VehicleSummary]


class DriverSummary(BaseModel):
    id: str
    name: str
    home_warehouse_id: str
    district_id: str
    shift: str
    live_status: DriverLiveStatus
    rating: float
    deliveries_30d: int
    on_time_rate_30d: float | None = None
    hours_today: float
    current_shipment_id: str | None = None
    vehicle_id: str | None = None


class DriverDetail(DriverSummary):
    phone_masked: str
    license_masked: str
    license_expiry: str
    years_experience: int
    languages: list[str]
    schedule: list[GanttTrip]
    recent: list[ShipmentSummary]


class DriverList(BaseModel):
    items: list[DriverSummary]


class ShipmentList(BaseModel):
    items: list[ShipmentSummary]
    total: int


class InboundResponse(BaseModel):
    items: list[InboundItem]


class CancelRequest(BaseModel):
    reason: str
    actor: str | None = None


class PodLine(BaseModel):
    medicine_name: str
    units: int = Field(ge=0)


class PodRequest(BaseModel):
    pod_id: str
    facility_id: str
    confirmed_by: str
    received: list[PodLine]
    condition: Literal["ok", "damaged", "short"] = "ok"
    note: str | None = None


class PodResponse(BaseModel):
    shipment: ShipmentDetail
    already_confirmed: bool
    stock_applied_by: Literal["crm", "backend_overlay"]


class StockAppliedRequest(BaseModel):
    pod_id: str


class StockAppliedResponse(BaseModel):
    ok: bool


class PositionsResponse(BaseModel):
    sim_now: UtcDatetime
    items: list[VehiclePosition]


class ScheduleWindow(BaseModel):
    start: UtcDatetime
    end: UtcDatetime


class ScheduleRow(BaseModel):
    vehicle: VehicleSummary
    trips: list[GanttTrip]


class ScheduleResponse(BaseModel):
    date: str
    window: ScheduleWindow
    rows: list[ScheduleRow]


class BlockedShipment(BaseModel):
    shipment_id: str
    reason: str


class PlannerRunResponse(BaseModel):
    assigned: list[str]
    still_blocked: list[BlockedShipment]
