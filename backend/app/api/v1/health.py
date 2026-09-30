from fastapi import APIRouter, Depends

from app.api.deps import get_logistics_service
from app.logistics.service import LogisticsService

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/ready")
def ready():
    return {"status": "ready"}


@router.get("/metrics")
def metrics(service: LogisticsService = Depends(get_logistics_service)):
    """Liveness plus the logistics tick budget (`tick_ms` last and p95 over 60 ticks)."""
    return {"uptime": "ok", "service": "swasthyagrid-api", **service.metrics_snapshot()}
