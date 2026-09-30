"""Metrics, timeouts, retries and spoken fallbacks (task B7). Sarvam is mocked."""

import asyncio
from unittest.mock import AsyncMock

import httpx
import pytest

from app.tools.v2 import ToolResult
from app.voice import sarvam_chat
from app.voice import session as session_mod
from app.voice.sarvam_chat import SarvamHTTPError
from tests.test_voice_fakes import (
    ChatScript,
    FakeTts,
    make_session,
    run_typed,
    text_delta,
    tool_delta,
)

FALLBACK_EN = "Sorry, I could not reach the data service. Please try again."


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _use(monkeypatch, script: ChatScript) -> ChatScript:
    monkeypatch.setattr(sarvam_chat, "stream_chat", script)
    return script


class Sleeps:
    """Records the delays a session asked for instead of sleeping."""

    def __init__(self):
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


# ------------------------------------------------------------------ metrics


@pytest.mark.anyio
async def test_turn_end_metrics_use_the_end_of_speech_clock(monkeypatch):
    now = [1000.0]

    def advance(seconds: float):
        return lambda: now.__setitem__(0, now[0] + seconds)

    _use(
        monkeypatch,
        ChatScript(
            [advance(0.4), text_delta("Hi there. "), advance(0.6), text_delta("Bye now.")],
        ),
    )
    session, frames, _ = make_session(tools={}, clock=lambda: now[0])
    await run_typed(session, "hello")
    metrics = frames.of("turn_end")[0]["metrics"]
    assert metrics == {
        "finalToFirstTokenMs": 400,
        "finalToFirstAudioMs": 400,
        "finalToFirstAnswerAudioMs": 400,
        "totalMs": 1000,
        "tools": [],
    }


@pytest.mark.anyio
async def test_metrics_list_tools_and_tolerate_missing_audio(monkeypatch):
    _use(monkeypatch, ChatScript([tool_delta("t")], [text_delta("Done.")]))
    session, frames, _ = make_session(tools={"t": lambda: ToolResult({"a": 1})}, tts=None, speak=False)
    await run_typed(session, "go")
    m = frames.of("turn_end")[0]["metrics"]
    assert m["tools"] == ["t"] and m["finalToFirstAudioMs"] is None and m["totalMs"] >= 0


# ------------------------------------------------------------------ retries


@pytest.mark.anyio
async def test_retry_once_on_429_with_small_retry_after(monkeypatch):
    script = _use(
        monkeypatch,
        ChatScript(SarvamHTTPError(429, "slow down", 2.0), [text_delta("Second try worked.")]),
    )
    sleeps = Sleeps()
    session, frames, _ = make_session(tools={}, sleep=sleeps)
    await run_typed(session, "hello")
    assert len(script.calls) == 2
    assert sleeps.delays == [2.0]
    assert frames.of("error") == []
    assert frames.of("reply")[0]["text"] == "Second try worked."


@pytest.mark.anyio
async def test_retry_once_on_503_without_retry_after_header(monkeypatch):
    script = _use(monkeypatch, ChatScript(SarvamHTTPError(503, "unavailable", None), [text_delta("Back.")]))
    sleeps = Sleeps()
    session, frames, _ = make_session(tools={}, sleep=sleeps)
    await run_typed(session, "hello")
    assert len(script.calls) == 2 and sleeps.delays == [session_mod.DEFAULT_RETRY_DELAY_S]
    assert frames.of("reply")[0]["text"] == "Back."


@pytest.mark.anyio
async def test_retry_happens_only_once(monkeypatch):
    script = _use(
        monkeypatch,
        ChatScript(SarvamHTTPError(429, "x", 0.0), SarvamHTTPError(429, "x", 0.0), [text_delta("never")]),
    )
    session, frames, tts = make_session(tools={}, sleep=Sleeps())
    await run_typed(session, "hello")
    assert len(script.calls) == 2
    assert frames.of("error")[0]["code"] == "llm_busy"
    assert tts.said == [FALLBACK_EN]


@pytest.mark.anyio
async def test_no_retry_when_retry_after_is_over_three_seconds(monkeypatch):
    script = _use(monkeypatch, ChatScript(SarvamHTTPError(429, "x", 4.0), [text_delta("never")]))
    sleeps = Sleeps()
    session, frames, tts = make_session(tools={}, sleep=sleeps)
    await run_typed(session, "hello")
    assert len(script.calls) == 1 and sleeps.delays == []
    assert frames.of("error")[0]["code"] == "llm_busy"
    assert tts.said == [FALLBACK_EN]


@pytest.mark.anyio
@pytest.mark.parametrize("status", [400, 401, 404, 422])
async def test_never_retry_4xx_client_errors(monkeypatch, status):
    script = _use(monkeypatch, ChatScript(SarvamHTTPError(status, "bad request", 0.0), [text_delta("never")]))
    sleeps = Sleeps()
    session, frames, tts = make_session(tools={}, sleep=sleeps)
    await run_typed(session, "hello")
    assert len(script.calls) == 1 and sleeps.delays == []
    err = frames.of("error")[0]
    assert err["code"] == "llm_error" and err["fatal"] is False
    assert tts.said == [FALLBACK_EN]
    assert frames.of("turn_end")


@pytest.mark.anyio
async def test_no_retry_when_the_turn_is_no_longer_current(monkeypatch):
    script = _use(monkeypatch, ChatScript(SarvamHTTPError(429, "x", 1.0), [text_delta("never")]))
    release = asyncio.Event()

    async def blocked_sleep(_delay: float) -> None:
        await release.wait()

    session, frames, _ = make_session(tools={}, sleep=blocked_sleep)
    await session.handle_typed_text("hello")
    await asyncio.sleep(0.05)  # the first call failed, the retry is waiting
    await session.interrupt()
    assert len(script.calls) == 1
    assert frames.of("interrupted") and frames.of("reply") == []


@pytest.mark.anyio
async def test_retry_covers_the_answer_call_after_tools(monkeypatch):
    script = _use(
        monkeypatch,
        ChatScript([tool_delta("t")], SarvamHTTPError(503, "x", 1.0), [text_delta("Answer after retry.")]),
    )
    session, frames, _ = make_session(tools={"t": lambda: ToolResult({"a": 1})}, sleep=Sleeps())
    await run_typed(session, "go")
    assert [c["tool_choice"] for c in script.calls] == ["auto", "none", "none"]
    assert frames.of("reply")[0]["text"] == "Answer after retry."
    assert len(frames.of("tool")) == 1  # the tool round is not repeated


@pytest.mark.anyio
async def test_retry_covers_non_streaming_planning(monkeypatch):
    complete = AsyncMock(
        side_effect=[SarvamHTTPError(429, "x", 0.0), sarvam_chat.ChatResult("Plain answer.", None, "stop")]
    )
    monkeypatch.setattr(sarvam_chat, "chat_completion", complete)
    session, frames, _ = make_session(tools={}, sleep=Sleeps(), sarvam_stream_with_tools=False)
    await run_typed(session, "hello")
    assert complete.await_count == 2
    assert frames.of("reply")[0]["text"] == "Plain answer."


# ---------------------------------------------------------------- timeouts


@pytest.mark.anyio
async def test_planning_timeout_produces_a_spoken_fallback(monkeypatch):
    monkeypatch.setattr(session_mod, "LLM_TIMEOUT_S", 0.05)
    _use(monkeypatch, ChatScript([3600.0]))
    session, frames, tts = make_session(tools={})
    await run_typed(session, "hello")
    assert frames.of("error")[0]["code"] == "llm_timeout"
    assert tts.said == [FALLBACK_EN]
    assert frames.of("reply")[0]["text"] == FALLBACK_EN
    assert frames.of("turn_end")


@pytest.mark.anyio
async def test_answer_timeout_after_tools_speaks_the_fallback(monkeypatch):
    monkeypatch.setattr(session_mod, "LLM_TIMEOUT_S", 0.1)
    _use(monkeypatch, ChatScript([tool_delta("t")], [3600.0]))
    session, frames, tts = make_session(tools={"t": lambda: ToolResult({"a": 1})})
    await run_typed(session, "go")
    assert frames.of("error")[0]["code"] == "llm_timeout"
    assert tts.said == [FALLBACK_EN]
    assert [m["role"] for m in session.history] == ["system", "user", "assistant"]


@pytest.mark.anyio
async def test_fallback_is_spoken_in_the_turn_language(monkeypatch):
    _use(monkeypatch, ChatScript(SarvamHTTPError(400, "bad", None)))
    session, frames, tts = make_session(tools={})
    await run_typed(session, "Kota district mein kya haal hai?")
    assert tts.language == "hi-IN"
    assert tts.said == [session_mod.fallback_text("hi-IN")]
    assert frames.of("reply")[0]["language"] == "hi-IN"


@pytest.mark.anyio
async def test_a_partial_answer_is_kept_when_the_stream_fails_midway(monkeypatch):
    _use(monkeypatch, ChatScript([text_delta("Kota has two problems. "), SarvamHTTPError(500, "boom", None)]))
    session, frames, tts = make_session(tools={})
    await run_typed(session, "hello")
    assert tts.said == ["Kota has two problems.", FALLBACK_EN]
    assert frames.of("error")[0]["code"] == "llm_error"


@pytest.mark.anyio
async def test_tts_timeout_reports_an_error_but_still_delivers_the_text(monkeypatch):
    monkeypatch.setattr(session_mod, "TTS_TIMEOUT_S", 0.05)
    _use(monkeypatch, ChatScript([text_delta("Text still arrives.")]))
    hung = FakeTts(hang_begin=True)
    session, frames, _ = make_session(tools={}, tts=hung)
    await run_typed(session, "hello")
    errors = frames.of("error")
    assert [e["code"] for e in errors] == ["tts_timeout"]  # reported once
    assert frames.of("reply")[0]["text"] == "Text still arrives."
    assert frames.of("audio") == [] and frames.of("turn_end")
    assert hung.cancelled >= 1


@pytest.mark.anyio
async def test_tts_end_turn_timeout_is_reported(monkeypatch):
    monkeypatch.setattr(session_mod, "TTS_TIMEOUT_S", 0.05)
    _use(monkeypatch, ChatScript([text_delta("Hello there.")]))

    class SlowEnd(FakeTts):
        async def end_turn(self):
            await asyncio.sleep(3600)

    session, frames, _ = make_session(tools={}, tts=SlowEnd())
    await run_typed(session, "hello")
    assert [e["code"] for e in frames.of("error")] == ["tts_timeout"]
    assert frames.of("turn_end")


# --------------------------------------------------- non streaming adapter


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.anyio
async def test_chat_completion_raises_http_error_with_retry_after():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"retry-after": "2"}, text="rate limited")

    with pytest.raises(SarvamHTTPError) as info:
        await sarvam_chat.chat_completion(
            api_key="k", model="m", messages=[], tools=[], client=_client(handler)
        )
    assert info.value.status_code == 429 and info.value.retry_after == 2.0
    assert isinstance(info.value, RuntimeError)  # protocol 1 code catches Exception


@pytest.mark.anyio
async def test_chat_completion_success_and_missing_retry_after():
    def ok(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "hi", "tool_calls": None}, "finish_reason": "stop"}]}
        )

    res = await sarvam_chat.chat_completion(api_key="k", model="m", messages=[], tools=[], client=_client(ok))
    assert res.content == "hi" and res.finish_reason == "stop"

    def bad(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="down")

    with pytest.raises(SarvamHTTPError) as info:
        await sarvam_chat.chat_completion(api_key="k", model="m", messages=[], tools=[], client=_client(bad))
    assert info.value.retry_after is None
