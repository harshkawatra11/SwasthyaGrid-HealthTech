import struct

from app.tools.schemas import TOOL_NAMES
from app.tools.v2 import build_tool_functions
from app.voice.sarvam_tts import parse_wav_header


def _wav_with_list_chunk(sample_rate: int, pcm: bytes) -> bytes:
    """A WAV where a LIST chunk sits between fmt and data, the exact shape
    some encoders produce and that a fixed-offset parser would misread."""
    fmt_body = struct.pack("<HHIIHH", 1, 1, sample_rate, sample_rate * 2, 2, 16)
    fmt_chunk = b"fmt " + struct.pack("<I", len(fmt_body)) + fmt_body
    list_body = b"INFOIART" + struct.pack("<I", 4) + b"test"
    list_chunk = b"LIST" + struct.pack("<I", len(list_body)) + list_body
    data_chunk = b"data" + struct.pack("<I", len(pcm)) + pcm
    body = b"WAVE" + fmt_chunk + list_chunk + data_chunk
    return b"RIFF" + struct.pack("<I", len(body)) + body


def test_parse_wav_header_reads_sample_rate_around_a_list_chunk():
    pcm = b"\x01\x02" * 50
    wav = _wav_with_list_chunk(24000, pcm)
    parsed = parse_wav_header(wav)
    assert parsed.sample_rate_hz == 24000
    assert parsed.channels == 1
    assert parsed.pcm == pcm


def test_parse_wav_header_rejects_non_wav_bytes():
    import pytest

    with pytest.raises(ValueError):
        parse_wav_header(b"not a wav file at all, way too short")


def test_tool_schema_names_match_dispatch_table():
    """The Sarvam tool schema and the Gemini/dispatch tool list must never
    drift: same names, same set (13 tools in v2), or a tool call from one
    agent would silently fail to dispatch."""

    class _Stub:
        def __getattr__(self, name):
            return lambda *a, **k: {}

    fns = build_tool_functions(_Stub(), _Stub(), _Stub())
    assert set(fns.keys()) == TOOL_NAMES
    assert len(TOOL_NAMES) == 13


def test_origin_allowed_accepts_both_localhost_and_127_spellings():
    from app.api.v1.voice_ws import _origin_allowed
    from app.core.config import Settings

    settings = Settings(cors_origins=["http://localhost:3000"])

    assert _origin_allowed("http://localhost:3000", settings)
    assert _origin_allowed("http://127.0.0.1:3000", settings)
    assert _origin_allowed(None, settings)
    assert not _origin_allowed("http://evil.example.com", settings)


def test_origin_allowed_widens_a_configured_127_origin_too():
    from app.api.v1.voice_ws import _origin_allowed
    from app.core.config import Settings

    settings = Settings(cors_origins=["http://127.0.0.1:3000"])

    assert _origin_allowed("http://127.0.0.1:3000", settings)
    assert _origin_allowed("http://localhost:3000", settings)
