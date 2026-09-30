"""TurnController: coalescing, barge-in rules, cancellation. Short timers and a
fake clock; no network."""

import asyncio

import pytest

from app.voice.turns import Turn, TurnController


@pytest.fixture
def anyio_backend():
    return "asyncio"


class Harness:
    def __init__(self, coalesce_ms: int = 40, block: bool = True):
        self.now = 100.0
        self.started: list[Turn] = []
        self.finished: list[str] = []
        self.cancelled: list[tuple[str, str]] = []
        self.history: list[dict] = [{"role": "system", "content": "s"}]
        self.block = block
        self.release = asyncio.Event()

        async def run_turn(turn: Turn) -> None:
            self.started.append(turn)
            self.history.append({"role": "user", "content": turn.text})
            try:
                if self.block:
                    await self.release.wait()
            finally:
                pass  # release resources only, then let CancelledError propagate
            self.history.append({"role": "assistant", "content": f"answer to {turn.text}"})
            self.finished.append(turn.id)

        async def on_cancel(turn: Turn, reason: str) -> None:
            self.cancelled.append((turn.id, reason))

        self.ctl = TurnController(
            run_turn, coalesce_ms=coalesce_ms, on_cancel=on_cancel, clock=lambda: self.now
        )


@pytest.mark.anyio
async def test_two_finals_within_window_form_one_turn():
    h = Harness(block=False)
    h.ctl.on_final("How many", "en-IN")
    await asyncio.sleep(0.01)
    h.ctl.on_final("facilities are critical", "en-IN")
    await asyncio.sleep(0.15)
    assert [t.text for t in h.started] == ["How many facilities are critical"]


@pytest.mark.anyio
async def test_final_after_window_starts_new_turn_and_cancels_old():
    h = Harness()
    h.ctl.on_final("first question", "en-IN")
    await asyncio.sleep(0.12)
    assert len(h.started) == 1
    first = h.started[0]
    h.ctl.on_final("second question", "hi-IN")
    await asyncio.sleep(0.12)
    assert [t.text for t in h.started] == ["first question", "second question"]
    assert first.cancelled and first.task.done()
    assert h.cancelled == [(first.id, "new_turn")]
    assert h.started[1].language == "hi-IN"
    h.release.set()
    await asyncio.sleep(0.02)
    assert h.finished == [h.started[1].id]


@pytest.mark.anyio
async def test_typed_text_bypasses_coalescing():
    h = Harness(coalesce_ms=500, block=False)
    turn = await h.ctl.start_turn("typed", "en-IN", "c1")
    await asyncio.sleep(0.02)
    assert turn is not None and turn.client_turn_id == "c1"
    assert [t.text for t in h.started] == ["typed"]


@pytest.mark.anyio
async def test_cancelled_turn_never_appends_assistant_message():
    h = Harness()
    await h.ctl.start_turn("question one", "en-IN")
    await asyncio.sleep(0.02)
    await h.ctl.cancel_current("stop")
    assert h.finished == []
    assert [m["role"] for m in h.history] == ["system", "user"]
    assert h.cancelled and h.cancelled[0][1] == "stop"


@pytest.mark.anyio
async def test_speech_start_then_two_word_partial_interrupts_speaking_turn():
    h = Harness()
    turn = await h.ctl.start_turn("q", "en-IN")
    await asyncio.sleep(0.01)
    turn.note_audio(5.0, h.now)  # first audio now, five seconds of speech queued
    h.now += 1.0  # well past the 400 ms echo guard
    h.ctl.on_speech_start()
    await h.ctl.on_partial("stop")  # one word: not enough
    assert not turn.cancelled
    await h.ctl.on_partial("wait a moment")
    assert turn.cancelled
    assert h.cancelled == [(turn.id, "barge_in")]


@pytest.mark.anyio
async def test_barge_in_ignored_within_400ms_of_first_audio():
    h = Harness()
    turn = await h.ctl.start_turn("q", "en-IN")
    await asyncio.sleep(0.01)
    turn.note_audio(5.0, h.now)
    h.now += 0.2
    h.ctl.on_speech_start()
    await h.ctl.on_partial("two words")
    assert not turn.cancelled and not h.cancelled
    h.now += 0.3  # now 500 ms after first audio; a later partial confirms
    await h.ctl.on_partial("two words more")
    assert turn.cancelled


@pytest.mark.anyio
async def test_speech_start_while_idle_does_not_arm():
    h = Harness(block=False)
    await h.ctl.start_turn("q", "en-IN")
    await asyncio.sleep(0.02)  # turn finished, no audio was queued
    h.ctl.on_speech_start()
    await h.ctl.on_partial("some words here")
    assert h.cancelled == []


@pytest.mark.anyio
async def test_barge_in_while_thinking_cancels_without_audio():
    h = Harness()
    turn = await h.ctl.start_turn("q", "en-IN")
    await asyncio.sleep(0.01)
    h.ctl.on_speech_start()
    await h.ctl.on_partial("actually kota instead")
    assert turn.cancelled and turn.task.done()


@pytest.mark.anyio
async def test_barge_in_after_turn_finished_but_audio_still_playing():
    h = Harness(block=False)
    turn = await h.ctl.start_turn("q", "en-IN")
    await asyncio.sleep(0.02)
    assert turn.completed
    turn.note_audio(4.0, h.now)
    h.now += 1.0
    h.ctl.on_speech_start()
    await h.ctl.on_partial("hold on please")
    assert h.cancelled == [(turn.id, "barge_in")]


@pytest.mark.anyio
async def test_interrupt_stops_immediately_without_word_check():
    h = Harness()
    turn = await h.ctl.start_turn("q", "en-IN")
    await asyncio.sleep(0.01)
    turn.note_audio(5.0, h.now)  # audio just started: barge-in guard would refuse
    await h.ctl.interrupt()
    assert turn.cancelled and h.cancelled == [(turn.id, "stop")]


@pytest.mark.anyio
async def test_interrupt_drops_buffered_speech():
    h = Harness(coalesce_ms=200, block=False)
    h.ctl.on_final("half a question", "en-IN")
    await h.ctl.interrupt()
    await asyncio.sleep(0.3)
    assert h.started == []


@pytest.mark.anyio
async def test_close_cancels_turn_and_timer_without_notifying():
    h = Harness()
    turn = await h.ctl.start_turn("q", "en-IN")
    h.ctl.on_final("later", "en-IN")
    await asyncio.sleep(0.01)
    await h.ctl.close()
    await asyncio.sleep(0.1)
    assert turn.cancelled and h.cancelled == []
    assert len(h.started) == 1
