"""Sarvam TTS, REST endpoint.

Two things that break silently if skipped, both learned the hard way while
building Pukaar (nari-kavach/apps/relay/src/sarvam/tts-rest.ts) and ported
here verbatim:

- Sarvam returns a standard WAV header. NEVER hardcode a sample rate:
  bulbul:v2 returns 22050 Hz, bulbul:v3 returns 24000 Hz. Always read it from
  the header via `parse_wav_header` below.
- Speaker names must be lowercase in the request body ("simran", not
  "Simran"), or the request 400s.
"""

import base64
from dataclasses import dataclass

import httpx

SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"


@dataclass
class WavAudio:
    """Raw PCM samples (no header) plus the format actually present in the
    response, rather than an assumed one."""

    pcm: bytes
    sample_rate_hz: int
    channels: int


def parse_wav_header(buf: bytes) -> WavAudio:
    """Walks RIFF/WAVE chunks after the 12-byte header rather than assuming
    "fmt " and "data" sit at fixed offsets, since some encoders insert extra
    chunks (e.g. LIST) between them."""
    if len(buf) < 44 or buf[0:4] != b"RIFF" or buf[8:12] != b"WAVE":
        raise ValueError("Sarvam TTS did not return a recognizable WAV file.")

    offset = 12
    sample_rate_hz = 0
    channels = 0
    data_start = -1
    data_length = 0

    while offset + 8 <= len(buf):
        chunk_id = buf[offset : offset + 4]
        chunk_size = int.from_bytes(buf[offset + 4 : offset + 8], "little")
        body_start = offset + 8
        if chunk_id == b"fmt ":
            channels = int.from_bytes(buf[body_start + 2 : body_start + 4], "little")
            sample_rate_hz = int.from_bytes(buf[body_start + 4 : body_start + 8], "little")
        elif chunk_id == b"data":
            data_start = body_start
            data_length = chunk_size
        offset = body_start + chunk_size + (chunk_size % 2)

    if data_start < 0 or sample_rate_hz == 0:
        raise ValueError("Sarvam TTS WAV was missing a fmt or data chunk.")

    return WavAudio(
        pcm=buf[data_start : data_start + data_length],
        sample_rate_hz=sample_rate_hz,
        channels=channels or 1,
    )


@dataclass
class WavSynthesis:
    wav_base64: str
    sample_rate_hz: int


async def synthesize(
    *,
    api_key: str,
    text: str,
    speaker: str,
    model: str,
    language: str,
    client: httpx.AsyncClient | None = None,
) -> WavSynthesis:
    target_language = "hi-IN" if language == "auto" else language
    body = {
        "text": text,
        "target_language_code": target_language,
        "speaker": speaker.lower(),
        "model": model,
        "pace": 1.05,
        "speech_sample_rate": 24000,
        "output_audio_codec": "wav",
    }
    headers = {"api-subscription-key": api_key, "content-type": "application/json"}
    if client is not None:
        res = await client.post(SARVAM_TTS_URL, headers=headers, json=body)
    else:
        async with httpx.AsyncClient(timeout=10.0) as own:
            res = await own.post(SARVAM_TTS_URL, headers=headers, json=body)
    if res.status_code != 200:
        raise RuntimeError(f"Sarvam TTS failed ({res.status_code}): {res.text[:300]}")

    data = res.json()
    wav_b64 = data["audios"][0]
    wav_bytes = base64.b64decode(wav_b64)
    parsed = parse_wav_header(wav_bytes)
    return WavSynthesis(wav_base64=wav_b64, sample_rate_hz=parsed.sample_rate_hz)
