"""Spoken-name resolvers for districts and facilities (pure, no network).

A speech recogniser hands the model things like "Kota ka PHC chaar" or
"PHC सेक्टर बारह". `normalize` reduces those to a comparable Latin token
string, and the two resolvers fuzzy-match against the reference data.
"""

import unicodedata
from dataclasses import dataclass, field
from typing import Any

from rapidfuzz import fuzz, process

_DEVANAGARI_DIGITS = {ord(c): str(i) for i, c in enumerate("०१२३४५६७८९")}

_HINDI_NUMBERS = {
    "ek": "1", "do": "2", "teen": "3", "char": "4", "chaar": "4", "paanch": "5",
    "panch": "5", "chhe": "6", "chah": "6", "saat": "7", "aath": "8", "nau": "9",
    "das": "10", "gyarah": "11", "barah": "12", "terah": "13", "chaudah": "14",
    "pandrah": "15",
    "एक": "1", "दो": "2", "तीन": "3", "चार": "4", "पांच": "5", "छह": "6",
    "सात": "7", "आठ": "8", "नौ": "9", "दस": "10", "ग्यारह": "11", "बारह": "12",
    "तेरह": "13", "चौदह": "14", "पंद्रह": "15",
}  # fmt: skip

_ENGLISH_NUMBERS = {
    w: str(i)
    for i, w in enumerate(
        ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]
    )
    if i > 0
}

_DEVANAGARI_ALIASES = {
    "पीएचसी": "phc", "सीएचसी": "chc", "सेक्टर": "sector", "रूरल": "rural",
    "ईस्ट": "east", "नॉर्थ": "north", "निंदर": "nindar", "बस्सी": "bassi",
    "चाकसू": "chaksu", "फागी": "phagi", "जयपुर": "jaipur", "अलवर": "alwar",
    "बीकानेर": "bikaner", "उदयपुर": "udaipur", "कोटा": "kota",
}  # fmt: skip

_FILLERS = frozenset(["ka", "ki", "ke", "wala", "wali", "wale", "the", "of", "district", "jila", "zila"])

_TOKEN_MAP = {**_HINDI_NUMBERS, **_ENGLISH_NUMBERS, **_DEVANAGARI_ALIASES}

_DISTRICT_ALIASES = {
    "jaipur": "district_jaipur_rural",
    "jaipur rural": "district_jaipur_rural",
    "jaipur gramin": "district_jaipur_rural",
    "alwar": "district_alwar",
    "bikaner": "district_bikaner",
    "udaipur": "district_udaipur",
    "kota": "district_kota",
    "जयपुर": "district_jaipur_rural",
    "अलवर": "district_alwar",
    "बीकानेर": "district_bikaner",
    "उदयपुर": "district_udaipur",
    "कोटा": "district_kota",
}


def normalize(text: str) -> str:
    """Lowercase, strip punctuation to spaces, map number words and Devanagari
    spellings to Latin/digits, and drop filler words."""
    text = unicodedata.normalize("NFC", text or "").lower().translate(_DEVANAGARI_DIGITS)
    # Keep letters, digits and combining marks (Devanagari vowel signs are
    # category M); everything else, including "-" and "_", becomes a space.
    text = "".join(
        ch if unicodedata.category(ch)[0] in "LNM" else " " for ch in text
    )
    tokens = []
    for tok in text.split():
        if tok in _FILLERS:
            continue
        tokens.append(_TOKEN_MAP.get(tok, tok))
    return " ".join(tokens)


@dataclass
class FacilityMatch:
    id: str
    name: str
    district_id: str
    type: str
    score: float


@dataclass
class FacilityResolution:
    matches: list[FacilityMatch] = field(default_factory=list)
    ambiguous: bool = False

    @property
    def best(self) -> FacilityMatch | None:
        return self.matches[0] if self.matches else None


def _default_repo_data() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    from app.repositories.district_repository import get_district_repository

    repo = get_district_repository()
    return repo.districts, repo.facilities


def resolve_district(
    text: str | None, districts: list[dict[str, Any]] | None = None
) -> str | None:
    """Return a district id for a spoken or written district, else None."""
    if not text or not text.strip():
        return None
    if districts is None:
        districts, _ = _default_repo_data()
    ids = {d["id"] for d in districts}
    raw = text.strip()
    if raw in ids:
        return raw

    choices: dict[str, str] = {}
    for alias, did in _DISTRICT_ALIASES.items():
        if did in ids:
            choices[normalize(alias)] = did
    for d in districts:
        choices.setdefault(normalize(d["name"]), d["id"])
    query = normalize(raw)
    if not query:
        return None
    hit = process.extractOne(query, list(choices), score_cutoff=70)
    return choices[hit[0]] if hit else None


def _facility_variants(f: dict[str, Any]) -> list[str]:
    """Normalized spellings of a facility: "phc kota 4", "kota phc 4", "kota 4"."""
    name = normalize(f["name"])
    tokens = name.split()
    variants = {name}
    if tokens and tokens[0] in ("phc", "chc"):
        rest = tokens[1:]
        variants.add(" ".join([*rest, tokens[0]]))
        variants.add(" ".join(rest))
    variants.add(normalize(f["id"]))
    return [v for v in variants if v]


def resolve_facility(
    text: str | None,
    district: str | None = None,
    *,
    facilities: list[dict[str, Any]] | None = None,
    districts: list[dict[str, Any]] | None = None,
) -> FacilityResolution:
    """Up to three fuzzy matches, best first. `ambiguous` when the top two are
    within 5 points of each other."""
    if not text or not text.strip():
        return FacilityResolution()
    if facilities is None or districts is None:
        d, f = _default_repo_data()
        districts = districts if districts is not None else d
        facilities = facilities if facilities is not None else f

    raw = text.strip()
    for f in facilities:
        if f["id"] == raw:
            return FacilityResolution([_match(f, 100.0)])

    district_id = None
    if district:
        district_id = resolve_district(district, districts)
    pool = [f for f in facilities if district_id is None or f["district_id"] == district_id]

    query = normalize(raw)
    if not query:
        return FacilityResolution()
    scored: list[tuple[float, dict[str, Any]]] = []
    for f in pool:
        best = max(fuzz.token_set_ratio(query, v) for v in _facility_variants(f))
        if best >= 60:
            scored.append((best, f))
    scored.sort(key=lambda s: (-s[0], s[1]["id"]))
    matches = [_match(f, round(s, 1)) for s, f in scored[:3]]
    ambiguous = len(matches) > 1 and (matches[0].score - matches[1].score) <= 5
    return FacilityResolution(matches, ambiguous)


def _match(f: dict[str, Any], score: float) -> FacilityMatch:
    return FacilityMatch(
        id=f["id"],
        name=f["name"],
        district_id=f["district_id"],
        type=f.get("type", ""),
        score=score,
    )

