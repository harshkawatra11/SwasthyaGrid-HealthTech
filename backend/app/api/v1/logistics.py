"""Logistics endpoints (section 6.3) and the live stream (6.4)."""

import asyncio
import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_logistics_service, get_stream_hub
from app.core.config import get_settings
from app.core.exceptions import ApiError
from app.logistics.service import LogisticsService
from app.logistics.stream import sse_events
from app.schemas.logistics import (
    CancelRequest,
    ClockState,
    DriverDetail,
    DriverList,
    InboundResponse,
    LogisticsKpis,
    PlannerRunResponse,
    PodRequest,
    PodResponse,
    PositionsResponse,
    ResetRequest,
    ResetResponse,
    ScheduleResponse,
    ShipmentDetail,
    ShipmentList,
    StatusBreakdown,
    StockAppliedRequest,
    StockAppliedResponse,
    TimeScaleRequest,
    VehicleDetail,
    VehicleList,
    VolumeSeries,
    WarehouseDetail,
    WarehouseList,
)

router = APIRouter(prefix="/api/v1/logistics", tags=["logistics"])

Service = Annotated[LogisticsService, Depends(get_logistics_service)]


def require_service_token(x_service_token: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().logistics_service_token
    if not expected:
        raise ApiError(503, "Service token is not configured", "service_token_not_configured")
    if not x_service_token or not hmac.compare_digest(
        x_service_token.encode("utf-8"), expected.encode("utf-8")
    ):
        raise ApiError(401, "Invalid service token", "invalid_service_token")


def require_admin() -> None:
    settings = get_settings()
    if not settings.logistics_admin_enabled or settings.environment == "production":
        raise ApiError(403, "Admin endpoints are disabled", "admin_disabled")


# ---------------------------------------------------------------------- clock and admin


@router.get("/clock", response_model=ClockState)
def clock(svc: Service):
    return svc.clock_info()


@router.post("/admin/time-scale", response_model=ClockState, dependencies=[Depends(require_admin)])
def set_time_scale(body: TimeScaleRequest, svc: Service):
    return svc.set_time_scale(body.scale)


@router.post("/admin/reset", response_model=ResetResponse, dependencies=[Depends(require_admin)])
def reset(svc: Service, body: ResetRequest | None = None):
    return svc.reset(body.seed if body else None)


# ---------------------------------------------------------------------- analytics


@router.get("/kpis", response_model=LogisticsKpis)
def kpis(svc: Service, district_id: str | None = None):
    return svc.kpis(district_id)


@router.get("/series/volume", response_model=VolumeSeries)
def volume_series(svc: Service, district_id: str | None = None, days: int = Query(90, ge=1, le=90)):
    return svc.volume_series(district_id, days)


@router.get("/status-breakdown", response_model=StatusBreakdown)
def status_breakdown(svc: Service, district_id: str | None = None):
    return svc.status_breakdown(district_id)


# ---------------------------------------------------------------------- warehouses, fleet


@router.get("/warehouses", response_model=WarehouseList)
def warehouses(svc: Service, district_id: str | None = None):
    return svc.warehouses_list(district_id)


@router.get("/warehouses/{warehouse_id}", response_model=WarehouseDetail)
def warehouse(warehouse_id: str, svc: Service):
    return svc.warehouse_detail(warehouse_id)


@router.get("/vehicles", response_model=VehicleList)
def vehicles(svc: Service, district_id: str | None = None, status: str | None = None):
    return svc.vehicles_list(district_id, status)


@router.get("/vehicles/{vehicle_id}", response_model=VehicleDetail)
def vehicle(vehicle_id: str, svc: Service):
    return svc.vehicle_detail(vehicle_id)


@router.get("/drivers", response_model=DriverList)
def drivers(svc: Service, district_id: str | None = None, status: str | None = None):
    return svc.drivers_list(district_id, status)


@router.get("/drivers/{driver_id}", response_model=DriverDetail)
def driver(driver_id: str, svc: Service):
    return svc.driver_detail(driver_id)


# ---------------------------------------------------------------------- shipments


@router.get("/shipments", response_model=ShipmentList)
def shipments(
    svc: Service,
    district_id: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    kind: str | None = None,
    facility_id: str | None = None,
    q: str | None = None,
    sort: Annotated[str, Query(pattern="^(eta|created_at|priority)$")] = "eta",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    statuses = [s.strip() for s in status.split(",") if s.strip()] if status else None
    return svc.query_shipments(
        district_id=district_id,
        statuses=statuses,
        priority=priority,
        kind=kind,
        facility_id=facility_id,
        q=q,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get("/shipments/{shipment_id}", response_model=ShipmentDetail)
def shipment(shipment_id: str, svc: Service):
    return svc.detail(shipment_id)


@router.post("/shipments/{shipment_id}/cancel", response_model=ShipmentDetail)
def cancel_shipment(shipment_id: str, body: CancelRequest, svc: Service):
    return svc.cancel(shipment_id, body.reason, body.actor)


@router.post(
    "/shipments/{shipment_id}/pod",
    response_model=PodResponse,
    dependencies=[Depends(require_service_token)],
)
def confirm_pod(shipment_id: str, body: PodRequest, svc: Service):
    return svc.confirm_pod(
        shipment_id,
        body.pod_id,
        body.facility_id,
        body.confirmed_by,
        [r.model_dump() for r in body.received],
        body.condition,
        body.note,
    )


@router.post(
    "/shipments/{shipment_id}/stock-applied",
    response_model=StockAppliedResponse,
    dependencies=[Depends(require_service_token)],
)
def stock_applied(shipment_id: str, body: StockAppliedRequest, svc: Service):
    return svc.stock_applied(shipment_id, body.pod_id)


@router.get("/facilities/{facility_id}/inbound", response_model=InboundResponse)
def facility_inbound(facility_id: str, svc: Service):
    svc.repo.facility(facility_id)  # 404 for an unknown facility
    return {"items": svc.facility_inbound(facility_id)}


@router.get("/positions", response_model=PositionsResponse)
def positions(svc: Service, district_id: str | None = None):
    return svc.positions(district_id)


@router.get("/schedule", response_model=ScheduleResponse)
def schedule(svc: Service, district_id: str | None = None, warehouse_id: str | None = None):
    return svc.schedule(district_id, warehouse_id)


@router.post("/planner/run", response_model=PlannerRunResponse)
def planner_run(svc: Service):
    return svc.planner_run()


# ---------------------------------------------------------------------- live stream


@router.get("/stream")
async def stream(district_id: str | None = None):
    hub = await asyncio.to_thread(get_stream_hub)  # first call boots the service
    return EventSourceResponse(sse_events(hub, district_id), ping=15)
