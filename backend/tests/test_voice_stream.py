"""Streaming chat adapter and sentence segmenter, replaying the probe fixtures
through httpx.MockTransport. No network."""

import json
from pathlib import Path

import httpx
import pytest

from app.voice.sarvam_chat import (
    ChatDelta,
    SarvamHTTPError,
    ToolCallAccumulator,
    parse_sse_line,
    stream_chat,
)
from app.voice.segmenter import SentenceSegmenter


@pytest.fixture
def anyio_backend():
    return "asyncio"


FIXTURES = Path(__file__).resolve().parents[2] / "docs" / "probes" / "fixtures"


def _client(body: str, status: int = 200, headers: dict | None = None, seen: list | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(
            status, text=body, headers={"content-type": "text/event-stream", **(headers or {})}
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def _collect(fixture: str, **kw) -> list[ChatDelta]:
    body = (FIXTURES / fixture).read_text(encoding="utf-8")
    async with _client(body) as client:
        return [
            d
            async for d in stream_chat(
                api_key="k", model="m", messages=[{"role": "user", "content": "hi"}], client=client, **kw
            )
        ]


@pytest.mark.anyio
async def test_plain_stream_yields_text_and_finish():
    deltas = await _collect("chat_stream.txt")
    text = "".join(d.content or "" for d in deltas)
    assert text.startswith("Hello")
    assert deltas[-1].finish_reason == "stop"
    assert all(d.tool_calls is None for d in deltas)


@pytest.mark.anyio
async def test_tool_call_stream_accumulates_arguments():
    deltas = await _collect("chat_stream_tools.txt", tools=[{"type": "function"}])
    acc = ToolCallAccumulator()
    for d in deltas:
        acc.add(d.tool_calls)
    calls = acc.result()
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "list_districts"
    assert json.loads(calls[0]["function"]["arguments"]) == {}
    assert calls[0]["id"].startswith("chatcmpl-tool-")
    assert deltas[-1].finish_reason == "tool_calls"


@pytest.mark.anyio
async def test_tool_choice_none_stream_and_usage_chunk_ignored():
    deltas = await _collect(
        "chat_stream_tool_choice_none.txt", tools=[{"type": "function"}], tool_choice="none"
    )
    text = "".join(d.content or "" for d in deltas)
    assert "critical facilities" in text
    assert "**2 critical facilities**" in text  # markdown survives; prepare_speech strips it


def test_accumulator_concatenates_split_fragments_by_index():
    acc = ToolCallAccumulator()
    acc.add([{"index": 0, "id": "a", "function": {"name": "get_shortages", "arguments": '{"dist'}}])
    acc.add([{"index": 1, "id": "b", "function": {"name": "get_fleet_status", "arguments": "{}"}}])
    acc.add([{"index": 0, "function": {"arguments": 'rict": "Kota"}'}}])
    calls = acc.result()
    assert [c["id"] for c in calls] == ["a", "b"]
    assert json.loads(calls[0]["function"]["arguments"]) == {"district": "Kota"}


def test_parse_sse_line_skips_noise():
    assert parse_sse_line("") is None
    assert parse_sse_line(": keep-alive") is None
    assert parse_sse_line("...") is None
    assert parse_sse_line("data: not json") is None
    assert parse_sse_line('data: {"choices": []}') is None
    assert parse_sse_line("data: [DONE]") == "[DONE]"
    d = parse_sse_line('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}')
    assert isinstance(d, ChatDelta) and d.content == "Hi"


@pytest.mark.anyio
async def test_stream_stops_at_done_and_sends_expected_request():
    body = (
        'data: {"choices":[{"delta":{"content":"A"},"finish_reason":null}]}\n\n'
        "data: [DONE]\n\n"
        'data: {"choices":[{"delta":{"content":"NEVER"},"finish_reason":null}]}\n\n'
    )
    seen: list[httpx.Request] = []
    async with _client(body, seen=seen) as client:
        out = [
            d
            async for d in stream_chat(
                api_key="secret", model="m", messages=[], tools=[{"type": "function"}],
                tool_choice="none", max_tokens=320, client=client,
            )
        ]  # fmt: skip
    assert [d.content for d in out] == ["A"]
    req = seen[0]
    assert req.headers["api-subscription-key"] == "secret"
    payload = json.loads(req.content)
    assert payload["stream"] is True
    assert payload["reasoning_effort"] is None
    assert payload["tool_choice"] == "none"
    assert payload["max_tokens"] == 320


@pytest.mark.anyio
async def test_http_error_carries_status_and_retry_after():
    async with _client("busy", status=429, headers={"retry-after": "2"}) as client:
        with pytest.raises(SarvamHTTPError) as exc:
            async for _ in stream_chat(api_key="k", model="m", messages=[], client=client):
                pass
    assert exc.value.status_code == 429
    assert exc.value.retry_after == 2.0


def _segment(chunks: list[str]) -> list[str]:
    seg = SentenceSegmenter()
    out: list[str] = []
    for c in chunks:
        out.extend(seg.feed(c))
    rest = seg.flush()
    if rest:
        out.append(rest)
    return out


def test_segmenter_basic_sentences_across_chunks():
    got = _segment(["Kota has two", " critical facilities. ", "PHC Kota-4 is worst", "! Any more?"])
    assert got == ["Kota has two critical facilities.", "PHC Kota-4 is worst!", "Any more?"]


def test_segmenter_holds_terminator_until_next_char_arrives():
    seg = SentenceSegmenter()
    assert seg.feed("It is 2.") == []
    assert seg.feed("5 percent. ") == ["It is 2.5 percent."]


def test_segmenter_decimals():
    assert _segment(["Cover is 2.5 days. Next."]) == ["Cover is 2.5 days.", "Next."]


def test_segmenter_abbreviations():
    got = _segment(["Dr. Meera Singh is absent. e.g. on Mondays. Mr. Rao agrees."])
    assert got == ["Dr. Meera Singh is absent.", "e.g. on Mondays.", "Mr. Rao agrees."]
    got = _segment(["It is No. 4 in the list vs. last week. Done."])
    assert got == ["It is No. 4 in the list vs. last week.", "Done."]


def test_segmenter_devanagari_danda():
    got = _segment(["कोटा में दो सुविधाएं गंभीर हैं। आगे बताऊं? ठीक है।"])
    assert got == ["कोटा में दो सुविधाएं गंभीर हैं।", "आगे बताऊं?", "ठीक है।"]


def test_segmenter_cuts_long_text_at_comma_then_space():
    long_clause = ("word " * 20 + "end,") + " " + ("more " * 40)
    out = _segment([long_clause])
    assert all(len(s) <= 180 for s in out)
    assert " ".join(out).split() == long_clause.split()
    on_comma = _segment(["a" * 170 + ",abc" + "b" * 30])
    assert on_comma[0] == "a" * 170 + ","
    no_comma = _segment(["alpha " * 60])
    assert all(len(s) <= 180 for s in no_comma)
    assert " ".join(no_comma).split() == ("alpha " * 60).split()


def test_segmenter_flush_returns_remainder_and_resets():
    seg = SentenceSegmenter()
    assert seg.feed("No terminator here") == []
    assert seg.flush() == "No terminator here"
    assert seg.flush() == ""


def test_segmenter_ellipsis_and_multiple_terminators():
    assert _segment(["Wait... what?! Yes."]) == ["Wait...", "what?!", "Yes."]
