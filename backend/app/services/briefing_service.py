"""Situation briefing (6.2).

A Sarvam chat completion (non-streaming, `reasoning_effort: null`, temperature 0.3,
max_tokens 400) turns the compact state summary into a two sentence situation paragraph
plus three to five bullets. Any failure, a missing key, or a reply that mentions a number
absent from the summary falls back to a deterministic template built from the same
numbers. Results are cached for 10 real minutes per (scope, repo version, sim time floor
to 30 minutes).
"""

import json
import logging
import re
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

import httpx

logger = logging.getLogger("swasthyagrid")

SARVAM_CHAT_URL = "https://api.sarvam.ai/v1/chat/completions"
CACHE_SECONDS = 600.0
MAX_BULLETS = 5
MIN_BULLETS = 3

SYSTEM_PROMPT = (
    "You write the situation briefing for a district health control room in Rajasthan. "
    "You receive a JSON summary of facility risk, stock, beds, staffing and deliveries. "
    "Rules: use only facts and numbers that appear in the JSON; never invent, estimate, "
    "round, convert or add numbers; write numbers exactly as given; do not use any digit "
    "that is not in the JSON. Output exactly: first a paragraph of two sentences "
    "describing the situation, then three to five lines that each start with '- ' and name "
    "a specific facility, district or action. No headings, no markdown other than the '- ' "
    "prefix, no preamble."
)

_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _n(value: float | None) -> str:
    """Numbers are printed exactly as they appear in the state summary."""
    if value is None:
        return "n/a"
    return f"{value:g}" if isinstance(value, float) else str(value)


def template_briefing(summary: dict, generated_at: datetime, cached: bool = False) -> dict:
    totals = summary["totals"]
    counts = totals["risk_counts"]
    districts = summary["districts"]
    scope_name = "Rajasthan" if summary["scope"] == "all" else districts[0]["name"]
    text = (
        f"{scope_name} has {_n(totals['facilities'])} facilities: {_n(counts['critical'])} critical, "
        f"{_n(counts['stress'])} under stress, {_n(counts['monitor'])} on watch and "
        f"{_n(counts['healthy'])} healthy. "
        f"{_n(totals['stockout_items'])} stock lines have under three days of cover and "
        f"{_n(totals['shipments_in_transit'])} shipments are on the road."
    )
    bullets: list[str] = []
    for r in summary["top_risks"][:2]:
        eta = f", shipment {r['inbound_shipment_id']} is on the way" if r["inbound_shipment_id"] else ""
        bullets.append(
            f"{r['facility_name']} has {_n(r['days_remaining'])} days of {r['medicine_name']}{eta}"
        )
    if len(districts) > 1:
        worst = max(districts, key=lambda d: d["risk_index"])
        bullets.append(f"{worst['name']} has the highest risk index at {_n(worst['risk_index'])}")
    if totals["bed_next_week_avg"] is not None:
        bullets.append(f"Average bed occupancy next week is {_n(totals['bed_next_week_avg'])} percent")
    bullets.append(f"{_n(totals['pending_recommendations'])} recommendations are waiting for approval")
    return {
        "text": text,
        "bullets": bullets[:MAX_BULLETS],
        "generated_at": generated_at,
        "model": "template",
        "cached": cached,
    }


def _plain(value: Any) -> Any:
    """JSON-safe copy of a summary (datetimes become ISO strings)."""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def numbers_in(value: Any) -> set[float]:
    """Every number in a JSON-like structure, plus the digits inside its strings (ids, names)."""
    out: set[float] = set()
    if isinstance(value, bool) or value is None:
        return out
    if isinstance(value, (int, float)):
        out.add(float(value))
    elif isinstance(value, str):
        out.update(float(m) for m in _NUMBER.findall(value))
    elif isinstance(value, dict):
        for k, v in value.items():
            out |= numbers_in(k) | numbers_in(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            out |= numbers_in(v)
    return out


def parse_reply(content: str) -> tuple[str, list[str]] | None:
    """Split a reply into (paragraph, bullets). None when it lacks the asked shape."""
    content = re.sub(r"<think>.*?</think>", "", content or "", flags=re.DOTALL).strip()
    paragraph: list[str] = []
    bullets: list[str] = []
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith(("- ", "* ")):
            bullets.append(line[2:].strip())
        elif not bullets:
            paragraph.append(line)
    text = " ".join(paragraph).strip()
    if not text or len(bullets) < MIN_BULLETS:
        return None
    return text, bullets[:MAX_BULLETS]


def stray_numbers(text: str, bullets: list[str], summary: dict) -> list[str]:
    allowed = numbers_in(_plain(summary))
    return [x for x in _NUMBER.findall(" ".join([text, *bullets])) if float(x) not in allowed]


class BriefingService:
    def __init__(
        self,
        settings,
        repo,
        logistics,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.settings = settings
        self.repo = repo
        self.logistics = logistics
        self._clock = clock
        self._cache: dict[tuple, tuple[float, dict]] = {}

    # ------------------------------------------------------------------ Sarvam

    def _post(self, payload: dict) -> dict:
        res = httpx.post(
            SARVAM_CHAT_URL,
            headers={
                "api-subscription-key": self.settings.sarvam_api_key,
                "content-type": "application/json",
            },
            json=payload,
            timeout=20.0,
        )
        if res.status_code != 200:
            raise RuntimeError(f"Sarvam chat completion failed ({res.status_code})")
        return res.json()

    def _payload(self, summary: dict) -> dict:
        facts = json.dumps(_plain(summary), separators=(",", ":"))
        return {
            "model": self.settings.sarvam_chat_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"State summary JSON:\n{facts}"},
            ],
            "temperature": 0.3,
            "max_tokens": 400,
            "reasoning_effort": None,
            "stream": False,
        }

    def sarvam_reply(self, summary: dict) -> str:
        data = self._post(self._payload(summary))
        return data["choices"][0]["message"].get("content") or ""

    def _generate(self, summary: dict, now: datetime) -> dict:
        if self.settings.sarvam_api_key:
            try:
                parsed = parse_reply(self.sarvam_reply(summary))
                if parsed is None:
                    raise ValueError("reply did not have a paragraph and bullets")
                text, bullets = parsed
                stray = stray_numbers(text, bullets, summary)
                if stray:
                    raise ValueError(f"reply mentions numbers absent from the summary: {stray}")
                return {
                    "text": text,
                    "bullets": bullets,
                    "generated_at": now,
                    "model": self.settings.sarvam_chat_model,
                    "cached": False,
                }
            except Exception as exc:
                logger.warning("Briefing falls back to the template: %s", exc)
        return template_briefing(summary, generated_at=now)

    # ------------------------------------------------------------------ cache

    def briefing(self, summary: dict, repo_version: int) -> dict:
        now = self.logistics.now()
        key = (summary["scope"], repo_version, int(now.timestamp() // 1800))
        tick = self._clock()
        hit = self._cache.get(key)
        if hit is not None and tick - hit[0] < CACHE_SECONDS:
            return {**hit[1], "cached": True}
        result = self._generate(summary, now)
        self._cache = {k: v for k, v in self._cache.items() if tick - v[0] < CACHE_SECONDS}
        self._cache[key] = (tick, result)
        return result
