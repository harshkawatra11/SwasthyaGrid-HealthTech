"""STT additions against a fake STT websocket server (no Sarvam calls)."""

import asyncio
import json
from pathlib import Path

import pytest
from websockets.asyncio.server import serve

from app.voice import sarvam_stt

FIXTURE = Path(__file__).resolve().parents[2] / "docs" / "probes" / "fixtures" / "stt_realtime_events.txt"


@pytest.fixture
def anyio_backend():
    return "asyncio"


class FakeStt:
    """Records client messages per connection. `drop_first_after` closes the
    first connection after that many audio frames."""

    def __init__(self, replay_events: list[dict] | None = None, drop_first_after: int | None = None):
        self.connections: list[list[dict]] = []
        self.paths: list[str] = []
        self.headers: list[str | None] = []
        self.replay = replay_events or []
        self.drop_first_after = drop_first_after
        self._server = None
        self.url = ""

    async def _handler(self, ws):
        msgs: list[dict] = []
        idx = len(self.connections)
        self.connections.append(msgs)
        self.paths.append(ws.request.path)
        self.headers.append(ws.request.headers.get("api-subscription-key"))
        async for raw in ws:
            msg = json.loads(raw)
            msgs.append(msg)
            if msg["event"] == "flush":
                for ev in self.replay:
                    await ws.send(json.dumps(ev))
            if (
                idx == 0
                and self.drop_first_after is not None
                and sum(m["event"] == "audio_input" for m in msgs) >= self.drop_first_after
            ):
                await ws.close(code=1011)
                return

    async def __aenter__(self):
        self._server = await serve(self._handler, "127.0.0.1", 0)
        self.url = f"ws://127.0.0.1:{self._server.sockets[0].getsockname()[1]}/speech-to-text-realtime/ws"
        return self

    async def __aexit__(self, *exc):
        self._server.close()
        await self._server.wait_closed()


def _fixture_events() -> list[dict]:
    """The probe fixture is truncated after the partials; the closing events are
    the ones recorded in docs/probes/2026-09-sarvam.md."""
    events = [json.loads(x) for x in FIXTURE.read_text(encoding="utf-8").splitlines() if x.startswith("{")]
    events.append({"event": "vad.speech_end", "utterance_idx": 0, "confidence": 0.9})
    events.append(
        {
            "event": "transcript.final",
            "utterance_idx": 0,
            "text": "Kota mein kitni facilities critical hain?",
            "language": "en-IN",
            "language_confidence": 0.4,
        }
    )
    return events


def test_parse_stt_event_kinds_from_probe_fixture():
    events = [sarvam_stt.parse_stt_event(e) for e in _fixture_events()]
    kinds = [e.kind for e in events]
    assert kinds[0] == "session_begin"
    assert "vad_start" in kinds and "vad_end" in kinds
    assert "partial" in kinds
    final = next(e for e in events if e.kind == "final")
    assert final.text == "Kota mein kitni facilities critical hain?"
    assert final.language == "en-IN"


def test_parse_stt_event_error_and_unknown():
    err = sarvam_stt.parse_stt_event({"event": "error", "is_fatal": True, "message": "boom"})
    assert err.kind == "error" and err.fatal and err.message == "boom"
    assert sarvam_stt.parse_stt_event({"event": "something.new"}).kind == "other"


@pytest.mark.anyio
async def test_events_flow_and_flush_and_end_frames():
    received: list[dict] = []

    async def on_event(e):
        received.append(e)

    events = _fixture_events()
    async with FakeStt(replay_events=events) as srv:
        handle = await sarvam_stt.open_stt_socket(
            api_key="test-key", language="auto", model="saaras:v3-realtime",
            on_event=on_event, base_url=srv.url,
        )  # fmt: skip
        await handle.send_audio("QUJD")
        await handle.flush()
        for _ in range(50):
            if len(received) >= len(events):
                break
            await asyncio.sleep(0.02)
        await handle.end()
        await asyncio.sleep(0.05)
    assert [m["event"] for m in srv.connections[0]][:2] == ["audio_input", "flush"]
    assert srv.connections[0][0]["audio"] == "QUJD"
    assert srv.connections[0][-1] == {"event": "end"}
    assert [e["event"] for e in received] == [e["event"] for e in events]
    assert srv.headers == ["test-key"]
    for part in ("model=saaras%3Av3-realtime", "stream_type=fast", "endpointing=vad", "silence_duration_ms=500"):
        assert part in srv.paths[0]


@pytest.mark.anyio
async def test_reconnect_replays_at_most_ten_frames_oldest_dropped():
    async def on_event(_e):
        pass

    async with FakeStt(drop_first_after=1) as srv:
        handle = await sarvam_stt.open_stt_socket(
            api_key="k", language="auto", model="m", on_event=on_event,
            base_url=srv.url, reconnect_delay=0.3,
        )  # fmt: skip
        await handle.send_audio("f0")
        await asyncio.sleep(0.1)  # server drops the socket, client notices
        assert not handle.connected
        for i in range(1, 16):
            await handle.send_audio(f"f{i}")
        for _ in range(100):
            if handle.connected and srv.connections and len(srv.connections) > 1:
                break
            await asyncio.sleep(0.05)
        await asyncio.sleep(0.1)
        assert handle.reconnects == 1
        await handle.send_audio("live")
        await asyncio.sleep(0.1)
        await handle.end()
    replayed = [m["audio"] for m in srv.connections[1] if m["event"] == "audio_input"]
    assert replayed == [f"f{i}" for i in range(6, 16)] + ["live"]


@pytest.mark.anyio
async def test_reconnect_failure_calls_on_failed_and_send_raises():
    failed = asyncio.Event()

    async def on_failed():
        failed.set()

    async def on_event(_e):
        pass

    calls = {"n": 0}
    async with FakeStt(drop_first_after=1) as srv:
        real = sarvam_stt._default_connect

        async def flaky(url, headers):
            calls["n"] += 1
            if calls["n"] == 1:
                return await real(url, headers)
            raise OSError("refused")

        handle = await sarvam_stt.open_stt_socket(
            api_key="k", language="auto", model="m", on_event=on_event, base_url=srv.url,
            connect=flaky, on_failed=on_failed, max_reconnects=2, reconnect_delay=0.02,
        )  # fmt: skip
        await handle.send_audio("f0")
        await asyncio.wait_for(failed.wait(), 3)
        assert handle.failed
        with pytest.raises(ConnectionError):
            await handle.send_audio("f1")
        await handle.end()
    assert calls["n"] == 3  # initial connect plus two failed retries
