"""Sarvam realtime STT websocket client.

saaras:v3-realtime, linear16 mono 16kHz, "fast" stream_type for the lowest
latency, "auto" language for Hinglish code-switching by default (a district
officer may ask half in English, half in Hindi, in one sentence).

Ported from the verified contract in
nari-kavach/apps/relay/src/sarvam/stt-ws.ts, extended for voice v2:

- `parse_stt_event` turns raw events (discriminator key `event`) into typed
  `SttEvent`s: VAD start/end, partial and final transcripts (with `language`),
  errors.
- `SttHandle.flush()` sends `{"event":"flush"}` for hold-to-talk.
- If the socket drops, the handle reconnects (a few attempts) and keeps the
  last second of audio (10 frames of 100 ms, oldest dropped first) so speech
  spoken during the reconnect is not lost.
"""

import asyncio
import contextlib
import json
import logging
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import websockets
from websockets.asyncio.client import ClientConnection

logger = logging.getLogger("swasthyagrid.voice")

SARVAM_STT_WS_BASE = "wss://api.sarvam.ai/speech-to-text-realtime/ws"

PREROLL_FRAMES = 10  # about 1 s at 100 ms per frame
MAX_RECONNECTS = 3
RECONNECT_DELAY_S = 0.3

OnEvent = Callable[[dict[str, Any]], Awaitable[None]]
Connect = Callable[[str, dict[str, str]], Awaitable[ClientConnection]]


@dataclass
class SttEvent:
    """kind: session_begin | vad_start | vad_end | partial | final | error | other"""

    kind: str
    text: str = ""
    language: str | None = None
    fatal: bool = False
    message: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


_KINDS = {
    "session.begin": "session_begin",
    "vad.speech_start": "vad_start",
    "vad.speech_end": "vad_end",
    "transcript.partial": "partial",
    "transcript.final": "final",
    "error": "error",
}


def parse_stt_event(event: dict[str, Any]) -> SttEvent:
    kind = _KINDS.get(str(event.get("event")), "other")
    return SttEvent(
        kind=kind,
        text=str(event.get("text") or ""),
        language=event.get("language"),
        fatal=bool(event.get("is_fatal")),
        message=event.get("message"),
        raw=event,
    )


async def _default_connect(url: str, headers: dict[str, str]) -> ClientConnection:
    return await websockets.connect(url, additional_headers=headers)


class SttHandle:
    def __init__(
        self,
        *,
        url: str,
        headers: dict[str, str],
        on_event: OnEvent,
        connect: Connect = _default_connect,
        on_failed: Callable[[], Awaitable[None]] | None = None,
        max_reconnects: int = MAX_RECONNECTS,
        reconnect_delay: float = RECONNECT_DELAY_S,
        preroll_frames: int = PREROLL_FRAMES,
    ):
        self._url = url
        self._headers = headers
        self._on_event = on_event
        self._connect = connect
        self._on_failed = on_failed
        self._max_reconnects = max_reconnects
        self._reconnect_delay = reconnect_delay
        self._preroll: deque[str] = deque(maxlen=preroll_frames)
        self._conn: ClientConnection | None = None
        self._recv_task: asyncio.Task | None = None
        self._reconnect_task: asyncio.Task | None = None
        self._closed = False
        self.failed = False
        self.reconnects = 0

    async def start(self) -> None:
        self._conn = await self._connect(self._url, self._headers)
        self._recv_task = asyncio.create_task(self._recv_loop(self._conn))

    @property
    def connected(self) -> bool:
        return self._conn is not None

    async def send_audio(self, b64_audio: str) -> None:
        if self.failed:
            raise ConnectionError("Sarvam STT socket could not be re-established")
        conn = self._conn
        if conn is not None:
            try:
                await conn.send(json.dumps({"event": "audio_input", "audio": b64_audio}))
                return
            except Exception:
                logger.debug("STT send failed, reconnecting", exc_info=True)
                self._begin_reconnect(conn)
        self._preroll.append(b64_audio)  # deque(maxlen) drops the oldest frame

    async def flush(self) -> None:
        """End of a hold-to-talk utterance: ask STT to finalise now."""
        conn = self._conn
        if conn is None:
            return
        try:
            await conn.send(json.dumps({"event": "flush"}))
        except Exception:
            logger.debug("STT flush failed", exc_info=True)

    async def end(self) -> None:
        self._closed = True
        conn, self._conn = self._conn, None
        if conn is not None:
            try:
                await conn.send(json.dumps({"event": "end"}))
            except Exception:
                logger.debug("Sarvam STT socket already closed before end() could send")
        for task in (self._recv_task, self._reconnect_task):
            if task is not None and task is not asyncio.current_task():
                task.cancel()
        if conn is not None:
            with contextlib.suppress(Exception):
                await conn.close()

    # -------------------------------------------------------------- internals

    async def _recv_loop(self, conn: ClientConnection) -> None:
        try:
            async for raw in conn:
                try:
                    event = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                await self._on_event(event)
        except websockets.ConnectionClosed:
            pass
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Sarvam STT receive loop failed")
        if not self._closed:
            self._begin_reconnect(conn)

    def _begin_reconnect(self, dead: ClientConnection) -> None:
        if self._closed or self.failed:
            return
        if self._conn is dead:
            self._conn = None
        if self._reconnect_task is None or self._reconnect_task.done():
            self._reconnect_task = asyncio.create_task(self._reconnect())

    async def _reconnect(self) -> None:
        for attempt in range(1, self._max_reconnects + 1):
            await asyncio.sleep(self._reconnect_delay * attempt)
            if self._closed:
                return
            try:
                conn = await self._connect(self._url, self._headers)
            except Exception:
                logger.warning("STT reconnect attempt %d failed", attempt, exc_info=True)
                continue
            try:
                while self._preroll:
                    frame = self._preroll.popleft()
                    await conn.send(json.dumps({"event": "audio_input", "audio": frame}))
            except Exception:
                logger.warning("STT preroll replay failed", exc_info=True)
                with contextlib.suppress(Exception):
                    await conn.close()
                continue
            self._conn = conn
            self._recv_task = asyncio.create_task(self._recv_loop(conn))
            self.reconnects += 1
            return
        self.failed = True
        if self._on_failed is not None:
            await self._on_failed()


async def open_stt_socket(
    *,
    api_key: str,
    language: str,
    on_event: OnEvent,
    model: str,
    base_url: str = SARVAM_STT_WS_BASE,
    connect: Connect = _default_connect,
    on_failed: Callable[[], Awaitable[None]] | None = None,
    max_reconnects: int = MAX_RECONNECTS,
    reconnect_delay: float = RECONNECT_DELAY_S,
) -> SttHandle:
    qs = urlencode(
        {
            "model": model,
            "language_code": language,
            "stream_type": "fast",
            "encoding": "linear16",
            "sample_rate": "16000",
            "endpointing": "vad",
            "silence_duration_ms": "500",
            "threshold": "0.3",
        }
    )
    handle = SttHandle(
        url=f"{base_url}?{qs}",
        headers={"api-subscription-key": api_key},
        on_event=on_event,
        connect=connect,
        on_failed=on_failed,
        max_reconnects=max_reconnects,
        reconnect_delay=reconnect_delay,
    )
    await handle.start()
    return handle
