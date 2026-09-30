"""VoiceSession protocol 2 with all Sarvam calls mocked."""

import asyncio
import logging
import threading
from unittest.mock import AsyncMock

import pytest

from app.tools.v2 import ToolResult
from app.voice import sarvam_chat
from app.voice import session as session_mod
from tests.test_voice_fakes import (
    ChatScript,
    FakeTts,
    district_tool,
    make_session,
    run_typed,
    text_delta,
    tool_delta,
    wav_synthesis,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _use(monkeypatch, script: ChatScript) -> ChatScript:
    monkeypatch.setattr(sarvam_chat, "stream_chat", script)
    return script


DISTRICT_TOOLS = {"get_district_briefing": lambda district: district_tool(district)}


@pytest.mark.anyio
async def test_tool_path_emits_full_frame_sequence(monkeypatch):
    script = _use(
        monkeypatch,
        ChatScript(
            [tool_delta("get_district_briefing", '{"district": "Kota"}')],
            [text_delta("Kota has two critical "), text_delta("facilities. "), text_delta("Stock is tight.")],
        ),
    )
    session, frames, tts = make_session(tools=DISTRICT_TOOLS)
    await run_typed(session, "How is Kota doing?", "c-1")

    kinds = frames.kinds()
    assert kinds[0] == "final"
    assert frames.of("final")[0]["clientTurnId"] == "c-1"
    assert frames.of("final")[0]["language"] == "en-IN"
    stages = [f["stage"] for f in frames.of("thinking")]
    assert stages == ["planning", "tools", "answering"]
    assert frames.of("thinking")[1]["label"] == "Checking Kota district data"
    tool = frames.of("tool")[0]
    assert (tool["name"], tool["args"], tool["ok"]) == ("get_district_briefing", {"district": "Kota"}, True)
    assert [f["text"] for f in frames.of("reply_delta")] == ["Kota has two critical facilities.", "Stock is tight."]
    reply = frames.of("reply")[0]
    assert reply["text"] == "Kota has two critical facilities. Stock is tight."
    assert reply["toolCalls"] == ["get_district_briefing"]
    assert reply["cards"][0]["type"] == "district_summary"
    assert reply["language"] == "en-IN"
    audio = frames.of("audio")
    assert audio and all(a["encoding"] == "pcm_s16le" and a["filler"] is False for a in audio)
    assert [a["seq"] for a in audio] == [0, 1]
    end = frames.of("turn_end")[0]
    assert end["metrics"]["tools"] == ["get_district_briefing"]
    assert end["metrics"]["finalToFirstTokenMs"] is not None
    assert end["metrics"]["finalToFirstAudioMs"] is not None
    assert kinds.index("tool") < kinds.index("reply_delta") < kinds.index("reply") < kinds.index("turn_end")

    assert [c["tool_choice"] for c in script.calls] == ["auto", "none"]
    second = script.calls[1]["messages"]
    assert second[0]["content"] == "SYSTEM"
    assert second[1]["role"] == "system" and second[1]["content"].startswith("Context: scope is")
    assert [m["role"] for m in second[2:]] == ["user", "assistant", "tool"]
    assert second[3]["tool_calls"][0]["function"]["name"] == "get_district_briefing"
    assert second[4]["tool_call_id"] == "call_1"
    assert tts.said == ["Kota has two critical facilities.", "Stock is tight."]
    assert tts.ended == 1


@pytest.mark.anyio
async def test_no_tool_path_streams_directly(monkeypatch):
    script = _use(monkeypatch, ChatScript([text_delta("ORS treats dehydration. "), text_delta("Mix it with clean water.")]))
    session, frames, _ = make_session(tools=DISTRICT_TOOLS)
    await run_typed(session, "What is ORS used for?")
    assert len(script.calls) == 1
    assert frames.of("tool") == []
    assert [f["stage"] for f in frames.of("thinking")] == ["planning"]
    reply = frames.of("reply")[0]
    assert reply["toolCalls"] == [] and reply["cards"] == []
    assert reply["text"] == "ORS treats dehydration. Mix it with clean water."
    assert session.history[-1] == {"role": "assistant", "content": reply["text"]}
    assert frames.of("turn_end")


@pytest.mark.anyio
async def test_markdown_is_stripped_before_speaking(monkeypatch):
    _use(monkeypatch, ChatScript([text_delta("**Kota** needs ARV (urgent). Call 108.")]))
    session, _frames, tts = make_session(tools={})
    await run_typed(session, "Kota ARV?")
    assert tts.said == ["Kota needs ARV.", "Call 108."]


@pytest.mark.anyio
async def test_interruption_mid_answer(monkeypatch):
    gate = asyncio.Event()
    _use(monkeypatch, ChatScript([text_delta("First sentence here. "), gate, text_delta("Never spoken.")]))
    session, frames, tts = make_session(tools={})
    await session.handle_typed_text("Tell me something long")
    turn = session.turns.current
    for _ in range(100):
        if frames.of("reply_delta"):
            break
        await asyncio.sleep(0.01)
    assert frames.of("reply_delta")
    await session.interrupt()
    assert turn.cancelled and turn.task.done()
    assert [f["turnId"] for f in frames.of("interrupted")] == [turn.id]
    assert frames.of("reply") == [] and frames.of("turn_end") == []
    assert tts.cancelled == 1
    assert tts.said == ["First sentence here."]
    roles = [m["role"] for m in session.history]
    assert roles == ["system", "user", "system"]
    assert session.history[-1]["content"] == session_mod.INTERRUPTED_NOTE
    # A new turn after the interruption works and sees the note.
    _use(monkeypatch, ChatScript([text_delta("Sure.")]))
    await run_typed(session, "Go on")
    assert frames.of("reply")[0]["text"] == "Sure."


@pytest.mark.anyio
async def test_new_final_cancels_the_running_turn(monkeypatch):
    gate = asyncio.Event()
    script = _use(monkeypatch, ChatScript([text_delta("Working on it. "), gate], [text_delta("Second answer.")]))
    session, frames, _ = make_session(tools={})
    await session.handle_typed_text("first")
    first = session.turns.current
    await asyncio.sleep(0.05)
    await run_typed(session, "second")
    assert first.cancelled
    assert [f["text"] for f in frames.of("reply")] == ["Second answer."]
    assert len(script.calls) == 2


@pytest.mark.anyio
async def test_hindi_typed_question_selects_hindi(monkeypatch):
    _use(monkeypatch, ChatScript([text_delta("Theek hai.")], [text_delta("Fine.")], [text_delta("ठीक है।")]))
    session, frames, tts = make_session(tools={})
    await run_typed(session, "Kota district mein kya haal hai?")
    assert frames.of("final")[0]["language"] == "hi-IN"
    assert tts.language == "hi-IN"
    assert frames.of("reply")[0]["language"] == "hi-IN"
    await run_typed(session, "How many shipments are delayed?")
    assert frames.of("final")[1]["language"] == "en-IN"
    assert tts.language == "en-IN"
    await run_typed(session, "कोटा का हाल")
    assert frames.of("final")[2]["language"] == "hi-IN"


@pytest.mark.anyio
async def test_explicit_language_preference_wins(monkeypatch):
    _use(monkeypatch, ChatScript([text_delta("Ok.")]))
    session, frames, _ = make_session(tools={})
    session.language = "hi-IN"
    await run_typed(session, "How many shipments are delayed?")
    assert frames.of("final")[0]["language"] == "hi-IN"


@pytest.mark.anyio
async def test_context_note_reflects_last_facility_and_scope(monkeypatch):
    script = _use(
        monkeypatch,
        ChatScript(
            [tool_delta("get_facility_status", '{"facility": "Kota ka PHC 4"}')],
            [text_delta("PHC Kota-4 is fine.")],
            [text_delta("Yes.")],
        ),
    )
    tools = {"get_facility_status": lambda facility: ToolResult({"facility": facility})}
    session, _, _ = make_session(tools=tools)
    session.scope = "district_kota"
    await run_typed(session, "How is Kota ka PHC 4?")
    assert session.last_facility == "PHC Kota-4"
    assert session.last_district == "district_kota"
    await run_typed(session, "And beds there?")
    first_note = script.calls[0]["messages"][1]["content"]
    last_note = script.calls[2]["messages"][1]["content"]
    assert "Last facility discussed: none" in first_note
    assert "scope is Kota." in first_note
    assert "Last facility discussed: PHC Kota-4" in last_note
    assert "Simulated time now:" in last_note and " IST, " in last_note
    # The note is replaced, never accumulated.
    assert sum(1 for m in script.calls[2]["messages"] if m["role"] == "system" and m["content"].startswith("Context:")) == 1
    assert not any(m["content"].startswith("Context:") for m in session.history if m["content"])


@pytest.mark.anyio
async def test_context_frame_updates_scope_and_facility():
    session, _, _ = make_session(tools={})
    await session.handle_context({"scope": "district_alwar", "facilityId": "kota_phc_4"})
    assert session.scope == "district_alwar"
    assert session.last_facility == "PHC Kota-4"
    await session.handle_context({"facilityId": None})
    assert session.last_facility is None


def _assert_history_wellformed(history: list[dict]) -> None:
    assert history[0]["role"] == "system" and history[0]["content"] == "SYSTEM"
    assert history[1]["role"] == "user"  # trimming always cuts at a user message
    open_ids: set[str] = set()
    for m in history[1:]:
        if m["role"] == "assistant" and m.get("tool_calls"):
            open_ids = {c["id"] for c in m["tool_calls"]}
        elif m["role"] == "tool":
            assert m["tool_call_id"] in open_ids, "orphan tool message"
        else:
            open_ids = set()


@pytest.mark.anyio
async def test_history_never_orphans_tool_messages_after_20_turns(monkeypatch):
    big = {"rows": ["x" * 100] * 30}
    script = ChatScript()
    for i in range(20):
        script.responses.append([tool_delta("get_district_briefing", '{"district": "Kota"}', call_id=f"call_{i}")])
        script.responses.append([text_delta(f"Answer {i}.")])
    _use(monkeypatch, script)
    tools = {"get_district_briefing": lambda district: ToolResult(big)}
    session, _, _ = make_session(tools=tools)
    for i in range(20):
        await run_typed(session, f"Question {i}")
        _assert_history_wellformed(session.history)
    users = [m for m in session.history if m["role"] == "user"]
    assert len(users) == session_mod.HISTORY_EXCHANGES
    assert users[-1]["content"] == "Question 19"
    tool_msgs = [m for m in session.history if m["role"] == "tool"]
    assert tool_msgs and all(len(m["content"]) <= 600 + len("...truncated") for m in tool_msgs)
    assert any(m["content"].endswith("...truncated") for m in tool_msgs)
    # Every call the model received was also well formed.
    for call in script.calls:
        _assert_history_wellformed([call["messages"][0], *call["messages"][2:]])


@pytest.mark.anyio
async def test_tool_exception_gives_spoken_fallback_and_error_frame(monkeypatch, caplog):
    _use(monkeypatch, ChatScript([tool_delta("get_district_briefing", '{"district": "Kota"}')]))

    def boom(district):
        raise RuntimeError("data source down")

    session, frames, tts = make_session(tools={"get_district_briefing": boom})
    with caplog.at_level(logging.WARNING):
        await run_typed(session, "How is Kota?")
    tool = frames.of("tool")[0]
    assert tool["ok"] is False
    err = frames.of("error")[0]
    assert err["code"] == "tool_error" and err["fatal"] is False
    fallback = "Sorry, I could not reach the data service. Please try again."
    assert tts.said == [fallback]
    assert frames.of("reply")[0]["text"] == fallback
    assert frames.of("turn_end")
    assert session.history[-1] == {"role": "assistant", "content": fallback}
    assert [m["role"] for m in session.history] == ["system", "user", "assistant"]


@pytest.mark.anyio
async def test_tool_returning_error_payload_continues_to_the_model(monkeypatch):
    _use(
        monkeypatch,
        ChatScript([tool_delta("get_district_briefing", '{"district": "Mars"}')], [text_delta("I do not know that district.")]),
    )
    tools = {"get_district_briefing": lambda district: ToolResult({"error": f"Unknown district '{district}'"})}
    session, frames, _ = make_session(tools=tools)
    await run_typed(session, "How is Mars?")
    assert frames.of("tool")[0]["ok"] is False
    assert frames.of("error") == []
    assert frames.of("reply")[0]["text"] == "I do not know that district."
    assert session.last_district is None


@pytest.mark.anyio
async def test_unknown_tool_and_bad_arguments_are_soft_errors(monkeypatch):
    _use(
        monkeypatch,
        ChatScript(
            [tool_delta("no_such_tool", "{}", "a"), tool_delta("get_district_briefing", '{"wrong": 1}', "b", index=1)],
            [text_delta("Sorry.")],
        ),
    )
    session, frames, _ = make_session(tools=DISTRICT_TOOLS)
    await run_typed(session, "x")
    assert [t["ok"] for t in frames.of("tool")] == [False, False]
    assert frames.of("error") == [] and frames.of("reply")


@pytest.mark.anyio
async def test_tool_calls_in_a_round_run_concurrently_and_rounds_are_capped(monkeypatch):
    barrier = threading.Barrier(2, timeout=3)

    def a(district):
        barrier.wait()  # only passes if both tools run at the same time
        return ToolResult({"a": 1})

    def b(district):
        barrier.wait()
        return ToolResult({"b": 1})

    calls = [tool_delta("a", "{}", "1", 0), tool_delta("b", "{}", "2", 1)]
    script = _use(
        monkeypatch,
        ChatScript(calls, [tool_delta("get_state_briefing", "{}", "3")], [tool_delta("get_state_briefing", "{}", "4")],
                   [tool_delta("get_state_briefing", "{}", "5")]),
    )
    tools = {"a": a, "b": b, "get_state_briefing": lambda: ToolResult({"ok": 1})}
    session, frames, _ = make_session(tools=tools)
    await run_typed(session, "everything")
    assert len(frames.of("tool")) == 4  # 2 + 1 + 1 (three rounds), the fourth request is dropped
    assert len(script.calls) == 4
    assert frames.of("error") == []
    assert frames.of("reply")[0]["text"].startswith("I could not find grounded data")


@pytest.mark.anyio
async def test_non_streaming_planning_when_flag_is_off(monkeypatch):
    stream = _use(monkeypatch, ChatScript([text_delta("Streamed answer.")]))
    results = [
        sarvam_chat.ChatResult(
            None,
            [{"id": "c1", "function": {"name": "get_district_briefing", "arguments": '{"district": "Kota"}'}}],
            "tool_calls",
        ),
    ]
    complete = AsyncMock(side_effect=results)
    monkeypatch.setattr(sarvam_chat, "chat_completion", complete)
    session, frames, _ = make_session(tools=DISTRICT_TOOLS, sarvam_stream_with_tools=False)
    await run_typed(session, "How is Kota?")
    assert complete.await_count == 1
    assert [c["tool_choice"] for c in stream.calls] == ["none"]  # only the answer call streams
    assert frames.of("reply")[0]["text"] == "Streamed answer."

    complete2 = AsyncMock(return_value=sarvam_chat.ChatResult("Direct answer. Two sentences.", None, "stop"))
    monkeypatch.setattr(sarvam_chat, "chat_completion", complete2)
    await run_typed(session, "What is ORS?")
    assert frames.of("reply")[1]["text"] == "Direct answer. Two sentences."
    assert [f["text"] for f in frames.of("reply_delta")][-2:] == ["Direct answer.", "Two sentences."]


@pytest.mark.anyio
async def test_filler_plays_once_while_a_slow_tool_runs(monkeypatch):
    monkeypatch.setattr(session_mod, "FILLER_DELAY_S", 0.02)
    monkeypatch.setattr(session_mod.fillers, "get_filler", AsyncMock(return_value=wav_synthesis()))
    _use(monkeypatch, ChatScript([tool_delta("slow")], [text_delta("Done.")]))

    def slow():
        import time

        time.sleep(0.25)
        return ToolResult({"ok": 1})

    session, frames, _ = make_session(tools={"slow": slow})
    await run_typed(session, "slow one")
    audio = frames.of("audio")
    fillers = [a for a in audio if a["filler"]]
    assert len(fillers) == 1 and fillers[0]["encoding"] == "wav"
    answers = [a for a in audio if not a["filler"]]
    assert answers
    assert audio.index(fillers[0]) < audio.index(answers[0])
    metrics = frames.of("turn_end")[0]["metrics"]
    assert metrics["finalToFirstAudioMs"] <= metrics["finalToFirstAnswerAudioMs"]


@pytest.mark.anyio
async def test_no_filler_when_tools_finish_quickly(monkeypatch):
    monkeypatch.setattr(session_mod, "FILLER_DELAY_S", 0.3)
    get_filler = AsyncMock(return_value=wav_synthesis())
    monkeypatch.setattr(session_mod.fillers, "get_filler", get_filler)
    _use(monkeypatch, ChatScript([tool_delta("get_district_briefing", '{"district": "Kota"}')], [text_delta("Done.")]))
    session, frames, _ = make_session(tools=DISTRICT_TOOLS)
    await run_typed(session, "quick")
    await asyncio.sleep(0.4)
    assert not [a for a in frames.of("audio") if a["filler"]]
    assert get_filler.await_count == 0


@pytest.mark.anyio
async def test_send_after_close_does_not_raise_or_log(caplog):
    calls = []

    async def dead_sender(frame):
        calls.append(frame)
        raise RuntimeError('Cannot call "send" once a close message has been sent.')

    session, _, _ = make_session(tools={})
    session.send = dead_sender
    with caplog.at_level(logging.WARNING):
        await session._send({"t": "partial", "text": "x"})
        await session._send({"t": "partial", "text": "y"})  # short-circuits, does not touch the socket
        await session.dispose()
        await session.dispose()
        await session._send({"t": "partial", "text": "z"})
    assert len(calls) == 1
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []


@pytest.mark.anyio
async def test_dispose_cancels_turn_and_closes_tts_and_stt(monkeypatch):
    gate = asyncio.Event()
    _use(monkeypatch, ChatScript([text_delta("Talking. "), gate]))
    session, _frames, tts = make_session(tools={})
    stt = AsyncMock()
    session._stt_handle = stt
    await session.handle_typed_text("hello there")
    turn = session.turns.current
    await asyncio.sleep(0.05)
    await session.dispose()
    assert turn.cancelled and turn.task.done()
    assert tts.closed
    stt.end.assert_awaited_once()
    assert session.turns.closed


@pytest.mark.anyio
async def test_ptt_up_flushes_stt_and_down_stops_the_assistant(monkeypatch):
    gate = asyncio.Event()
    _use(monkeypatch, ChatScript([text_delta("Talking. "), gate]))
    session, frames, _ = make_session(tools={})
    stt = AsyncMock()
    session._stt_handle = stt
    await session.handle_typed_text("hello there")
    await asyncio.sleep(0.05)
    await session.handle_ptt("down")
    assert frames.of("interrupted")
    await session.handle_ptt("up")
    stt.flush.assert_awaited_once()


@pytest.mark.anyio
async def test_stt_events_drive_vad_partials_and_coalesced_turns(monkeypatch):
    _use(monkeypatch, ChatScript([text_delta("Answer.")]))
    session, frames, _ = make_session(tools={})
    await session._on_stt_event({"event": "vad.speech_start"})
    await session._on_stt_event({"event": "transcript.partial", "text": "how many"})
    await session._on_stt_event({"event": "vad.speech_end"})
    await session._on_stt_event({"event": "transcript.final", "text": "How many", "language": "en-IN"})
    await session._on_stt_event({"event": "transcript.final", "text": "shipments are late", "language": "en-IN"})
    await asyncio.sleep(0.7)
    assert [f["state"] for f in frames.of("vad")] == ["start", "end"]
    assert frames.of("partial")[0]["text"] == "how many"
    assert frames.of("final")[0]["text"] == "How many shipments are late"
    assert frames.of("final")[0]["language"] == "en-IN"
    assert frames.of("reply")[0]["text"] == "Answer."


@pytest.mark.anyio
async def test_start_sends_ready_v2_and_speaks_the_greeting(monkeypatch):
    monkeypatch.setattr(session_mod.sarvam_stt, "open_stt_socket", AsyncMock(side_effect=RuntimeError("no live STT")))
    session, frames, _tts = make_session(tools={})
    await session.start(language="en-IN", scope="district_kota", mode="ptt", protocol=2)
    ready = frames.of("ready")[0]
    assert ready["protocol"] == 2 and ready["sttMode"] == "rest" and ready["ttsMode"] == "ws"
    assert ready["speaker"] and ready["sessionId"] == session.session_id
    await asyncio.wait_for(session.turns.current.task, 2)
    reply = frames.of("reply")[0]
    assert reply["text"].startswith("Hello. I am Swasthya")
    assert reply["cards"] == [] and reply["language"] == "en-IN"
    assert frames.of("audio") and frames.of("turn_end")
    assert session.history == [session.history[0]]  # the greeting is not part of the conversation
    assert session.mode == "ptt" and session.scope == "district_kota"


@pytest.mark.anyio
async def test_speak_false_skips_tts_but_still_replies(monkeypatch):
    _use(monkeypatch, ChatScript([text_delta("Text only answer.")]))
    session, frames, _ = make_session(tools={}, tts=None, speak=False)
    await run_typed(session, "hello")
    assert frames.of("audio") == []
    assert frames.of("reply")[0]["text"] == "Text only answer."
    assert frames.of("turn_end")[0]["metrics"]["finalToFirstAudioMs"] is None


@pytest.mark.anyio
async def test_missing_api_key_reports_fatal_error():
    session, frames, _ = make_session(tools={}, sarvam_api_key="")
    await run_typed(session, "hello")
    err = frames.of("error")[0]
    assert err["fatal"] is True and err["code"] == "no_key" and "SARVAM_API_KEY" in err["message"]


def test_fake_tts_signature_matches_tts_stream():
    import inspect

    from app.voice.sarvam_tts_ws import TtsStream

    for name in ("begin_turn", "say", "end_turn", "cancel_turn", "close"):
        assert list(inspect.signature(getattr(FakeTts, name)).parameters) == list(
            inspect.signature(getattr(TtsStream, name)).parameters
        )
