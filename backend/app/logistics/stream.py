"""Live stream plumbing (section 6.4): `StreamHub`, `sse_events` and the `TickLoop`.

The hub registers itself as a tick listener on the `LogisticsService`. Every tick result
is turned into SSE frames and fanned out to per-client queues. `sse_events` is an async
generator over one client's queue, which is what the route wraps in `EventSourceResponse`
and what the tests read directly.
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("swasthyagrid")

QUEUE_SIZE = 200
KPI_INTERVAL_SECONDS = 5.0
DROPPABLE = "tick"


def _frame(event: str, payload: Any) -> dict:
    return {"event": event, "data": json.dumps(payload, separators=(",", ":"))}


@dataclass(eq=False)
class Subscriber:
    district_id: str | None
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=QUEUE_SIZE))
    last_kpis: float = 0.0

    def push(self, frame: dict) -> None:
        """Enqueue a frame. A full queue sheds old `tick` frames first, never anything else."""
        q = self.queue
        if q.full():
            for item in list(q._queue):  # type: ignore[attr-defined]
                if item["event"] == DROPPABLE:
                    q._queue.remove(item)  # type: ignore[attr-defined]
                    break
            else:
                if frame["event"] == DROPPABLE:
                    return
                q.get_nowait()  # a dead client: make room rather than block the world
        q.put_nowait(frame)


class StreamHub:
    def __init__(self, service: Any = None):
        self.service = service
        self._subs: set[Subscriber] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        if service is not None:
            service.add_tick_listener(self.on_tick)

    # ------------------------------------------------------------------ subscribers

    def subscribe(self, district_id: str | None = None) -> Subscriber:
        self._loop = asyncio.get_running_loop()
        sub = Subscriber(district_id)
        self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        self._subs.discard(sub)

    @property
    def size(self) -> int:
        return len(self._subs)

    # ------------------------------------------------------------------ fan out

    def on_tick(self, result: dict) -> None:
        """Called by the service after each tick, from any thread."""
        loop = self._loop
        if not self._subs or loop is None:
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            self._dispatch(result)
        elif not loop.is_closed():
            loop.call_soon_threadsafe(self._dispatch, result)

    def _dispatch(self, result: dict) -> None:
        now = time.monotonic()
        for sub in list(self._subs):
            scope = sub.district_id
            positions = [
                p["position"]
                for p in result.get("positions", [])
                if not scope or p["district_id"] == scope
            ]
            sub.push(_frame("tick", {"sim_now": result["sim_now"], "positions": positions}))
            for ev in result.get("events", []):
                if not scope or ev["district_id"] == scope:
                    sub.push(_frame("shipment", ev))
            for r in result.get("risk") or []:
                if not scope or r["district_id"] == scope:
                    sub.push(_frame("risk", r))
            if result.get("recommendations"):
                sub.push(_frame("recommendations", result["recommendations"]))
            if self.service is not None and now - sub.last_kpis >= KPI_INTERVAL_SECONDS:
                sub.last_kpis = now
                try:
                    sub.push(_frame("kpis", self.service.kpis(scope)))
                except Exception:
                    logger.exception("kpis frame failed")


def sse_events(hub: StreamHub, district_id: str | None = None) -> AsyncIterator[dict]:
    """Subscribe now and return an async iterator of `{"event", "data"}` dicts.

    Subscribing eagerly (not on the first `anext`) means a caller can subscribe, drive
    `service.tick(...)` and then read, without racing the generator start.
    """
    sub = hub.subscribe(district_id)

    async def gen() -> AsyncIterator[dict]:
        try:
            while True:
                yield await sub.queue.get()
        finally:
            hub.unsubscribe(sub)

    return gen()


class TickLoop:
    """One asyncio task that ticks the world once per real second."""

    def __init__(self, service: Any, interval: float = 1.0):
        self.service = service
        self.interval = interval
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.get_running_loop().create_task(self._run(), name="logistics-tick")

    async def _run(self) -> None:
        while True:
            started = time.monotonic()
            try:
                await asyncio.to_thread(self.service.tick)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("logistics tick failed")
            await asyncio.sleep(max(0.05, self.interval - (time.monotonic() - started)))

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
