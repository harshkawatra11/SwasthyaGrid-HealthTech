"""The voice control room WebSocket: one connection per call, one VoiceSession.

Client frames: hello (language, scope, mode, protocol) | audio (b64) |
text (body, clientTurnId) | context (scope, facilityId) | ptt (state) |
interrupt | bye.
Server frames: ready | vad | partial | final | thinking | tool |
reply_delta | reply | audio | interrupted | turn_end | error. Only protocol 2
is served; a `hello` without `protocol: 2` gets a fatal `error` frame.

CORS middleware does not apply to WebSocket upgrades in Starlette, so the
Origin header is checked by hand against the same allow-list the REST API
uses, before the handshake is accepted.
"""

import json
import logging
import re

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.api.deps import (
    get_district_service,
    get_forecast_service,
    get_recommendation_service,
)
from app.core.config import Settings, get_settings
from app.services.district_service import DistrictService
from app.services.forecast_service import ForecastService
from app.services.recommendation_service import RecommendationService
from app.voice.session import VoiceSession

logger = logging.getLogger("swasthyagrid.voice")

router = APIRouter(tags=["voice"])


def _origin_allowed(origin: str | None, settings: Settings) -> bool:
    if origin is None:
        # Non-browser clients (curl, a test harness) send no Origin header at
        # all; only browser-originated cross-origin requests carry one.
        return True
    allowed: set[str] = {"https://swasthyagrid.vercel.app"}
    for configured in settings.cors_origins:
        allowed.add(configured)
        # A local dev server is reachable as both "localhost" and
        # "127.0.0.1"; a browser tab opened on either spelling must not be
        # rejected just because only one spelling was configured.
        if "localhost" in configured:
            allowed.add(configured.replace("localhost", "127.0.0.1"))
        elif "127.0.0.1" in configured:
            allowed.add(configured.replace("127.0.0.1", "localhost"))
    if origin in allowed:
        return True
    regex = settings.effective_cors_origin_regex
    return bool(regex and re.fullmatch(regex, origin))


@router.websocket("/ws/voice")
async def voice_ws(
    websocket: WebSocket,
    settings: Settings = Depends(get_settings),
    district: DistrictService = Depends(get_district_service),
    forecast: ForecastService = Depends(get_forecast_service),
    recommendation: RecommendationService = Depends(get_recommendation_service),
) -> None:
    origin = websocket.headers.get("origin")
    if not _origin_allowed(origin, settings):
        await websocket.close(code=4403)
        return

    await websocket.accept()

    session = VoiceSession(
        settings=settings,
        district=district,
        forecast=forecast,
        recommendation=recommendation,
        send=websocket.send_json,
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                frame = json.loads(raw)
            except (ValueError, TypeError):
                continue

            kind = frame.get("t")
            if kind == "hello":
                if frame.get("protocol") != 2:
                    await websocket.send_json(
                        {
                            "t": "error",
                            "message": "Unsupported voice protocol. Reload the page to update the client.",
                            "fatal": True,
                            "code": "protocol_unsupported",
                        }
                    )
                    break
                await session.start(
                    language=frame.get("language", "auto"),
                    scope=frame.get("scope"),
                    mode=frame.get("mode", "handsfree"),
                )
            elif kind == "audio":
                await session.handle_audio_chunk(frame.get("b64", ""))
            elif kind == "text":
                await session.handle_typed_text(
                    frame.get("body", ""), frame.get("clientTurnId")
                )
            elif kind == "context":
                await session.handle_context(frame)
            elif kind == "ptt":
                await session.handle_ptt(str(frame.get("state", "")))
            elif kind == "interrupt":
                await session.interrupt()
            elif kind == "bye":
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("voice websocket failed for session %s", session.session_id)
    finally:
        await session.dispose()
