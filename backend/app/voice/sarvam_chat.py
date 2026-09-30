"""Sarvam chat completions: non-streaming (`chat_completion`) and streaming
(`stream_chat`), with the tool schema always available.

reasoning_effort is explicitly disabled: Sarvam's reasoning is ON by default,
and leaving it on adds seconds to every reply, which would make a voice
control-room demo feel broken. Probe P0.2 showed streaming works together with
tools: a tool call arrives as `delta.tool_calls` and text as `delta.content`.

Ported from the verified contract in nari-kavach/apps/relay/src/sarvam/chat.ts.
"""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx

SARVAM_CHAT_URL = "https://api.sarvam.ai/v1/chat/completions"


@dataclass
class ChatResult:
    content: str | None
    tool_calls: list[dict[str, Any]] | None
    finish_reason: str


def _retry_after(res: httpx.Response) -> float | None:
    try:
        return float(res.headers.get("retry-after", ""))
    except ValueError:
        return None


async def chat_completion(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    timeout: float = 20.0,
    client: httpx.AsyncClient | None = None,
) -> ChatResult:
    """Non-streaming call. A non-200 answer raises `SarvamHTTPError` (a
    RuntimeError) carrying `status_code` and `retry_after` for the retry policy."""
    own = client is None
    http = client or httpx.AsyncClient(timeout=timeout)
    try:
        res = await http.post(
            SARVAM_CHAT_URL,
            headers={
                "api-subscription-key": api_key,
                "content-type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "temperature": 0.4,
                "max_tokens": 220,
                "reasoning_effort": None,
                "tools": tools,
                "tool_choice": "auto",
                "stream": False,
            },
        )
    finally:
        if own:
            await http.aclose()
    if res.status_code != 200:
        raise SarvamHTTPError(res.status_code, res.text, _retry_after(res))

    data = res.json()
    choice = data["choices"][0]
    message = choice["message"]
    return ChatResult(
        content=message.get("content"),
        tool_calls=message.get("tool_calls"),
        finish_reason=choice.get("finish_reason", ""),
    )


class SarvamHTTPError(RuntimeError):
    """A non-200 answer from Sarvam, carrying what the retry policy needs."""

    def __init__(self, status_code: int, body: str, retry_after: float | None = None):
        super().__init__(f"Sarvam chat completion failed ({status_code}): {body[:300]}")
        self.status_code = status_code
        self.retry_after = retry_after


@dataclass
class ChatDelta:
    """One parsed streaming chunk. `tool_calls` holds the raw OpenAI deltas
    (`index`, optional `id`, `function.name`, `function.arguments` fragment)."""

    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    finish_reason: str | None = None


@dataclass
class ToolCallAccumulator:
    """Concatenates streamed tool call fragments by `index`."""

    _calls: dict[int, dict[str, Any]] = field(default_factory=dict)

    def add(self, deltas: list[dict[str, Any]] | None) -> None:
        for d in deltas or []:
            idx = d.get("index", 0)
            call = self._calls.setdefault(
                idx, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
            )
            if d.get("id"):
                call["id"] = d["id"]
            fn = d.get("function") or {}
            if fn.get("name"):
                call["function"]["name"] += fn["name"]
            if fn.get("arguments"):
                call["function"]["arguments"] += fn["arguments"]

    def result(self) -> list[dict[str, Any]]:
        return [self._calls[i] for i in sorted(self._calls)]


DONE = "[DONE]"


def parse_sse_line(line: str) -> ChatDelta | str | None:
    """Parse one SSE line: a ChatDelta, None for lines to skip (blank, comment,
    usage-only chunk), or the string "[DONE]" at the end of the stream."""
    line = line.strip()
    if not line.startswith("data:"):
        return None
    payload = line[5:].strip()
    if payload == DONE:
        return DONE
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    choices = data.get("choices") or []
    if not choices:  # the trailing usage chunk has no choices
        return None
    choice = choices[0]
    delta = choice.get("delta") or {}
    content = delta.get("content") or None
    tool_calls = delta.get("tool_calls") or None
    finish = choice.get("finish_reason")
    if content is None and tool_calls is None and finish is None:
        return None
    return ChatDelta(content=content, tool_calls=tool_calls, finish_reason=finish)


async def stream_chat(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str = "auto",
    max_tokens: int = 320,
    temperature: float = 0.3,
    timeout: float = 15.0,
    client: httpx.AsyncClient | None = None,
) -> AsyncIterator[ChatDelta]:
    """Stream a chat completion, yielding `ChatDelta`s until `[DONE]`.

    Pass `client` (for example one built on `httpx.MockTransport`) in tests.
    """
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "reasoning_effort": None,
        "stream": True,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = tool_choice
    headers = {"api-subscription-key": api_key, "content-type": "application/json"}
    own = client is None
    http = client or httpx.AsyncClient(timeout=timeout)
    try:
        async with http.stream("POST", SARVAM_CHAT_URL, headers=headers, json=body) as res:
            if res.status_code != 200:
                text = (await res.aread()).decode("utf-8", "replace")
                raise SarvamHTTPError(res.status_code, text, _retry_after(res))
            async for line in res.aiter_lines():
                parsed = parse_sse_line(line)
                if parsed == DONE:
                    return
                if isinstance(parsed, ChatDelta):
                    yield parsed
    finally:
        if own:
            await http.aclose()
