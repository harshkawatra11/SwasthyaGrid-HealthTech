"""Private, bounded demo worlds, independent of the persisted operational world."""

import re
import time
from collections import OrderedDict
from threading import RLock

from app.core.config import get_settings
from app.logistics.clock import parse_iso
from app.logistics.service import LogisticsService
from app.logistics.store import MemoryStateStore
from app.logistics.stream import StreamHub
from app.repositories.district_repository import DistrictRepository
from app.services.forecast_service import ForecastService
from app.services.recommendation_service import RecommendationService

_lock = RLock()
_visits: OrderedDict[str, tuple[LogisticsService, StreamHub, float]] = OrderedDict()
MAX_VISITS = 32
IDLE_SECONDS = 1800


def visit_world(key: str) -> tuple[LogisticsService, StreamHub]:
    if not re.fullmatch(r"[a-zA-Z0-9-]{16,80}", key):
        raise ValueError("Invalid demo session identifier")
    with _lock:
        now = time.monotonic()
        for old, (_, hub, touched) in list(_visits.items()):
            if hub.size == 0 and now - touched > IDLE_SECONDS:
                del _visits[old]
        if key not in _visits:
            if len(_visits) >= MAX_VISITS:
                from app.core.exceptions import ApiError

                raise ApiError(503, "Demo capacity reached; please retry shortly", "demo_capacity")
            settings = get_settings()
            repo = DistrictRepository(settings.seed_data_path)
            forecast = ForecastService(repo)
            recs = RecommendationService(repo, forecast)
            service = LogisticsService(
                repo, forecast, recs, MemoryStateStore(), settings=settings,
                scenario_start=(parse_iso(settings.logistics_scenario_start)
                                if settings.logistics_scenario_start else None),
            )
            service.boot()
            _visits[key] = (service, StreamHub(service), now)
        service, hub, _ = _visits[key]
        _visits[key] = (service, hub, now)
        _visits.move_to_end(key)
    service.tick()
    return service, hub
