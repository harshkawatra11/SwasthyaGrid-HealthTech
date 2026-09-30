from functools import lru_cache

from app.agents.health_agent import HealthAgent
from app.core.config import get_settings
from app.logistics.service import LogisticsService, build_logistics_service
from app.logistics.stream import StreamHub
from app.repositories.district_repository import get_district_repository
from app.services.district_service import DistrictService
from app.services.forecast_service import ForecastService
from app.services.insights_service import InsightsService
from app.services.recommendation_service import RecommendationService


@lru_cache
def get_forecast_service() -> ForecastService:
    return ForecastService(get_district_repository())


@lru_cache
def get_district_service() -> DistrictService:
    return DistrictService(get_district_repository(), get_forecast_service())


@lru_cache
def _world() -> tuple[RecommendationService, LogisticsService]:
    """The recommendation and logistics services are built together (hooks link them)."""
    repo = get_district_repository()
    forecast = get_forecast_service()
    recs = RecommendationService(repo, forecast)
    return recs, build_logistics_service(repo, forecast, recs, get_settings())


@lru_cache
def get_recommendation_service() -> RecommendationService:
    get_logistics_service()  # boots the world so the drafts and the sim clock are bound
    return _world()[0]


@lru_cache
def get_health_agent() -> HealthAgent:
    return HealthAgent(
        get_settings(),
        get_district_service(),
        get_forecast_service(),
        get_recommendation_service(),
    )


@lru_cache
def get_public_agent():
    from app.agents.public_agent import PublicAgent
    return PublicAgent(get_settings())


@lru_cache
def get_logistics_service() -> LogisticsService:
    """Boots lazily on first call so module-level TestClient tests never need the lifespan."""
    service = _world()[1]
    service.boot()
    return service


@lru_cache
def get_briefing_service():
    from app.services.briefing_service import BriefingService

    return BriefingService(get_settings(), get_district_repository(), get_logistics_service())


@lru_cache
def get_insights_service() -> InsightsService:
    """Satisfies `InsightsQuery` (app.logistics.protocol)."""
    return InsightsService(
        get_district_repository(),
        get_forecast_service(),
        get_district_service(),
        get_recommendation_service(),
        get_logistics_service(),
        briefing=get_briefing_service(),
    )


@lru_cache
def get_stream_hub() -> StreamHub:
    return StreamHub(get_logistics_service())
