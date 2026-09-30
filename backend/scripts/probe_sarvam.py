"""One-off contract probes against the live Sarvam API (budget: about 10 calls).

Run from backend/: python scripts/probe_sarvam.py <chat-stream|chat-stream-tools|
chat-stream-tool-choice-none|tts-ws|stt-realtime>. Raw evidence is written under
docs/probes/fixtures. The API key is read from settings and never printed.
"""

import asyncio
import base64
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import httpx
import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.tools.schemas import TOOL_SCHEMAS
from app.voice.sarvam_tts import parse_wav_header, synthesize

FIX = Path(__file__).resolve().parents[2] / "docs" / "probes" / "fixtures"
CHAT_URL = "https://api.sarvam.ai/v1/chat/completions"


def _key() -> str:
    key = get_settings().sarvam_api_key
    if not key:
        sys.exit("SARVAM_API_KEY is not set")
    return key


async def _stream(messages, tools=None, tool_choice=None) -> tuple[list[str], int]:
    body = {
        "model": get_settings().sarvam_chat_model,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 200,
        "reasoning_effort": None,
        "stream": True,
    }
    if tools is not None:
        body["tools"] = tools
    if tool_choice is not None:
        body["tool_choice"] = tool_choice
    lines: list[str] = []
    async with httpx.AsyncClient(timeout=30.0) as c, c.stream(
        "POST",
        CHAT_URL,
        json=body,
        headers={"api-subscription-key": _key(), "content-type": "application/json"},
    ) as r:
        status = r.status_code
        if status != 200:
            lines.append((await r.aread()).decode()[:400])
        else:
            async for line in r.aiter_lines():
                lines.append(line)
    return lines, status


def _save(name: str, lines: list[str]) -> None:
    FIX.mkdir(parents=True, exist_ok=True)
    (FIX / name).write_text("\n".join(lines), encoding="utf-8")


def _deltas(lines):
    for ln in lines:
        if ln.startswith("data:") and "[DONE]" not in ln:
            try:
                yield json.loads(ln[5:].strip())
            except ValueError:
                pass


def _content(lines) -> str:
    return "".join(
        (d["choices"][0].get("delta") or {}).get("content") or ""
        for d in _deltas(lines)
        if d.get("choices")
    )


async def chat_stream():
    lines, status = await _stream([{"role": "user", "content": "Say hello in one short sentence."}])
    _save("chat_stream.txt", lines[:5] + ["..."] + lines[-3:])
    print("status", status, "lines", len(lines), "text:", _content(lines))


async def chat_stream_tools():
    lines, status = await _stream(
        [{"role": "user", "content": "How many facilities are critical in Kota district?"}],
        tools=TOOL_SCHEMAS,
        tool_choice="auto",
    )
    _save("chat_stream_tools.txt", lines[:30])
    tc = [
        (d["choices"][0].get("delta") or {}).get("tool_calls")
        for d in _deltas(lines)
        if d.get("choices")
    ]
    tc = [t for t in tc if t]
    print("status", status, "lines", len(lines), "tool_call_deltas", len(tc))
    print("first tool delta:", json.dumps(tc[0]) if tc else None)
    args = "".join((t[0].get("function") or {}).get("arguments") or "" for t in tc)
    print("joined args:", args)
    print("content:", _content(lines)[:200])


async def chat_stream_tool_choice_none():
    msgs = [
        {"role": "user", "content": "How many facilities are critical in Kota district?"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "get_district_overview",
                        "arguments": json.dumps({"district_id": "district_kota"}),
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_1",
            "content": json.dumps({"district": "Kota", "critical": 2, "stress": 1}),
        },
    ]
    lines, status = await _stream(msgs, tools=TOOL_SCHEMAS, tool_choice="none")
    _save("chat_stream_tool_choice_none.txt", lines[:12])
    print("status", status, "text:", _content(lines)[:200], "| raw head:", lines[0][:200] if lines else "")


async def tts_ws():
    s = get_settings()
    url = "wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true"
    t0 = time.perf_counter()
    kinds: list[str] = []
    total = 0
    first_bytes = b""
    first_at = None
    async with websockets.connect(url, additional_headers={"Api-Subscription-Key": _key()}) as ws:
        cfg = {
            "target_language_code": "en-IN",
            "speaker": s.sarvam_speaker.lower(),
            "pace": 1.05,
            "temperature": 0.45,
            "speech_sample_rate": "24000",
            "output_audio_codec": "linear16",
            "min_buffer_size": 30,
            "max_chunk_length": 150,
        }
        await ws.send(json.dumps({"type": "config", "data": cfg}))
        text = "Kota has two critical facilities right now."
        await ws.send(json.dumps({"type": "text", "data": {"text": text}}))
        await ws.send(json.dumps({"type": "flush"}))
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), 15)
                msg = json.loads(raw)
                data = msg.get("data") or {}
                kinds.append(str(msg.get("type")) + ":" + str(data.get("event_type", "")))
                if msg.get("type") == "audio":
                    b = base64.b64decode(data["audio"])
                    total += len(b)
                    if first_at is None:
                        first_at = time.perf_counter() - t0
                        first_bytes = b[:12]
                if msg.get("type") == "event" and data.get("event_type") == "final":
                    break
                if msg.get("type") == "error":
                    print("error msg:", json.dumps(msg)[:300])
                    break
        except TimeoutError:
            print("timeout")
    print("messages:", kinds[:12], "count", len(kinds))
    print("total audio bytes", total, "head", first_bytes, "starts RIFF:", first_bytes[:4] == b"RIFF")
    print("time to first audio (s)", first_at)


def _resample_16k(pcm: bytes, src: int) -> bytes:
    import array

    a = array.array("h")
    a.frombytes(pcm)
    n = int(len(a) * 16000 / src)
    out = array.array("h")
    for i in range(n):
        pos = i * src / 16000
        j = int(pos)
        f = pos - j
        x0 = a[j]
        x1 = a[min(j + 1, len(a) - 1)]
        out.append(int(x0 + (x1 - x0) * f))
    return out.tobytes()


async def stt_realtime():
    s = get_settings()
    syn = await synthesize(
        api_key=_key(),
        text="Kota mein kitni facilities critical hain",
        speaker=s.sarvam_speaker,
        model=s.sarvam_tts_model,
        language="hi-IN",
    )
    wav = parse_wav_header(base64.b64decode(syn.wav_base64))
    pcm = _resample_16k(wav.pcm, wav.sample_rate_hz) + b"\x00\x00" * 16000
    qs = urlencode(
        {
            "model": s.sarvam_stt_model,
            "language_code": "auto",
            "stream_type": "fast",
            "encoding": "linear16",
            "sample_rate": "16000",
            "endpointing": "vad",
            "silence_duration_ms": "500",
            "threshold": "0.3",
        }
    )
    events: list[dict] = []
    url = "wss://api.sarvam.ai/speech-to-text-realtime/ws?" + qs
    async with websockets.connect(url, additional_headers={"api-subscription-key": _key()}) as ws:

        async def reader():
            try:
                async for raw in ws:
                    events.append(json.loads(raw))
            except Exception as exc:
                print("reader ended:", type(exc).__name__)

        rt = asyncio.create_task(reader())
        step = 3200
        for i in range(0, len(pcm), step):
            frame = {"event": "audio_input", "audio": base64.b64encode(pcm[i : i + step]).decode()}
            await ws.send(json.dumps(frame))
            await asyncio.sleep(0.1)
        await asyncio.sleep(3)
        rt.cancel()
    kinds = sorted({str(e.get("type") or e.get("event") or "?") for e in events})
    print("event types:", kinds, "count", len(events))
    finals = [e for e in events if "final" in json.dumps(e)[:120]]
    print("final:", json.dumps(finals[0], ensure_ascii=False)[:400] if finals else None)
    _save("stt_realtime_events.txt", [json.dumps(e, ensure_ascii=False) for e in events[:10]])


COMMANDS = {
    "chat-stream": chat_stream,
    "chat-stream-tools": chat_stream_tools,
    "chat-stream-tool-choice-none": chat_stream_tool_choice_none,
    "tts-ws": tts_ws,
    "stt-realtime": stt_realtime,
}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
        sys.exit("usage: probe_sarvam.py {" + "|".join(COMMANDS) + "}")
    asyncio.run(COMMANDS[sys.argv[1]]())
