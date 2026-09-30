"""Language choice and speech text preparation (plan 7.8). Pure functions."""

import re
import unicodedata

from app.tools.resolve import resolve_facility

_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")
_HINDI_HINTS = frozenset(
    ["hai", "kya", "kitna", "kitni", "kitne", "kab", "kaise", "mein", "ka", "ki", "ke", "abhi", "haal", "batao", "bataiye"]
)
_WORD_RE = re.compile(r"[a-zA-Z]+")

_ID_RE = re.compile(r"\b(?:[a-z]+_)?(?:phc|chc)_\w+\b", re.IGNORECASE)
_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_BRACKETED_RE = re.compile(r"\([^)]*\)|\[[^\]]*\]|\{[^}]*\}")
_BULLET_RE = re.compile(r"^\s*(?:[-•*]|\d+[.)])\s+", re.MULTILINE)
_DASH_RE = re.compile("[" + chr(0x2013) + chr(0x2014) + "]")
_EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF☀-➿️]")
_REPEATED_TYPE_RE = re.compile(r"\b(phc|chc)\s+(?=\1\b)", re.IGNORECASE)
_SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([.,!?।;:])")


def has_devanagari(text: str) -> bool:
    return bool(_DEVANAGARI_RE.search(text))


def detect_text_language(text: str) -> str:
    """Typed text: hi-IN if Devanagari or at least two common Hinglish words."""
    if has_devanagari(text):
        return "hi-IN"
    words = {w.lower() for w in _WORD_RE.findall(text)}
    return "hi-IN" if len(words & _HINDI_HINTS) >= 2 else "en-IN"


def choose_language(pref: str, *, stt_language: str | None = None, text: str = "") -> str:
    """Turn language: the hello preference unless `auto`, then the STT final's
    language (`en*` gives en-IN, anything else hi-IN), then the text heuristic."""
    if pref and pref != "auto":
        return pref
    if stt_language:
        if has_devanagari(text):
            return "hi-IN"  # the STT language tag is low confidence for Hinglish
        return "en-IN" if stt_language.lower().startswith("en") else "hi-IN"
    return detect_text_language(text)


def prepare_speech(text: str) -> str:
    """Make model text speakable: replace leaked ids with facility names, strip
    markdown and bracketed content, collapse whitespace. Never transliterates."""
    text = unicodedata.normalize("NFC", text or "")

    def _swap_id(m: re.Match) -> str:
        res = resolve_facility(m.group(0))
        best = res.best
        if best is not None and best.score >= 90:
            return best.name
        return m.group(0).replace("_", " ")

    text = _ID_RE.sub(_swap_id, text)  # before underscores are stripped
    text = _LINK_RE.sub(r"\1", text)
    text = _BRACKETED_RE.sub(" ", text)
    text = _BULLET_RE.sub("", text)
    text = _DASH_RE.sub(", ", text)
    text = _EMOJI_RE.sub("", text)
    text = text.replace("*", "").replace("#", "").replace("`", "").replace("_", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = _REPEATED_TYPE_RE.sub("", text)
    text = _SPACE_BEFORE_PUNCT_RE.sub(r"\1", text)
    return text.strip()


FALLBACK_TEXT = {
    "en-IN": "Sorry, I could not reach the data service. Please try again.",
    "hi-IN": "माफ़ कीजिए, data service से जुड़ नहीं पाई। कृपया दोबारा कोशिश करें।",
}


def fallback_text(language: str) -> str:
    return FALLBACK_TEXT.get(language, FALLBACK_TEXT["hi-IN"])
