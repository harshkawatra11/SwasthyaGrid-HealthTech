"""Simulation clock (section 5.8) and time helpers."""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from functools import lru_cache

IST = timezone(timedelta(hours=5, minutes=30), "IST")


def iso(dt: datetime) -> str:
    """`YYYY-MM-DDTHH:MM:SSZ` in UTC (0.5 rule 2)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@lru_cache(maxsize=16384)
def parse_iso(text: str) -> datetime:
    """Parse an ISO-8601 string (with `Z` or an offset) to an aware UTC datetime."""
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def ist_hour(dt: datetime) -> int:
    return dt.astimezone(IST).hour


def ist_day_start(dt: datetime) -> datetime:
    """Midnight IST of the IST calendar day containing `dt`, as aware UTC."""
    local = dt.astimezone(IST)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


def today_0830_ist(real_now: datetime | None = None) -> datetime:
    """08:30 IST of the current real date (default scenario start), as aware UTC."""
    local = (real_now or datetime.now(UTC)).astimezone(IST)
    return local.replace(hour=8, minute=30, second=0, microsecond=0).astimezone(UTC)


@dataclass
class SimClock:
    anchor_real: float  # time.time() when anchored
    anchor_sim: datetime  # aware UTC
    scale: float  # simulated seconds per real second
    time_fn: Callable[[], float] = field(default=time.time, repr=False)  # injectable for tests

    def now(self, real: float | None = None) -> datetime:
        r = self.time_fn() if real is None else real
        return self.anchor_sim + timedelta(seconds=(r - self.anchor_real) * self.scale)

    def rescale(self, new_scale: float) -> None:
        self.anchor_sim = self.now()
        self.anchor_real = self.time_fn()
        self.scale = new_scale

    def reanchor(self, sim_now: datetime) -> None:
        """Set the clock to read `sim_now` right now (used on boot and reset)."""
        self.anchor_sim = sim_now
        self.anchor_real = self.time_fn()
