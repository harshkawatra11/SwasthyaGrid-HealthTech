"""Streaming Sarvam TTS over WebSocket, one socket per session.

Probe P0.2 facts: `wss://api.sarvam.ai/text-to-speech/ws`, config field
`target_language_code`, `output_audio_codec: linear16` is raw PCM s16le at
24 kHz (no WAV header), and with `send_completion_event=true` a
`{"type":"event","data":{"event_type":"final"}}` follows the flush.

Per turn the session calls `begin_turn`, then `say(sentence)` for each
sentence as it is segmented, then `end_turn()`; `cancel_turn()` drops
everything on barge-in (the socket is closed and reopened lazily).

Any socket failure finishes the rest of the turn with REST TTS (WAV chunks)
and keeps the stream in REST mode for five minutes.
"""

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import websockets

from app.voice import sarvam_tts

logger = logging.getLogger("swasthyagrid.voice")

SARVAM_TTS_WS_URL = "wss://api.sarvam.ai/text-to-speech/ws"
SAMPLE_RATE_HZ = 24000
PING_INTERVAL_S = 20.0
FINAL_TIMEOUT_S = 10.0
REST_COOLDOWN_S = 300.0
# Rough speaking rate used only to work out which sentence a failed socket had reached.
_CHARS_PER_SECOND = 14.0


@dataclass
class AudioChunk:
    b64: str
    encoding: str  # "pcm_s16le" | "wav"
    sample_rate_hz: int
    seq: int


OnAudio = Callable[[AudioChunk], Awaitable[None]]
RestSynth = Callable[..., Awaitable[sarvam_tts.WavSynthesis]]


@dataclass
class _Turn:
    language: str
    on_audio: OnAudio
    sentences: list[str] = field(default_factory=list)
    seq: int = 0
    audio_bytes: int = 0
    final: asyncio.Event = field(default_factory=asyncio.Event)
    failed: bool = False
    rest_queue: "asyncio.Queue[str | None] | None" = None
    rest_task: "asyncio.Task | None" = None


class TtsStream:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        speaker: str,
        mode: str = "ws",
        base_url: str = SARVAM_TTS_WS_URL,
        ping_interval: float = PING_INTERVAL_S,
        final_timeout: float = FINAL_TIMEOUT_S,
        rest_cooldown: float = REST_COOLDOWN_S,
        rest_synthesize: RestSynth | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.api_key = api_key
        self.model = model
        self.speaker = speaker.lower()
        self._configured_mode = mode
        self.base_url = base_url
        self.ping_interval = ping_interval
        self.final_timeout = final_timeout
        self.rest_cooldown = rest_cooldown
        self._rest_synthesize = rest_synthesize
        self._clock = clock
        self._rest_until = 0.0
        self._conn: Any = None
        self._conn_language: str | None = None
        self._recv_task: asyncio.Task | None = None
        self._ping_task: asyncio.Task | None = None
        self._turn: _Turn | None = None
        self.closed = False

    # ------------------------------------------------------------------ mode

    @property
    def mode(self) -> str:
        if self._configured_mode == "rest" or self._clock() < self._rest_until:
            return "rest"
        return "ws"

    def _enter_rest_mode(self) -> None:
        self._rest_until = self._clock() + self.rest_cooldown

    # ----------------------------------------------------------------- turns

    async def begin_turn(self, language: str, on_audio: OnAudio) -> None:
        if self._turn is not None:
            await self.cancel_turn()
        language = "hi-IN" if language == "auto" else language
        turn = _Turn(language=language, on_audio=on_audio)
        self._turn = turn
        if self.mode == "rest":
            self._start_rest(turn)
            return
        try:
            await self._ensure_socket(language)
        except Exception:
            logger.warning("TTS socket could not open, using REST for this turn", exc_info=True)
            self._enter_rest_mode()
            await self._close_socket()
            self._start_rest(turn)

    async def say(self, sentence: str) -> None:
        turn = self._turn
        sentence = sentence.strip()
        if turn is None or not sentence:
            return
        turn.sentences.append(sentence)
        if turn.rest_queue is not None:
            turn.rest_queue.put_nowait(sentence)
            return
        try:
            await self._conn.send(json.dumps({"type": "text", "data": {"text": sentence}}))
        except Exception:
            logger.warning("TTS socket send failed, falling back to REST", exc_info=True)
            await self._fallback(turn)

    async def end_turn(self) -> None:
        """Flush and wait until all audio for the turn has been delivered."""
        turn = self._turn
        if turn is None:
            return
        try:
            if turn.rest_queue is None:
                try:
                    await self._conn.send(json.dumps({"type": "flush"}))
                    await asyncio.wait_for(turn.final.wait(), self.final_timeout)
                    if turn.failed:
                        raise ConnectionError("TTS socket failed before the final event")
                except Exception:
                    logger.warning("TTS turn did not complete on the socket, using REST", exc_info=True)
                    await self._fallback(turn)
            if turn.rest_queue is not None and turn.rest_task is not None:
                turn.rest_queue.put_nowait(None)
                await turn.rest_task
        finally:
            if self._turn is turn:
                self._turn = None

    async def cancel_turn(self) -> None:
        """Barge-in or stop: drop the turn's audio and close the socket."""
        turn, self._turn = self._turn, None
        if turn is not None and turn.rest_task is not None:
            turn.rest_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await turn.rest_task
        await self._close_socket()

    async def close(self) -> None:
        self.closed = True
        await self.cancel_turn()

    # ---------------------------------------------------------------- socket

    async def _ensure_socket(self, language: str) -> None:
        reusable = (
            self._conn is not None
            and self._conn_language == language
            and self._recv_task is not None
            and not self._recv_task.done()
        )
        if reusable:
            return
        await self._close_socket()
        qs = urlencode({"model": self.model, "send_completion_event": "true"})
        conn = await websockets.connect(
            f"{self.base_url}?{qs}", additional_headers={"Api-Subscription-Key": self.api_key}
        )
        self._conn = conn
        self._conn_language = language
        await conn.send(
            json.dumps(
                {
                    "type": "config",
                    "data": {
                        "target_language_code": language,
                        "speaker": self.speaker,
                        "pace": 1.05,
                        "temperature": 0.45,
                        "speech_sample_rate": str(SAMPLE_RATE_HZ),
                        "output_audio_codec": "linear16",
                        "min_buffer_size": 30,
                        "max_chunk_length": 150,
                    },
                }
            )
        )
        self._recv_task = asyncio.create_task(self._recv_loop(conn))
        if self.ping_interval > 0:
            self._ping_task = asyncio.create_task(self._ping_loop(conn))

    async def _close_socket(self) -> None:
        conn, self._conn, self._conn_language = self._conn, None, None
        for task in (self._recv_task, self._ping_task):
            if task is not None and task is not asyncio.current_task():
                task.cancel()
        self._recv_task = self._ping_task = None
        if conn is not None:
            with contextlib.suppress(Exception):
                await conn.close()

    async def _recv_loop(self, conn: Any) -> None:
        try:
            async for raw in conn:
                try:
                    msg = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                await self._on_message(msg)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("TTS receive loop ended with an error", exc_info=True)
        # Socket closed or failed: wake a waiting turn so it can fall back.
        turn = self._turn
        if turn is not None and not turn.final.is_set():
            turn.failed = True
            turn.final.set()

    async def _on_message(self, msg: dict[str, Any]) -> None:
        turn = self._turn
        kind = msg.get("type")
        data = msg.get("data") or {}
        if turn is None:
            return
        if kind == "audio" and data.get("audio"):
            b64 = data["audio"]
            turn.audio_bytes += len(b64) * 3 // 4
            chunk = AudioChunk(b64, "pcm_s16le", SAMPLE_RATE_HZ, turn.seq)
            turn.seq += 1
            await turn.on_audio(chunk)
        elif kind == "event" and data.get("event_type") == "final":
            turn.final.set()
        elif kind == "error":
            logger.warning("TTS socket reported an error: %s", data)
            turn.failed = True
            turn.final.set()

    async def _ping_loop(self, conn: Any) -> None:
        try:
            while True:
                await asyncio.sleep(self.ping_interval)
                if self._turn is None:
                    await conn.send(json.dumps({"type": "ping"}))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("TTS ping loop ended", exc_info=True)

    # ------------------------------------------------------------------ REST

    def _start_rest(self, turn: _Turn, pending: list[str] | None = None) -> None:
        turn.rest_queue = asyncio.Queue()
        for s in pending or []:
            turn.rest_queue.put_nowait(s)
        turn.rest_task = asyncio.create_task(self._rest_worker(turn))

    async def _fallback(self, turn: _Turn) -> None:
        """Move the rest of the turn to REST TTS after a socket failure."""
        if turn.rest_queue is not None:
            return
        self._enter_rest_mode()
        spoken_chars = (turn.audio_bytes / (SAMPLE_RATE_HZ * 2)) * _CHARS_PER_SECOND
        total = 0
        start = len(turn.sentences)
        for i, s in enumerate(turn.sentences):
            total += len(s)
            if total > spoken_chars:
                start = i
                break
        await self._close_socket()
        self._start_rest(turn, turn.sentences[start:])

    async def _rest_worker(self, turn: _Turn) -> None:
        synth = self._rest_synthesize or sarvam_tts.synthesize
        assert turn.rest_queue is not None
        while True:
            sentence = await turn.rest_queue.get()
            if sentence is None:
                return
            try:
                result = await synth(
                    api_key=self.api_key,
                    text=sentence,
                    speaker=self.speaker,
                    model=self.model,
                    language=turn.language,
                )
            except Exception:
                logger.exception("REST TTS failed for a sentence")
                continue
            chunk = AudioChunk(result.wav_base64, "wav", result.sample_rate_hz, turn.seq)
            turn.seq += 1
            await turn.on_audio(chunk)
