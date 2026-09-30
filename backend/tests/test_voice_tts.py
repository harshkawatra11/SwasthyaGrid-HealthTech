"""TTS WebSocket adapter against a local fake `websockets.serve` server, the
REST body additions and the filler cache. No Sarvam calls."""

import asyncio
import base64
import json
import struct

import httpx
import pytest
from websockets.asyncio.server import serve

from app.voice import fillers, sarvam_tts
from app.voice.sarvam_tts_ws import AudioChunk, TtsStream

PCM = b"\x01\x00" * 480


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _wav(rate: int = 24000) -> bytes:
    pcm = b"\x00\x00" * 100
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate * 2, 2, 16)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(pcm)) + pcm
    return b"RIFF" + struct.pack("<I", len(body)) + body


class FakeServer:
    """Echoes one audio message per text message and a `final` event after flush."""

    def __init__(self, fail_after_texts: int | None = None):
        self.connections = 0
        self.configs: list[dict] = []
        self.texts: list[str] = []
        self.pings = 0
        self.headers: list[str | None] = []
        self.paths: list[str] = []
        self.fail_after_texts = fail_after_texts
        self._server = None
        self.url = ""

    async def _handler(self, ws):
        self.connections += 1
        self.headers.append(ws.request.headers.get("Api-Subscription-Key"))
        self.paths.append(ws.request.path)
        n = 0
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "config":
                self.configs.append(msg["data"])
            elif msg["type"] == "text":
                n += 1
                self.texts.append(msg["data"]["text"])
                if self.fail_after_texts is not None and n > self.fail_after_texts:
                    await ws.close(code=1011)
                    return
                await ws.send(json.dumps({"type": "audio", "data": {"audio": base64.b64encode(PCM).decode()}}))
            elif msg["type"] == "flush":
                await ws.send(json.dumps({"type": "event", "data": {"event_type": "final"}}))
            elif msg["type"] == "ping":
                self.pings += 1

    async def __aenter__(self):
        self._server = await serve(self._handler, "127.0.0.1", 0)
        port = self._server.sockets[0].getsockname()[1]
        self.url = f"ws://127.0.0.1:{port}/text-to-speech/ws"
        return self

    async def __aexit__(self, *exc):
        self._server.close()
        await self._server.wait_closed()


class Collector:
    def __init__(self):
        self.chunks: list[AudioChunk] = []

    async def __call__(self, chunk: AudioChunk):
        self.chunks.append(chunk)


def _stream(server_url: str, **kw) -> TtsStream:
    kw.setdefault("rest_synthesize", _fake_rest([]))
    return TtsStream(api_key="test-key", model="bulbul:v3", speaker="Simran", base_url=server_url, **kw)


def _fake_rest(calls: list):
    async def synth(*, api_key, text, speaker, model, language):
        calls.append((text, language))
        return sarvam_tts.WavSynthesis(base64.b64encode(_wav()).decode(), 24000)

    return synth


@pytest.mark.anyio
async def test_ws_turn_streams_pcm_chunks_in_order():
    async with FakeServer() as srv:
        tts = _stream(srv.url)
        out = Collector()
        await tts.begin_turn("en-IN", out)
        await tts.say("Kota has two critical facilities.")
        await tts.say("PHC Kota-4 is worst.")
        await tts.end_turn()
        await tts.close()
    assert [c.seq for c in out.chunks] == [0, 1]
    assert all(c.encoding == "pcm_s16le" and c.sample_rate_hz == 24000 for c in out.chunks)
    assert base64.b64decode(out.chunks[0].b64) == PCM
    assert srv.texts == ["Kota has two critical facilities.", "PHC Kota-4 is worst."]
    cfg = srv.configs[0]
    assert cfg["target_language_code"] == "en-IN"
    assert cfg["speaker"] == "simran"
    assert cfg["speech_sample_rate"] == "24000"
    assert cfg["output_audio_codec"] == "linear16"
    assert (cfg["pace"], cfg["temperature"], cfg["min_buffer_size"], cfg["max_chunk_length"]) == (
        1.05, 0.45, 30, 150,
    )  # fmt: skip
    assert srv.headers == ["test-key"]
    assert "model=bulbul%3Av3" in srv.paths[0] and "send_completion_event=true" in srv.paths[0]


@pytest.mark.anyio
async def test_socket_reused_for_same_language_and_reopened_for_new_one():
    async with FakeServer() as srv:
        tts = _stream(srv.url)
        for lang in ("en-IN", "en-IN", "hi-IN"):
            out = Collector()
            await tts.begin_turn(lang, out)
            await tts.say("Namaste.")
            await tts.end_turn()
            assert len(out.chunks) == 1
        await tts.close()
    assert srv.connections == 2
    assert [c["target_language_code"] for c in srv.configs] == ["en-IN", "hi-IN"]


@pytest.mark.anyio
async def test_cancel_turn_closes_socket_and_next_turn_reconnects():
    async with FakeServer() as srv:
        tts = _stream(srv.url)
        out = Collector()
        await tts.begin_turn("en-IN", out)
        await tts.say("First sentence.")
        await tts.cancel_turn()
        assert tts._conn is None
        out2 = Collector()
        await tts.begin_turn("en-IN", out2)
        await tts.say("Second.")
        await tts.end_turn()
        await tts.close()
    assert srv.connections == 2
    assert len(out2.chunks) == 1


@pytest.mark.anyio
async def test_socket_error_mid_turn_falls_back_to_rest_and_sticks_for_five_minutes():
    now = [1000.0]
    rest_calls: list = []
    async with FakeServer(fail_after_texts=1) as srv:
        tts = _stream(srv.url, clock=lambda: now[0], rest_synthesize=_fake_rest(rest_calls))
        out = Collector()
        await tts.begin_turn("en-IN", out)
        await tts.say("First sentence goes out fine.")
        await asyncio.sleep(0.05)  # audio for the first sentence arrives
        await tts.say("Second sentence kills the socket.")
        await tts.say("Third is already REST.")
        await tts.end_turn()
        assert tts.mode == "rest"
        encodings = [c.encoding for c in out.chunks]
        assert encodings[0] == "pcm_s16le" and "wav" in encodings
        assert [c.seq for c in out.chunks] == list(range(len(out.chunks)))
        assert rest_calls and rest_calls[-1][0] == "Third is already REST."

        # next turn goes straight to REST, no new socket
        conns = srv.connections
        out2 = Collector()
        await tts.begin_turn("en-IN", out2)
        await tts.say("Later turn.")
        await tts.end_turn()
        assert srv.connections == conns
        assert [c.encoding for c in out2.chunks] == ["wav"]

        # after five minutes the socket is tried again
        now[0] += 301
        assert tts.mode == "ws"
        out3 = Collector()
        await tts.begin_turn("en-IN", out3)
        await tts.say("Back on the socket.")
        await tts.end_turn()
        assert srv.connections == conns + 1
        assert [c.encoding for c in out3.chunks] == ["pcm_s16le"]
        await tts.close()


@pytest.mark.anyio
async def test_connect_failure_uses_rest():
    rest_calls: list = []
    tts = TtsStream(
        api_key="k", model="m", speaker="simran", base_url="ws://127.0.0.1:1/x",
        rest_synthesize=_fake_rest(rest_calls),
    )  # fmt: skip
    out = Collector()
    await tts.begin_turn("hi-IN", out)
    await tts.say("नमस्ते।")
    await tts.end_turn()
    assert tts.mode == "rest"
    assert rest_calls == [("नमस्ते।", "hi-IN")]
    assert [c.encoding for c in out.chunks] == ["wav"]


@pytest.mark.anyio
async def test_configured_rest_mode_never_opens_a_socket():
    rest_calls: list = []
    tts = TtsStream(
        api_key="k", model="m", speaker="simran", mode="rest", base_url="ws://127.0.0.1:1/x",
        rest_synthesize=_fake_rest(rest_calls),
    )  # fmt: skip
    out = Collector()
    await tts.begin_turn("auto", out)
    await tts.say("One.")
    await tts.say("Two.")
    await tts.end_turn()
    assert [c[0] for c in rest_calls] == ["One.", "Two."]
    assert rest_calls[0][1] == "hi-IN"
    assert [c.seq for c in out.chunks] == [0, 1]


@pytest.mark.anyio
async def test_idle_socket_gets_pings():
    async with FakeServer() as srv:
        tts = _stream(srv.url, ping_interval=0.05)
        out = Collector()
        await tts.begin_turn("en-IN", out)
        await tts.say("Hi.")
        await tts.end_turn()
        await asyncio.sleep(0.2)
        await tts.close()
    assert srv.pings >= 2


@pytest.mark.anyio
async def test_rest_body_has_pace_sample_rate_and_codec():
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"audios": [base64.b64encode(_wav()).decode()]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        res = await sarvam_tts.synthesize(
            api_key="k", text="Hello", speaker="Simran", model="bulbul:v3", language="en-IN", client=client
        )
    assert res.sample_rate_hz == 24000
    body = seen[0]
    assert body["target_language_code"] == "en-IN"
    assert body["speaker"] == "simran"
    assert body["pace"] == 1.05
    assert body["speech_sample_rate"] == 24000
    assert body["output_audio_codec"] == "wav"


@pytest.mark.anyio
async def test_fillers_are_synthesized_once_per_speaker_and_language(monkeypatch):
    fillers.clear_cache()
    calls: list = []

    async def fake(*, api_key, text, speaker, model, language):
        calls.append((text, speaker, language))
        return sarvam_tts.WavSynthesis("AAAA", 24000)

    monkeypatch.setattr(sarvam_tts, "synthesize", fake)
    kw = {"api_key": "k", "speaker": "Simran", "model": "bulbul:v3"}
    a, b, _ = await asyncio.gather(
        fillers.get_filler(language="en-IN", **kw),
        fillers.get_filler(language="en-IN", **kw),
        fillers.get_filler(language="hi-IN", **kw),
    )
    await fillers.get_filler(language="en-IN", **kw)
    assert a is b
    assert len(calls) == 2
    assert calls[0][0] == "One moment, checking the data."
    assert ("एक सेकंड, data देख रही हूँ।", "Simran", "hi-IN") in calls
    fillers.clear_cache()
