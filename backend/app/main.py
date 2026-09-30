import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import chat, health, insights, logistics, public_chat, routes, voice_ws
from app.core.config import get_settings
from app.core.exceptions import (
    ApiError,
    DistrictNotFoundError,
    DriverNotFoundError,
    FacilityNotFoundError,
    InvalidTransitionError,
    RecommendationNotFoundError,
    ShipmentNotFoundError,
    ShipmentStateError,
    SwasthyaGridError,
    VehicleNotFoundError,
    WarehouseNotFoundError,
)
from app.core.logging import setup_logging

logger = logging.getLogger("swasthyagrid")

SECURITY_HEADERS = (
    (b"x-content-type-options", b"nosniff"),
    (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
    (b"x-frame-options", b"DENY"),
    (b"x-xss-protection", b"1; mode=block"),
)


class SecurityHeadersMiddleware:
    """Pure ASGI middleware: appends the security headers in `http.response.start`.

    `BaseHTTPMiddleware` buffers responses and hides client disconnects, which breaks
    the SSE stream, so this stays at the ASGI level.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                names = {name for name, _ in message.get("headers", [])}
                headers = list(message.get("headers", []))
                headers.extend(h for h in SECURITY_HEADERS if h[0] not in names)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Starts the logistics `TickLoop` (unless `LOGISTICS_TICK=false`) and stops it on exit."""
    tick_loop = None
    service = None
    if get_settings().logistics_tick:
        from app.api.deps import get_logistics_service, get_stream_hub
        from app.logistics.stream import TickLoop

        service = await asyncio.to_thread(get_logistics_service)  # boots the world
        await asyncio.to_thread(get_stream_hub)
        tick_loop = TickLoop(service)
        tick_loop.start()
    try:
        yield
    finally:
        if tick_loop is not None:
            await tick_loop.stop()
        if service is not None:
            service.flush()


def create_app() -> FastAPI:
    setup_logging()
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        description="AI District Health Operations Center — predictive, prescriptive, explainable, human-governed.",
        version="0.1.0",
        lifespan=lifespan,
    )

    origins = settings.cors_origins + [
        "https://swasthyagrid.vercel.app",
        "https://swasthyagrid-git-main-harshkawatra11s-projects.vercel.app"
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=settings.effective_cors_origin_regex,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_middleware(SecurityHeadersMiddleware)

    @app.exception_handler(FacilityNotFoundError)
    async def facility_not_found_handler(request: Request, exc: FacilityNotFoundError):
        logger.warning(f"Facility not found: {exc.facility_id}")
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(DistrictNotFoundError)
    async def district_not_found_handler(request: Request, exc: DistrictNotFoundError):
        logger.warning(f"District not found: {exc.district_id}")
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(RecommendationNotFoundError)
    async def recommendation_not_found_handler(request: Request, exc: RecommendationNotFoundError):
        return JSONResponse(
            status_code=404, content={"detail": str(exc), "code": "recommendation_not_found"}
        )

    @app.exception_handler(ShipmentNotFoundError)
    async def shipment_not_found_handler(request: Request, exc: ShipmentNotFoundError):
        return JSONResponse(
            status_code=404, content={"detail": str(exc), "code": "shipment_not_found"}
        )

    @app.exception_handler(VehicleNotFoundError)
    async def vehicle_not_found_handler(request: Request, exc: VehicleNotFoundError):
        return JSONResponse(
            status_code=404, content={"detail": str(exc), "code": "vehicle_not_found"}
        )

    @app.exception_handler(DriverNotFoundError)
    async def driver_not_found_handler(request: Request, exc: DriverNotFoundError):
        return JSONResponse(
            status_code=404, content={"detail": str(exc), "code": "driver_not_found"}
        )

    @app.exception_handler(WarehouseNotFoundError)
    async def warehouse_not_found_handler(request: Request, exc: WarehouseNotFoundError):
        return JSONResponse(
            status_code=404, content={"detail": str(exc), "code": "warehouse_not_found"}
        )

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError):
        return JSONResponse(
            status_code=exc.status_code, content={"detail": exc.detail, "code": exc.code}
        )

    @app.exception_handler(InvalidTransitionError)
    async def invalid_transition_handler(request: Request, exc: InvalidTransitionError):
        return JSONResponse(
            status_code=409, content={"detail": str(exc), "code": "invalid_transition"}
        )

    @app.exception_handler(ShipmentStateError)
    async def shipment_state_handler(request: Request, exc: ShipmentStateError):
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "invalid_state"})

    @app.exception_handler(SwasthyaGridError)
    async def swasthyagrid_error_handler(request: Request, exc: SwasthyaGridError):
        logger.error(f"Domain error: {exc!s}")
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    app.include_router(health.router)
    app.include_router(routes.router)
    app.include_router(logistics.router)
    app.include_router(insights.router)
    app.include_router(chat.router)
    app.include_router(public_chat.router)
    app.include_router(voice_ws.router)

    return app

app = create_app()
