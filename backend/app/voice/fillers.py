"""Cached filler audio, played once per turn while a tool round runs.

Synthesized on first use per (speaker, language) through REST TTS and kept in
a module-level dict for the life of the process.
"""

import asyncio

from app.voice import sarvam_tts

FILLER_TEXT = {
    "en-IN": "One moment, checking the data.",
    "hi-IN": "एक सेकंड, data देख रही हूँ।",
}

_cache: dict[tuple[str, str], sarvam_tts.WavSynthesis] = {}
_locks: dict[tuple[str, str], asyncio.Lock] = {}


def filler_text(language: str) -> str:
    return FILLER_TEXT.get(language, FILLER_TEXT["hi-IN"])


async def get_filler(
    *, api_key: str, speaker: str, model: str, language: str
) -> sarvam_tts.WavSynthesis:
    """Return the filler WAV for this speaker and language, synthesizing it once."""
    language = "hi-IN" if language == "auto" else language
    key = (speaker.lower(), language)
    if key in _cache:
        return _cache[key]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        if key not in _cache:
            _cache[key] = await sarvam_tts.synthesize(
                api_key=api_key,
                text=filler_text(language),
                speaker=speaker,
                model=model,
                language=language,
            )
    return _cache[key]


def clear_cache() -> None:
    _cache.clear()
    _locks.clear()
