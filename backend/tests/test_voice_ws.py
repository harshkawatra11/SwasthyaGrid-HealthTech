"""Voice WebSocket tests (protocol 2) with the Sarvam network layer mocked. No
paid Sarvam calls happen here, per the project's live-call budget rule; the
live rehearsal with real credits happens manually.
"""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.voice import sarvam_chat
from tests.test_voice_fakes import ChatScript, FakeTts, text_delta, tool_delta

client = TestClient(app)

HELLO = {"t": "hello", "language": "en-IN", "scope": None, "mode": "handsfree", "protocol": 2}


def _receive_until(ws, frame_type: str, max_frames: int = 30) -> dict:
    """Drains frames until one of the given type arrives. The number of
    intermediate frames (thinking, tool, reply_delta, audio) varies per turn,
    so tests assert on frame type and content rather than a fixed count."""
    for _ in range(max_frames):
        frame = ws.receive_json()
        if frame["t"] == frame_type:
            return frame
    raise AssertionError(f"no frame of type {frame_type!r} received within {max_frames} frames")


def test_voice_ws_without_api_key_reports_unavailable(monkeypatch):
    # A real key may be present in the local .env file; an empty environment
    # variable wins over it and is falsy exactly like an absent key.
    monkeypatch.setenv("SARVAM_API_KEY", "")
    get_settings.cache_clear()

    with client.websocket_connect("/ws/voice") as ws:
        ws.send_json(HELLO)
        ready = ws.receive_json()
        assert ready["t"] == "ready"
        assert ready["protocol"] == 2
        assert ready["sttMode"] == "rest"

        # The greeting is still sent as text so the transcript is not empty.
        greeting = _receive_until(ws, "reply")
        assert greeting["text"].startswith("Hello. I am Swasthya")

        ws.send_json({"t": "text", "body": "How many facilities are critical in Kota?", "clientTurnId": "c-1"})
        final = _receive_until(ws, "final")
        assert final["clientTurnId"] == "c-1"

        err = _receive_until(ws, "error")
        assert "SARVAM_API_KEY" in err["message"]

    get_settings.cache_clear()


def test_voice_ws_rejects_a_hello_without_protocol_2(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "")
    get_settings.cache_clear()

    with client.websocket_connect("/ws/voice") as ws:
        ws.send_json({"t": "hello", "language": "auto"})
        err = ws.receive_json()
        assert err["t"] == "error"
        assert err["fatal"] is True
        assert err["code"] == "protocol_unsupported"

    get_settings.cache_clear()


def test_voice_ws_grounds_a_turn_in_real_tool_data(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-key-not-real")
    get_settings.cache_clear()

    script = ChatScript(
        [tool_delta("get_district_briefing", '{"district": "Kota"}')],
        [text_delta("Kota district has facilities at varying risk levels right now.")],
    )
    monkeypatch.setattr(sarvam_chat, "stream_chat", script)
    fake_tts = FakeTts()

    with (
        # Never open a real STT or TTS socket in a unit test, even against a fake key.
        patch("app.voice.session.sarvam_stt.open_stt_socket", new=AsyncMock(side_effect=RuntimeError("no live STT in tests"))),
        patch("app.voice.session.TtsStream", new=lambda **_kw: fake_tts),
        client.websocket_connect("/ws/voice") as ws,
    ):
        ws.send_json(HELLO)
        ready = ws.receive_json()
        assert ready["t"] == "ready"
        assert ready["sttMode"] == "rest"  # no real STT socket opens against a fake key

        _receive_until(ws, "turn_end")  # the greeting turn

        ws.send_json({"t": "text", "body": "Kota district mein kya haal hai?", "clientTurnId": "c-2"})
        final = _receive_until(ws, "final")
        assert final["clientTurnId"] == "c-2"

        tool = _receive_until(ws, "tool")
        assert tool["name"] == "get_district_briefing"

        reply = _receive_until(ws, "reply")
        assert reply["toolCalls"] == ["get_district_briefing"]
        assert "Kota" in reply["text"]
        assert reply["cards"] and reply["cards"][0]["type"] == "district_summary"

        end = _receive_until(ws, "turn_end")
        assert end["metrics"]["tools"] == ["get_district_briefing"]

    get_settings.cache_clear()
    assert fake_tts.said  # the answer was spoken through the TTS stream


def test_voice_ws_accepts_context_ptt_and_interrupt_frames(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "")
    get_settings.cache_clear()

    with client.websocket_connect("/ws/voice") as ws:
        ws.send_json(HELLO)
        _receive_until(ws, "ready")
        ws.send_json({"t": "context", "scope": "district_kota"})
        ws.send_json({"t": "ptt", "state": "up"})
        ws.send_json({"t": "interrupt"})
        ws.send_json({"t": "bye"})

    get_settings.cache_clear()
