"""Shared fakes for the voice session tests. Sarvam is never called."""

import asyncio
import base64
from typing import Any

from app.api import deps
from app.core.config import get_settings
from app.tools.v2 import ToolResult
from app.voice import sarvam_chat, sarvam_tts
from app.voice.sarvam_chat import ChatDelta
from app.voice.sarvam_tts_ws import AudioChunk
from app.voice.session import VoiceSession

PCM_B64 = base64.b64encode(b"\x01\x00" * 480).decode()


def text_delta(text: str) -> ChatDelta:
    return ChatDelta(content=text)


def tool_delta(name: str, args: str = "{}", call_id: str = "call_1", index: int = 0) -> ChatDelta:
    return ChatDelta(
        tool_calls=[{"index": index, "id": call_id, "function": {"name": name, "arguments": args}}],
        finish_reason="tool_calls",
    )


class ChatScript:
    """Stands in for `sarvam_chat.stream_chat`. Each call consumes one response:
    a list of ChatDelta, an Exception (raised), a float (sleep) or an Event (wait)."""

    def __init__(self, *responses: list[Any] | Exception):
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, **kw: Any):
        self.calls.append(
            {
                "tool_choice": kw.get("tool_choice"),
                "messages": [dict(m) for m in kw["messages"]],
                "max_tokens": kw.get("max_tokens"),
            }
        )
        resp = self.responses.pop(0)
        if isinstance(resp, Exception):
            raise resp
        for item in resp:
            if isinstance(item, Exception):
                raise item
            if callable(item):
                item()
            elif isinstance(item, (int, float)):
                await asyncio.sleep(item)
            elif isinstance(item, asyncio.Event):
                await item.wait()
            else:
                yield item


class FakeTts:
    """Records the calls a session makes on a `TtsStream` and emits one PCM chunk per sentence."""

    mode = "ws"

    def __init__(self, *, hang_begin: bool = False):
        self.language: str | None = None
        self.said: list[str] = []
        self.begun = 0
        self.ended = 0
        self.cancelled = 0
        self.closed = False
        self.hang_begin = hang_begin
        self._on_audio = None
        self._seq = 0

    async def begin_turn(self, language, on_audio):
        self.begun += 1
        self.language = language
        self._on_audio = on_audio
        self._seq = 0
        if self.hang_begin:
            await asyncio.sleep(3600)

    async def say(self, sentence):
        self.said.append(sentence)
        if self._on_audio is not None:
            await self._on_audio(AudioChunk(PCM_B64, "pcm_s16le", 24000, self._seq))
            self._seq += 1

    async def end_turn(self):
        self.ended += 1

    async def cancel_turn(self):
        self.cancelled += 1

    async def close(self):
        self.closed = True


class Frames:
    def __init__(self):
        self.items: list[dict[str, Any]] = []

    async def __call__(self, frame):
        self.items.append(frame)

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [f for f in self.items if f["t"] == kind]

    def kinds(self) -> list[str]:
        return [f["t"] for f in self.items]


def make_session(tools=None, tts="default", speak=True, clock=None, sleep=None, **overrides) -> tuple[VoiceSession, Frames, FakeTts | None]:
    frames = Frames()
    settings = get_settings().model_copy(
        update={"sarvam_api_key": "test-key", "sarvam_stream_with_tools": True, **overrides}
    )
    fake_tts = FakeTts() if tts == "default" else tts
    session = VoiceSession(
        settings=settings,
        district=deps.get_district_service(),
        forecast=deps.get_forecast_service(),
        recommendation=deps.get_recommendation_service(),
        send=frames,
        protocol=2,
        tools=tools,
        tts=fake_tts,
        speak=speak,
        **({"clock": clock} if clock else {}),
        **({"sleep": sleep} if sleep else {}),
    )
    session.history = [{"role": "system", "content": "SYSTEM"}]
    return session, frames, fake_tts


async def run_typed(session: VoiceSession, text: str, client_turn_id: str | None = None) -> None:
    """Send typed text and wait for the turn to finish (or be cancelled)."""
    await session.handle_typed_text(text, client_turn_id)
    turn = session.turns.current
    assert turn is not None and turn.task is not None
    await asyncio.wait_for(asyncio.shield(_wait(turn.task)), 5)


async def _wait(task: asyncio.Task) -> None:
    try:
        await task
    except asyncio.CancelledError:
        pass


def district_tool(name: str = "Kota") -> ToolResult:
    return ToolResult(
        {"district": name, "critical": 2},
        {"type": "district_summary", "district_id": "district_kota", "name": name},
    )


def wav_synthesis() -> sarvam_tts.WavSynthesis:
    return sarvam_tts.WavSynthesis(wav_base64=PCM_B64, sample_rate_hz=24000)


__all__ = [
    "ChatScript",
    "FakeTts",
    "Frames",
    "district_tool",
    "make_session",
    "run_typed",
    "sarvam_chat",
    "text_delta",
    "tool_delta",
    "wav_synthesis",
]
