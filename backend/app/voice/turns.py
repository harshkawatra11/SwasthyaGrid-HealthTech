"""Turn controller: owns at most one active turn per voice session.

Rules (plan 7.3):

- STT finals arriving within `coalesce_ms` of each other form one user turn.
  Typed text bypasses coalescing (`start_turn` directly).
- Barge-in: `on_speech_start` arms it while a turn is thinking or speaking; it
  is confirmed by a partial transcript of at least two words, and never within
  400 ms of the turn's first audio (the assistant's own voice leaking into the
  mic must not interrupt itself). An explicit Stop (`cancel_current`) needs no
  word check.
- Every new utterance cancels the old turn (awaiting its cleanup) and the
  `on_cancel` callback tells the client (`interrupted`) and the TTS stream.
- `run_turn` must only catch `asyncio.CancelledError` in `finally` blocks and
  re-raise it. History for an interrupted turn is handled by the session.
"""

import asyncio
import contextlib
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

logger = logging.getLogger("swasthyagrid.voice")

BARGE_GUARD_MS = 400
MIN_BARGE_WORDS = 2


@dataclass
class Turn:
    id: str
    text: str
    language: str
    client_turn_id: str | None
    received_at: float  # clock time of the last STT final (or the typed text)
    started_at: float
    canned: str | None = None  # a fixed line to speak instead of asking the model
    first_audio_at: float | None = None
    audio_seconds: float = 0.0
    task: "asyncio.Task | None" = field(default=None, repr=False)
    completed: bool = False
    cancelled: bool = False
    meta: dict = field(default_factory=dict)  # owner-defined flags (the session uses it)

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def note_audio(self, seconds: float, now: float) -> None:
        if self.first_audio_at is None:
            self.first_audio_at = now
        self.audio_seconds += seconds


RunTurn = Callable[[Turn], Awaitable[None]]
OnCancel = Callable[[Turn, str], Awaitable[None]]


class TurnController:
    """Owns at most one active turn. Every new user utterance cancels the old turn."""

    def __init__(
        self,
        run_turn: RunTurn,
        coalesce_ms: int = 350,
        *,
        on_cancel: OnCancel | None = None,
        clock: Callable[[], float] = time.monotonic,
        barge_guard_ms: int = BARGE_GUARD_MS,
        min_barge_words: int = MIN_BARGE_WORDS,
    ):
        self._run_turn = run_turn
        self._coalesce_s = coalesce_ms / 1000.0
        self._on_cancel = on_cancel
        self._clock = clock
        self._guard_s = barge_guard_ms / 1000.0
        self._min_words = min_barge_words
        self.current: Turn | None = None
        self._pending: list[str] = []
        self._pending_language = "en-IN"
        self._pending_client_id: str | None = None
        self._pending_received_at = 0.0
        self._timer: asyncio.TimerHandle | None = None
        self._bg: set[asyncio.Task] = set()
        self._lock = asyncio.Lock()
        self._armed = False
        self.closed = False

    # ------------------------------------------------------------ utterances

    def on_final(self, text: str, language: str, client_turn_id: str | None = None) -> None:
        """Buffer a final transcript and (re)arm the coalescing timer."""
        text = text.strip()
        if self.closed or not text:
            return
        self._armed = False
        self._pending.append(text)
        self._pending_language = language
        if client_turn_id:
            self._pending_client_id = client_turn_id
        self._pending_received_at = self._clock()
        if self._timer is not None:
            self._timer.cancel()
        loop = asyncio.get_running_loop()
        self._timer = loop.call_later(self._coalesce_s, self._fire)

    def _fire(self) -> None:
        self._timer = None
        if self.closed or not self._pending:
            return
        task = asyncio.get_running_loop().create_task(self._start_pending())
        self._bg.add(task)
        task.add_done_callback(self._bg.discard)

    async def _start_pending(self) -> None:
        if not self._pending:
            return
        text = " ".join(self._pending)
        language, client_id, received = (
            self._pending_language,
            self._pending_client_id,
            self._pending_received_at,
        )
        self._pending.clear()
        self._pending_client_id = None
        await self.start_turn(text, language, client_id, received_at=received)

    async def start_turn(
        self,
        text: str,
        language: str,
        client_turn_id: str | None = None,
        *,
        canned: str | None = None,
        received_at: float | None = None,
    ) -> Turn | None:
        """Cancel the current turn (awaiting its cleanup), then launch a new one."""
        if self.closed:
            return None
        async with self._lock:
            if self._timer is not None and canned is None:
                # A typed turn bypasses coalescing and supersedes buffered speech.
                self._timer.cancel()
                self._timer = None
                self._pending.clear()
                self._pending_client_id = None
            await self._cancel_locked("new_turn")
            if self.closed:
                return None
            now = self._clock()
            turn = Turn(
                id=uuid.uuid4().hex,
                text=text,
                language=language,
                client_turn_id=client_turn_id,
                received_at=received_at if received_at is not None else now,
                started_at=now,
                canned=canned,
            )
            self._armed = False
            self.current = turn
            turn.task = asyncio.get_running_loop().create_task(self._run(turn))
            return turn

    async def _run(self, turn: Turn) -> None:
        try:
            await self._run_turn(turn)
            turn.completed = True
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("voice turn %s crashed", turn.id)

    # --------------------------------------------------------------- barge-in

    def _playing(self, turn: Turn) -> bool:
        """True while the browser is still expected to be playing this turn's audio."""
        return turn.first_audio_at is not None and self._clock() < turn.first_audio_at + turn.audio_seconds

    def _active(self) -> bool:
        cur = self.current
        return cur is not None and not cur.cancelled and (cur.running or self._playing(cur))

    def on_speech_start(self) -> None:
        """VAD speech start: arm a barge-in if a turn is thinking or speaking."""
        if self._active():
            self._armed = True

    async def on_partial(self, text: str) -> None:
        """A partial transcript: confirm an armed barge-in when it is long enough."""
        if not self._armed or not self._active():
            return
        if len(text.split()) < self._min_words:
            return
        cur = self.current
        if (
            cur is not None
            and cur.first_audio_at is not None
            and self._clock() - cur.first_audio_at < self._guard_s
        ):
            return  # too soon after the assistant started talking: likely echo
        self._armed = False
        await self.cancel_current("barge_in")

    # ------------------------------------------------------------ cancellation

    async def cancel_current(self, reason: str, *, notify: bool = True) -> None:
        """Stop the current turn now: cancel its task, wait for cleanup, then
        `on_cancel` (which sends `interrupted` and drops TTS)."""
        await self._cancel_locked(reason, notify=notify)

    async def _cancel_locked(self, reason: str, *, notify: bool = True) -> None:
        turn = self.current
        if turn is None or turn.cancelled:
            return
        was_running = turn.running
        if not was_running and not self._playing(turn):
            return
        turn.cancelled = True
        if was_running and turn.task is not None:
            turn.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await turn.task
        self._armed = False
        if notify and self._on_cancel is not None:
            try:
                await self._on_cancel(turn, reason)
            except Exception:
                logger.exception("on_cancel failed for turn %s", turn.id)

    async def interrupt(self) -> None:
        """The Stop button: drop buffered speech and stop immediately."""
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        self._pending.clear()
        await self.cancel_current("stop")

    def is_current(self, turn: Turn) -> bool:
        return self.current is turn and not turn.cancelled and not self.closed

    async def close(self) -> None:
        """Dispose: cancel timers and the current turn without notifying the client."""
        if self.closed:
            return
        self.closed = True
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        self._pending.clear()
        turn = self.current
        if turn is not None and turn.running and turn.task is not None:
            turn.cancelled = True
            turn.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await turn.task
        for task in list(self._bg):
            task.cancel()
