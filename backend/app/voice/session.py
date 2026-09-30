"""One VoiceSession per WebSocket connection.

Wire protocol 2 (plan sections 7.2 to 7.9): streaming, interruptible turns. A
`TurnController` owns the active turn; `_run_turn_v2` plans (streaming, with
tools), runs up to three concurrent tool rounds, streams the answer through a
sentence segmenter into a TTS stream, and reports metrics in `turn_end`.

Every tool call runs against the same services layer the typed Ask endpoint
uses (see app.tools.v2), so a spoken and a typed answer can never disagree.
"""

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from fastapi import WebSocketDisconnect

from app.core.config import Settings
from app.prompts.voice_prompt import voice_system_prompt
from app.services.district_service import DistrictService
from app.services.forecast_service import ForecastService
from app.services.recommendation_service import RecommendationService
from app.tools.resolve import resolve_district, resolve_facility
from app.tools.schemas import TOOL_SCHEMAS
from app.tools.v2 import ToolResult, build_tool_functions, tool_label
from app.voice import fillers, sarvam_chat, sarvam_stt
from app.voice.sarvam_chat import ToolCallAccumulator
from app.voice.sarvam_tts_ws import AudioChunk, TtsStream
from app.voice.segmenter import SentenceSegmenter
from app.voice.speech import choose_language, fallback_text, prepare_speech
from app.voice.turns import Turn, TurnController

logger = logging.getLogger("swasthyagrid.voice")

LLM_TIMEOUT_S = 15.0  # planning and answer calls, each
TTS_TIMEOUT_S = 10.0
# Measured in B8: a direct answer starts streaming 0.8 to 0.9 s after the end of speech, so a
# filler earlier than that would talk over no-tool answers. It is armed when the turn starts.
FILLER_DELAY_S = 1.0
MAX_TOOL_ROUNDS = 3
HISTORY_EXCHANGES = 8
TOOL_COMPACT_CHARS = 600
RETRY_STATUSES = frozenset({429, 503})
MAX_RETRY_AFTER_S = 3.0
DEFAULT_RETRY_DELAY_S = 1.0  # used when a 429 or 503 carries no Retry-After header
IST = timezone(timedelta(hours=5, minutes=30))
INTERRUPTED_NOTE = "(The previous answer was interrupted by the officer.)"
NO_DATA_LINE = "I could not find grounded data for that. Could you name the district or facility again?"

GREETING = {
    "en-IN": "Hello. I am Swasthya, the control room voice analyst. Which district or facility shall we look at?",
    "hi-IN": "नमस्ते। मैं SwasthyaGrid control room में आपकी मदद के लिए हूँ। किस district या facility के बारे में जानना है?",
}

ERROR_MESSAGES = {
    "llm_timeout": "The assistant took too long to answer. Please try again.",
    "llm_busy": "The assistant is busy right now. Please try again in a moment.",
    "llm_error": "The assistant could not answer that. Please try again.",
    "tool_error": "A data lookup failed. Please try again.",
    "tts_timeout": "Speech output timed out. The answer is shown as text.",
    "tts_error": "Speech output failed. The answer is shown as text.",
    "no_key": "Voice agent is unavailable: SARVAM_API_KEY is not configured on the server.",
    "internal": "Something went wrong on this turn.",
}


class Sender(Protocol):
    """Whatever sends a JSON-serializable frame back to the browser. In
    production this is a bound `websocket.send_json`; tests pass a list-backed
    fake so turns can be asserted on without a real socket."""

    async def __call__(self, frame: dict[str, Any]) -> None: ...


class ToolFailure(Exception):
    """A tool raised (as opposed to returning an `error` payload)."""


@dataclass
class _Run:
    """Per-turn working state for protocol 2."""

    turn: Turn
    tools: list[str] = field(default_factory=list)
    cards: list[dict[str, Any]] = field(default_factory=list)
    spoken: list[str] = field(default_factory=list)
    audio_seq: int = 0
    first_token_at: float | None = None
    first_audio_at: float | None = None  # any audio, filler included
    first_answer_audio_at: float | None = None
    filler_armed: bool = False
    filler_fired: bool = False
    filler_task: "asyncio.Task | None" = None
    tts_task: "asyncio.Task | None" = None
    tts_ok: bool = True
    tts_error_sent: bool = False
    rounds: int = 0


def _audio_seconds(chunk_bytes: int, sample_rate_hz: int, encoding: str) -> float:
    if encoding == "wav":
        chunk_bytes = max(0, chunk_bytes - 44)
    return chunk_bytes / (max(1, sample_rate_hz) * 2)


def _ms(start: float, end: float | None) -> int | None:
    return None if end is None else max(0, round((end - start) * 1000))


@dataclass
class VoiceSession:
    settings: Settings
    district: DistrictService
    forecast: ForecastService
    recommendation: RecommendationService
    send: Sender

    session_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    language: str = "auto"  # the `hello` language preference (language_pref)
    history: list[dict[str, Any]] = field(default_factory=list)
    _tools: dict[str, Any] = field(default_factory=dict, repr=False)
    _stt_handle: Any = field(default=None, repr=False)
    _stt_failed_once: bool = False
    _stt_mode: str = "ws"
    disposed: bool = False

    # Protocol 2 state.
    protocol: int = 2
    scope: str | None = None
    mode: str = "handsfree"
    speak: bool = True
    tts: TtsStream | None = None
    logistics: Any = None
    insights: Any = None
    tools: dict[str, Callable[..., ToolResult]] | None = None  # test injection
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    last_district: str | None = None
    last_facility: str | None = None
    turns: TurnController = field(init=False, repr=False)
    _send_closed: bool = False
    _prewarm_task: "asyncio.Task | None" = field(default=None, repr=False)

    def __post_init__(self) -> None:
        self._tools = self.tools or build_tool_functions(
            self.district, self.forecast, self.recommendation, self.logistics, self.insights
        )
        self.turns = TurnController(
            self._run_turn_v2, on_cancel=self._on_turn_cancelled, clock=self.clock
        )

    @property
    def language_pref(self) -> str:
        return self.language

    # ---------------------------------------------------------------- start

    async def start(
        self,
        *,
        language: str = "auto",
        scope: str | None = None,
        mode: str = "handsfree",
        protocol: int = 2,
    ) -> None:
        if protocol != 2:
            raise ValueError("Only voice protocol 2 is supported")
        self.language = language
        self.scope = scope
        self.mode = mode
        self.history = [{"role": "system", "content": voice_system_prompt()}]

        await self._open_stt()
        real_tts = False
        if self.speak and self.tts is None and self.settings.sarvam_api_key:
            real_tts = True
            self.tts = TtsStream(
                api_key=self.settings.sarvam_api_key,
                model=self.settings.sarvam_tts_model,
                speaker=self.settings.sarvam_speaker,
                mode=self.settings.sarvam_tts_mode,
            )
        await self._send(self._ready_frame())
        if real_tts:
            self._prewarm_fillers()
        greeting_language = self.language if self.language != "auto" else "hi-IN"
        await self.turns.start_turn(
            "", greeting_language, canned=GREETING.get(greeting_language, GREETING["hi-IN"])
        )

    def _prewarm_fillers(self) -> None:
        """Synthesize both filler clips in the background so the first tool turn
        can play one within its budget. Only when start() built the real TTS stream."""
        if not self.settings.sarvam_api_key:
            return

        async def warm() -> None:
            for language in ("en-IN", "hi-IN"):
                try:
                    await fillers.get_filler(
                        api_key=self.settings.sarvam_api_key or "",
                        speaker=self.settings.sarvam_speaker,
                        model=self.settings.sarvam_tts_model,
                        language=language,
                    )
                except Exception:
                    logger.debug("filler prewarm failed for %s", language, exc_info=True)

        self._prewarm_task = asyncio.get_running_loop().create_task(warm())

    async def _open_stt(self) -> None:
        if self.settings.sarvam_api_key:
            try:
                self._stt_handle = await sarvam_stt.open_stt_socket(
                    api_key=self.settings.sarvam_api_key,
                    language=self.language,
                    model=self.settings.sarvam_stt_model,
                    on_event=self._on_stt_event,
                    on_failed=self._on_stt_failed,
                )
                self._stt_mode = "ws"
            except Exception:
                logger.exception("Failed to open Sarvam STT socket, degrading to typed mode")
                self._stt_mode = "rest"
        else:
            self._stt_mode = "rest"

    def _ready_frame(self) -> dict[str, Any]:
        return {
            "t": "ready",
            "sessionId": self.session_id,
            "sttMode": self._stt_mode,
            "ttsMode": self.tts.mode if self.tts is not None else "rest",
            "protocol": 2,
            "speaker": self.settings.sarvam_speaker,
        }

    # ------------------------------------------------------------ guarded send

    async def _send(self, frame: dict[str, Any]) -> None:
        """Send a frame; returns silently once the socket is closed or the
        session is disposed (no "send after close" log spam)."""
        if self.disposed or self._send_closed:
            return
        try:
            await self.send(frame)
        except (TypeError, ValueError):
            logger.exception("voice frame %s could not be serialised", frame.get("t"))
        except WebSocketDisconnect:
            self._send_closed = True
        except Exception:
            # Starlette raises RuntimeError once a close message has been sent;
            # other transports raise OSError-like errors. Either way the peer is gone.
            self._send_closed = True
            logger.debug("voice socket closed while sending %s", frame.get("t"), exc_info=True)

    # ------------------------------------------------------------------ STT

    async def _on_stt_event(self, event: dict[str, Any]) -> None:
        ev = sarvam_stt.parse_stt_event(event)
        if ev.kind == "vad_start":
            await self._send({"t": "vad", "state": "start"})
            self.turns.on_speech_start()
        elif ev.kind == "vad_end":
            await self._send({"t": "vad", "state": "end"})
        elif ev.kind == "partial":
            await self._send({"t": "partial", "text": ev.text})
            await self.turns.on_partial(ev.text)
        elif ev.kind == "final":
            language = choose_language(self.language, stt_language=ev.language, text=ev.text)
            self.turns.on_final(ev.text, language)
        elif ev.kind == "error" and ev.fatal:
            await self._degrade_stt(f"fatal STT error: {ev.message}")

    async def _on_stt_failed(self) -> None:
        await self._degrade_stt("STT reconnect attempts exhausted")

    async def _degrade_stt(self, reason: str) -> None:
        logger.warning("degrading STT to typed mode: %s", reason)
        self._stt_mode = "rest"
        await self._send(self._ready_frame())
        await self._send(
            {
                "t": "error",
                "message": "Voice recognition dropped. Please type your question.",
                "fatal": False,
                "code": "stt_degraded",
            }
        )

    async def handle_audio_chunk(self, b64_audio: str) -> None:
        if self._stt_mode == "ws" and self._stt_handle is not None:
            try:
                await self._stt_handle.send_audio(b64_audio)
            except Exception:
                if not self._stt_failed_once:
                    self._stt_failed_once = True
                    await self._degrade_stt("audio send failed")

    # ------------------------------------------------------- client frames (v2)

    async def handle_typed_text(self, text: str, client_turn_id: str | None = None) -> None:
        if not text.strip():
            return
        language = choose_language(self.language, text=text)
        await self.turns.start_turn(text.strip(), language, client_turn_id)

    async def handle_context(self, frame: dict[str, Any]) -> None:
        if "scope" in frame:
            self.scope = frame.get("scope") or None
        if "facilityId" in frame:
            fid = frame.get("facilityId")
            if not fid:
                self.last_facility = None
            else:
                try:
                    fac = self.district.repo.facility(fid)
                    self.last_facility = fac["name"]
                    self.last_district = fac.get("district_id") or self.last_district
                except Exception:
                    logger.debug("context frame named an unknown facility %r", fid)

    async def handle_ptt(self, state: str) -> None:
        if state == "down":
            await self.turns.cancel_current("ptt")
        elif state == "up" and self._stt_handle is not None:
            with contextlib.suppress(Exception):
                await self._stt_handle.flush()

    async def interrupt(self) -> None:
        await self.turns.interrupt()

    # ------------------------------------------------------------- v2 turn

    async def _on_turn_cancelled(self, turn: Turn, reason: str) -> None:
        """Called by the controller after a turn's task has been cancelled."""
        await self._send({"t": "interrupted", "turnId": turn.id})
        if self.tts is not None:
            with contextlib.suppress(Exception):
                await self.tts.cancel_turn()
        if turn.meta.get("user_logged") and not turn.completed:
            self.history.append({"role": "system", "content": INTERRUPTED_NOTE})

    async def _run_turn_v2(self, turn: Turn) -> None:
        run = _Run(turn=turn)
        try:
            if turn.canned is not None:
                await self._run_canned(run)
            else:
                await self._do_turn(run)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            code = self._classify(exc)
            if code == "internal":
                logger.exception("voice turn failed for session %s", self.session_id)
            else:
                logger.warning("voice turn failed (%s): %s", code, exc)
            await self._fail_turn(run, code)
        finally:
            # Release resources only; CancelledError keeps propagating.
            for task in (run.filler_task, run.tts_task):
                if task is not None and not task.done():
                    task.cancel()

    @staticmethod
    def _classify(exc: BaseException) -> str:
        if isinstance(exc, TimeoutError):
            return "llm_timeout"
        if isinstance(exc, sarvam_chat.SarvamHTTPError):
            return "llm_busy" if exc.status_code in RETRY_STATUSES else "llm_error"
        if isinstance(exc, ToolFailure):
            return "tool_error"
        return "internal"

    async def _run_canned(self, run: _Run) -> None:
        turn = run.turn
        self._start_tts(run)
        await self._speak_text(run, turn.canned or "")
        await self._finish_turn(run, log_history=False)

    async def _do_turn(self, run: _Run) -> None:
        turn = run.turn
        frame = {"t": "final", "text": turn.text, "turnId": turn.id, "language": turn.language}
        if turn.client_turn_id:
            frame["clientTurnId"] = turn.client_turn_id
        await self._send(frame)
        self.history.append({"role": "user", "content": turn.text})
        turn.meta["user_logged"] = True

        if not self.settings.sarvam_api_key:
            await self._send_error(turn, "no_key", fatal=True)
            return

        await self._send(
            {"t": "thinking", "turnId": turn.id, "stage": "planning", "label": "Thinking"}
        )
        self._start_tts(run)
        self._arm_filler(run)

        turn_msgs: list[dict[str, Any]] = []
        stream_planning = bool(self.settings.sarvam_stream_with_tools)
        content, calls = await self._call_llm(
            run, self._messages(turn_msgs), tool_choice="auto", stream=stream_planning
        )
        while calls and run.rounds < MAX_TOOL_ROUNDS:
            run.rounds += 1
            await self._run_tool_round(run, content, calls, turn_msgs)
            await self._send(
                {"t": "thinking", "turnId": turn.id, "stage": "answering", "label": "Putting the answer together"}
            )
            content, calls = await self._call_llm(
                run, self._messages(turn_msgs), tool_choice="none", stream=True
            )
        if not run.spoken:
            await self._speak_text(run, NO_DATA_LINE)
        await self._finish_turn(run, turn_msgs=turn_msgs)

    # ----------------------------------------------------------------- LLM

    def _messages(self, turn_msgs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """System prompt, a freshly built context note, the history window, then
        this turn's tool exchange."""
        return [self.history[0], self._context_message(), *self.history[1:], *turn_msgs]

    def _context_message(self) -> dict[str, Any]:
        scope_name = "all five districts"
        if self.scope:
            try:
                scope_name = self.district.repo.district(self.scope)["name"].removesuffix(" District")
            except Exception:
                scope_name = str(self.scope)
        now = self._sim_now()
        return {
            "role": "system",
            "content": (
                f"Context: scope is {scope_name}. "
                f"Last facility discussed: {self.last_facility or 'none'}. "
                f"Simulated time now: {now:%H:%M} IST, {now.day} {now:%B}."
            ),
        }

    def _sim_now(self) -> datetime:
        lg = self.logistics
        if lg is None:
            with contextlib.suppress(Exception):
                from app.api import deps

                lg = deps.get_logistics_service()
        if lg is not None:
            with contextlib.suppress(Exception):
                now = lg.now()
                return now.astimezone(IST) if now.tzinfo is not None else now
        return datetime.now(IST)

    async def _call_llm(
        self, run: _Run, messages: list[dict[str, Any]], *, tool_choice: str, stream: bool
    ) -> tuple[str, list[dict[str, Any]]]:
        """One planning or answer call with a timeout and at most one retry on
        429 or 503 (Retry-After at most 3 s, turn still current). 4xx validation
        errors are never retried."""
        for attempt in (0, 1):
            try:
                async with asyncio.timeout(LLM_TIMEOUT_S):
                    if stream:
                        return await self._stream_once(run, messages, tool_choice)
                    return await self._complete_once(run, messages)
            except sarvam_chat.SarvamHTTPError as exc:
                if attempt == 0 and self._retryable(exc) and self.turns.is_current(run.turn):
                    delay = DEFAULT_RETRY_DELAY_S if exc.retry_after is None else exc.retry_after
                    logger.info("retrying Sarvam chat after HTTP %s in %.1fs", exc.status_code, delay)
                    await self.sleep(delay)
                    if self.turns.is_current(run.turn):
                        continue
                raise
        raise RuntimeError("unreachable")  # pragma: no cover

    @staticmethod
    def _retryable(exc: sarvam_chat.SarvamHTTPError) -> bool:
        if exc.status_code not in RETRY_STATUSES:
            return False
        return exc.retry_after is None or exc.retry_after <= MAX_RETRY_AFTER_S

    async def _stream_once(
        self, run: _Run, messages: list[dict[str, Any]], tool_choice: str
    ) -> tuple[str, list[dict[str, Any]]]:
        acc = ToolCallAccumulator()
        seg = SentenceSegmenter()
        parts: list[str] = []
        async for delta in sarvam_chat.stream_chat(
            api_key=self.settings.sarvam_api_key or "",
            model=self.settings.sarvam_chat_model,
            messages=messages,
            tools=TOOL_SCHEMAS,
            tool_choice=tool_choice,
            max_tokens=320,
            temperature=0.3,
        ):
            if delta.tool_calls:
                acc.add(delta.tool_calls)
            if delta.content:
                if run.first_token_at is None:
                    run.first_token_at = self.clock()
                parts.append(delta.content)
                for sentence in seg.feed(delta.content):
                    await self._speak_sentence(run, sentence)
        calls = acc.result()
        rest = seg.flush()
        if rest and not calls:  # text left over before a tool call is a preamble: drop it
            await self._speak_sentence(run, rest)
        return "".join(parts), calls

    async def _complete_once(
        self, run: _Run, messages: list[dict[str, Any]]
    ) -> tuple[str, list[dict[str, Any]]]:
        result = await sarvam_chat.chat_completion(
            api_key=self.settings.sarvam_api_key or "",
            model=self.settings.sarvam_chat_model,
            messages=messages,
            tools=TOOL_SCHEMAS,
        )
        content = (result.content or "").strip()
        calls = list(result.tool_calls or [])
        if content and run.first_token_at is None:
            run.first_token_at = self.clock()
        if content and not calls:
            await self._speak_text(run, content)
        return content, calls

    # ---------------------------------------------------------------- tools

    def _exec_tool(self, name: str, args: dict[str, Any]) -> ToolResult:
        fn = self._tools.get(name)
        if fn is None:
            return ToolResult({"error": f"Unknown tool '{name}'"})
        try:
            return fn(**args)
        except TypeError as exc:
            return ToolResult({"error": f"Bad arguments for {name}: {exc}"})

    async def _run_tool_round(
        self,
        run: _Run,
        content: str,
        calls: list[dict[str, Any]],
        turn_msgs: list[dict[str, Any]],
    ) -> None:
        turn = run.turn
        parsed: list[tuple[str, str, dict[str, Any]]] = []
        for call in calls:
            fn = call.get("function") or {}
            name = str(fn.get("name") or "")
            raw = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw) if isinstance(raw, str) else raw
            except (ValueError, TypeError):
                args = {}
            if not isinstance(args, dict):
                args = {}
            parsed.append((call.get("id") or f"call_{uuid.uuid4().hex[:8]}", name, args))

        try:
            label = tool_label(parsed[0][1], parsed[0][2])
        except Exception:
            label = "Checking the data"
        await self._send({"t": "thinking", "turnId": turn.id, "stage": "tools", "label": label})

        turn_msgs.append(
            {
                "role": "assistant",
                "content": content or None,
                "tool_calls": [
                    {
                        "id": cid,
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(args)},
                    }
                    for cid, name, args in parsed
                ],
            }
        )
        results = await asyncio.gather(
            *(asyncio.to_thread(self._exec_tool, name, args) for _, name, args in parsed),
            return_exceptions=True,
        )
        # Local tool execution finishing does not mean an answer is imminent: the
        # follow-up chat call is a second network round trip and is often the
        # slower half (B8 probe measured it at 1.3 to 1.5 s). Leave the filler
        # timer running; _play_filler itself checks first_token_at/first_answer_audio_at
        # and _on_audio cancels it the moment real answer audio starts.

        failure: BaseException | None = None
        for (cid, name, args), res in zip(parsed, results, strict=True):
            if isinstance(res, BaseException):
                logger.warning("tool %s failed: %s", name, res)
                failure = failure or res
                llm: dict[str, Any] = {"error": f"{name} failed"}
                ok = False
            else:
                llm, ok = res.llm, "error" not in res.llm
                if ok:
                    self._note_tool_args(args)
                    if res.card:
                        run.cards.append(res.card)
            run.tools.append(name)
            await self._send(
                {"t": "tool", "turnId": turn.id, "name": name, "args": args, "label": tool_label_safe(name, args), "ok": ok}
            )
            turn_msgs.append(
                {"role": "tool", "tool_call_id": cid, "content": json.dumps(llm, default=str)}
            )
        if failure is not None:
            raise ToolFailure(str(failure)) from failure

    def _note_tool_args(self, args: dict[str, Any]) -> None:
        """Track the last district and facility from tool arguments that resolved."""
        repo = self.district.repo
        try:
            spoken_district = args.get("district")
            did = resolve_district(str(spoken_district), repo.districts) if spoken_district else None
            if did:
                self.last_district = did
            for key in ("facility", "query"):
                spoken = args.get(key)
                if not spoken:
                    continue
                res = resolve_facility(str(spoken), did, facilities=repo.facilities, districts=repo.districts)
                if res.best is not None and not res.ambiguous:
                    self.last_facility = res.best.name
                    self.last_district = res.best.district_id
        except Exception:
            logger.debug("could not track tool arguments %r", args, exc_info=True)

    # -------------------------------------------------------------- speaking

    def _start_tts(self, run: _Run) -> None:
        if self.tts is not None and self.speak:
            run.tts_task = asyncio.get_running_loop().create_task(self._tts_begin(run))

    async def _tts_begin(self, run: _Run) -> None:
        assert self.tts is not None

        async def on_audio(chunk: AudioChunk) -> None:
            await self._on_audio(run, chunk)

        try:
            await asyncio.wait_for(self.tts.begin_turn(run.turn.language, on_audio), TTS_TIMEOUT_S)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._tts_failed(run, exc)

    async def _tts_failed(self, run: _Run, exc: BaseException) -> None:
        run.tts_ok = False
        code = "tts_timeout" if isinstance(exc, TimeoutError) else "tts_error"
        logger.warning("TTS failed (%s): %s", code, exc)
        if self.tts is not None:
            with contextlib.suppress(Exception):
                await self.tts.cancel_turn()
        if not run.tts_error_sent:
            run.tts_error_sent = True
            await self._send_error(run.turn, code, fatal=False)

    async def _on_audio(self, run: _Run, chunk: AudioChunk) -> None:
        turn = run.turn
        if turn.cancelled or self.disposed:
            return
        now = self.clock()
        turn.note_audio(_audio_seconds(len(chunk.b64) * 3 // 4, chunk.sample_rate_hz, chunk.encoding), now)
        if run.first_audio_at is None:
            run.first_audio_at = now
        if run.first_answer_audio_at is None:
            run.first_answer_audio_at = now
            if run.filler_task is not None and not run.filler_task.done():
                run.filler_task.cancel()
        seq = run.audio_seq
        run.audio_seq += 1
        await self._send(
            {
                "t": "audio",
                "turnId": turn.id,
                "seq": seq,
                "b64": chunk.b64,
                "encoding": chunk.encoding,
                "sampleRateHz": chunk.sample_rate_hz,
                "filler": False,
            }
        )

    def _arm_filler(self, run: _Run) -> None:
        """Once per turn, armed when the turn starts: if no answer text or audio
        exists FILLER_DELAY_S after the end of speech (a tool call is being
        planned or a tool round is running), play the cached filler."""
        if run.filler_armed or self.tts is None or not self.speak or run.first_answer_audio_at:
            return
        run.filler_armed = True
        delay = max(0.0, FILLER_DELAY_S - (self.clock() - run.turn.received_at))
        run.filler_task = asyncio.get_running_loop().create_task(self._play_filler(run, delay))

    async def _play_filler(self, run: _Run, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            turn = run.turn
            if run.first_answer_audio_at is not None or run.first_token_at is not None or turn.cancelled:
                return
            run.filler_fired = True
            synth = await fillers.get_filler(
                api_key=self.settings.sarvam_api_key or "",
                speaker=self.settings.sarvam_speaker,
                model=self.settings.sarvam_tts_model,
                language=turn.language,
            )
            if run.first_answer_audio_at is not None or turn.cancelled:
                return
            now = self.clock()
            turn.note_audio(
                _audio_seconds(len(synth.wav_base64) * 3 // 4, synth.sample_rate_hz, "wav"), now
            )
            if run.first_audio_at is None:
                run.first_audio_at = now
            seq = run.audio_seq
            run.audio_seq += 1
            await self._send(
                {
                    "t": "audio",
                    "turnId": turn.id,
                    "seq": seq,
                    "b64": synth.wav_base64,
                    "encoding": "wav",
                    "sampleRateHz": synth.sample_rate_hz,
                    "filler": True,
                }
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("filler audio failed", exc_info=True)

    async def _speak_text(self, run: _Run, text: str) -> None:
        seg = SentenceSegmenter()
        for sentence in [*seg.feed(text), seg.flush()]:
            await self._speak_sentence(run, sentence)

    async def _speak_sentence(self, run: _Run, sentence: str) -> None:
        text = prepare_speech(sentence)
        if not text:
            return
        run.spoken.append(text)
        turn = run.turn
        await self._send({"t": "reply_delta", "turnId": turn.id, "text": text})
        if self.tts is None or not self.speak or not run.tts_ok:
            return
        try:
            if run.tts_task is not None:
                await run.tts_task
            if run.tts_ok:
                await self.tts.say(text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._tts_failed(run, exc)

    # ------------------------------------------------------------ completion

    async def _finish_turn(
        self, run: _Run, *, turn_msgs: list[dict[str, Any]] | None = None, log_history: bool = True
    ) -> None:
        turn = run.turn
        text = " ".join(run.spoken)
        await self._send(
            {
                "t": "reply",
                "turnId": turn.id,
                "text": text,
                "toolCalls": list(run.tools),
                "cards": list(run.cards),
                "language": turn.language,
            }
        )
        await self._tts_finish(run)
        if log_history:
            self.history.extend(_compact_tool_messages(turn_msgs or []))
            self.history.append({"role": "assistant", "content": text})
            self._trim_history()
        await self._send(
            {"t": "turn_end", "turnId": turn.id, "metrics": self._metrics(run)}
        )

    async def _tts_finish(self, run: _Run) -> None:
        if self.tts is None or not self.speak or not run.tts_ok:
            return
        try:
            if run.tts_task is not None:
                await run.tts_task
            if run.tts_ok:
                await asyncio.wait_for(self.tts.end_turn(), TTS_TIMEOUT_S)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._tts_failed(run, exc)

    def _metrics(self, run: _Run) -> dict[str, Any]:
        start = run.turn.received_at
        return {
            "finalToFirstTokenMs": _ms(start, run.first_token_at),
            "finalToFirstAudioMs": _ms(start, run.first_audio_at),
            "finalToFirstAnswerAudioMs": _ms(start, run.first_answer_audio_at),
            "totalMs": _ms(start, self.clock()),
            "tools": list(run.tools),
        }

    async def _send_error(self, turn: Turn, code: str, *, fatal: bool = False) -> None:
        await self._send(
            {"t": "error", "message": ERROR_MESSAGES.get(code, ERROR_MESSAGES["internal"]), "fatal": fatal, "code": code}
        )

    async def _fail_turn(self, run: _Run, code: str) -> None:
        """Error frame, a spoken fallback in the turn's language, then close the
        turn so the UI returns to idle."""
        turn = run.turn
        await self._send_error(turn, code)
        fallback = fallback_text(turn.language)
        await self._speak_sentence(run, fallback)
        await self._finish_turn(run, log_history=False)
        self.history.append({"role": "assistant", "content": fallback})
        self._trim_history()

    # --------------------------------------------------------------- history

    def _trim_history(self) -> None:
        """Keep the system prompt and the last 8 exchanges, cutting only at a
        user message so a tool message is never left without its tool call."""
        user_idx = [i for i, m in enumerate(self.history) if i > 0 and m.get("role") == "user"]
        if len(user_idx) > HISTORY_EXCHANGES:
            cut = user_idx[-HISTORY_EXCHANGES]
            self.history = [self.history[0], *self.history[cut:]]

    # --------------------------------------------------------------- dispose

    async def dispose(self) -> None:
        """Cancel the current turn, close TTS and STT, clear timers. Exactly once."""
        if self.disposed:
            return
        self.disposed = True
        with contextlib.suppress(Exception):
            await self.turns.close()
        if self.tts is not None:
            with contextlib.suppress(Exception):
                await self.tts.close()
        if self._stt_handle is not None:
            try:
                await self._stt_handle.end()
            except Exception:
                logger.debug("STT handle already closed during session %s dispose", self.session_id)


def tool_label_safe(name: str, args: dict[str, Any]) -> str:
    try:
        return tool_label(name, args)
    except Exception:
        return "Checking the data"


def _compact_tool_messages(msgs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Copy a turn's tool exchange for the history, truncating tool payloads."""
    out = []
    for m in msgs:
        if m.get("role") == "tool":
            content = str(m.get("content", ""))
            if len(content) > TOOL_COMPACT_CHARS:
                m = {**m, "content": content[:TOOL_COMPACT_CHARS] + "...truncated"}
        out.append(m)
    return out

