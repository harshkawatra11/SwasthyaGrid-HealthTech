"""Text-only accuracy eval for the voice agent (plan 7.9/7.10, B9).

Drives a real `VoiceSession` directly in process: no server, no websocket, a
fake frame sender in place of the transport. Sarvam chat is real (the .env
key). The district, forecast, recommendation, logistics and insights services
are the real ones from `app.api.deps`, so ground truth is live data, not a
fixture.

Every case in `voice_cases.yaml` is one typed turn. The runner never hard
codes an expected answer: for the "grounded" check it re-calls the same tool
function with the arguments the model actually chose, and only then checks
the reply shares real content with that live result.

Budget: at most 2 full runs (about 240 Sarvam chat calls total across this
and the B8 latency probe). Run from backend/ so `.env` is found:

    python -m evals.voice_eval
    python -m evals.voice_eval --only district_01 facility_02
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path
from typing import Any

import yaml

from app.api import deps
from app.core.config import get_settings
from app.prompts.voice_prompt import voice_system_prompt
from app.tools.resolve import resolve_district, resolve_facility
from app.tools.v2 import build_tool_functions
from app.voice.session import VoiceSession

CASES_PATH = Path(__file__).parent / "voice_cases.yaml"
TURN_TIMEOUT_S = 40.0

HARD_ERROR_CODES = {"llm_error", "tool_error", "internal", "llm_timeout", "llm_busy", "no_key"}


class Frames:
    """Stands in for the websocket: collects every frame the session sends."""

    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []

    async def __call__(self, frame: dict[str, Any]) -> None:
        self.items.append(frame)

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [f for f in self.items if f.get("t") == kind]


def make_session() -> tuple[VoiceSession, Frames]:
    settings = get_settings()
    frames = Frames()
    session = VoiceSession(
        settings=settings,
        district=deps.get_district_service(),
        forecast=deps.get_forecast_service(),
        recommendation=deps.get_recommendation_service(),
        send=frames,
        protocol=2,
        tools=None,  # real tools; resolves the real logistics/insights services lazily
        tts=None,
        speak=False,  # text-only: no TTS, no filler, no audio frames
    )
    session.history = [{"role": "system", "content": voice_system_prompt()}]
    return session, frames


def reset_session(session: VoiceSession) -> None:
    """Independent cases: fresh history and no leftover scope/last-facility context."""
    session.history = [{"role": "system", "content": voice_system_prompt()}]
    session.scope = None
    session.last_district = None
    session.last_facility = None


async def _await_or_timeout(task: asyncio.Task[Any]) -> None:
    try:
        await task
    except asyncio.CancelledError:
        pass


async def run_turn(session: VoiceSession, frames: Frames, text: str, turn_id: str) -> None:
    frames.items.clear()
    await session.handle_typed_text(text, turn_id)
    turn = session.turns.current
    assert turn is not None and turn.task is not None
    await asyncio.wait_for(asyncio.shield(_await_or_timeout(turn.task)), TURN_TIMEOUT_S)


# --------------------------------------------------------------------------- checks


def _flatten(value: Any, out: set[str]) -> None:
    if isinstance(value, dict):
        for v in value.values():
            _flatten(v, out)
    elif isinstance(value, (list, tuple)):
        for v in value:
            _flatten(v, out)
    elif isinstance(value, bool):
        return
    elif isinstance(value, (int, float)):
        out.add(str(value))
    elif isinstance(value, str) and value:
        out.add(value)


def grounded_tokens(llm: dict[str, Any]) -> set[str]:
    """Informative strings and multi-digit numbers pulled out of a tool result,
    used as a live, uncached signal that a reply actually reflects it."""
    raw: set[str] = set()
    _flatten(llm, raw)
    keep: set[str] = set()
    for t in raw:
        if re.fullmatch(r"-?\d+(\.\d+)?", t):
            if len(t.replace("-", "").replace(".", "")) >= 2:
                keep.add(t)
        elif len(t) >= 4:
            keep.add(t.lower())
    return keep


def reply_has_grounding(reply: str, ground_llm: dict[str, Any] | None) -> tuple[bool, str]:
    if not isinstance(ground_llm, dict):
        return True, "no ground truth to check (tool was not called)"
    if "error" in ground_llm:
        return True, f"ground truth call itself returned an error, skipping: {ground_llm['error']!r}"
    tokens = grounded_tokens(ground_llm)
    if not tokens:
        return True, "ground truth had no checkable tokens"
    reply_l = reply.lower()
    hits = [t for t in tokens if t in reply_l]
    if hits:
        return True, f"grounded, matched {hits[:3]}"
    sample = list(tokens)[:6]
    return False, f"reply shares no token with live ground truth (sample: {sample})"


def entity_ok(entity: dict[str, str], args: dict[str, Any]) -> tuple[bool, str]:
    kind, expected = entity["kind"], entity["id"]
    if kind == "district":
        text = args.get("district")
        got = resolve_district(str(text or ""))
    else:
        text = args.get("facility") or args.get("shipment") or args.get("query")
        res = resolve_facility(str(text or ""))
        got = res.best.id if res.best else None
    if got == expected:
        return True, f"resolved {text!r} -> {got}"
    return False, f"resolved {text!r} -> {got}, expected {expected}"


def soft_entity_ok(
    entity: dict[str, str], args: dict[str, Any], ground_llm: dict[str, Any] | None
) -> tuple[bool, str]:
    """Like entity_ok, but a live-state miss (no active shipment right now) is
    not this lane's bug: only the resolver has to be right."""
    ok, reason = entity_ok(entity, args)
    if ok:
        return True, reason
    # The resolver may still be wrong even when there is a live error; only
    # forgive it when the error is itself about there being no shipment.
    if isinstance(ground_llm, dict) and "shipment" in str(ground_llm.get("error", "")).lower():
        return True, f"{reason} (forgiven: {ground_llm['error']!r})"
    return False, reason


def args_ok(expected: dict[str, list[str]], args: dict[str, Any]) -> tuple[bool, str]:
    problems = []
    for key, accepted in expected.items():
        val = args.get(key)
        val_str = val if isinstance(val, str) else json.dumps(val, default=str)
        val_str = val_str.lower()
        if not any(a.lower() in val_str for a in accepted):
            problems.append(f"arg {key}={val!r} matched none of {accepted}")
    if problems:
        return False, "; ".join(problems)
    return True, "args matched"


def ambiguous_ok(ground_llm: dict[str, Any] | None) -> tuple[bool, str]:
    if not isinstance(ground_llm, dict):
        return False, "no ground truth (tool not called)"
    matches = ground_llm.get("matches") or []
    if ground_llm.get("ambiguous") or len(matches) > 1:
        return True, f"ambiguous={ground_llm.get('ambiguous')}, {len(matches)} matches"
    return False, f"expected more than one match, got {len(matches)}"


# --------------------------------------------------------------------------- runner


async def run_case(
    session: VoiceSession, frames: Frames, case: dict[str, Any], tools_gt: dict[str, Any]
) -> dict[str, Any]:
    reset_session(session)
    text = case["text"]
    checks = case.get("checks", [])
    reasons: list[str] = []
    passed = True

    try:
        await run_turn(session, frames, text, case["id"])
    except TimeoutError:
        return {
            "id": case["id"], "text": text, "tool_expected": case.get("tool"),
            "tools_called": [], "reply": "", "passed": False,
            "reasons": [f"turn timed out after {TURN_TIMEOUT_S}s"],
        }

    tool_frames = frames.of("tool")
    called = [(f["name"], f["args"]) for f in tool_frames]
    reply_frames = frames.of("reply")
    reply_text = reply_frames[-1]["text"] if reply_frames else ""
    error_frames = frames.of("error")

    match: tuple[str, dict[str, Any]] | None = None
    expected = case.get("tool")
    # A case may name several acceptable tools (for example find_facility or
    # get_facility_status, both of which resolve a spoken name).
    expected_names = expected if isinstance(expected, list) else ([expected] if expected else [])
    if expected_names:
        for name, args in called:
            if name in expected_names:
                match = (name, args)
                break

    if "tool" in checks:
        ok = match is not None
        if not ok:
            passed = False
        reasons.append(
            f"tool ok ({match[0]})" if ok else f"expected tool {case['tool']!r}, got {[n for n, _ in called]}"
        )

    if "no_tool" in checks:
        ok = not called
        if not ok:
            passed = False
            reasons.append(f"expected no tool call, got {[n for n, _ in called]}")
        elif not reply_text.strip():
            passed = False
            reasons.append("expected no tool call and got none, but the reply was empty")
        else:
            reasons.append("no tool called, as expected")

    ground_llm: dict[str, Any] | None = None
    if match is not None:
        name, args = match
        try:
            ground_llm = tools_gt[name](**args).llm
        except Exception as exc:  # the eval must never crash on a bad live call
            ground_llm = {"error": f"ground truth call raised {exc!r}"}

    if "entity" in checks:
        if match is None:
            passed = False
            reasons.append("entity check skipped: no matching tool call")
        else:
            ok, reason = entity_ok(case["entity"], match[1])
            if not ok:
                passed = False
            reasons.append(reason)

    if "soft_entity" in checks:
        if match is None:
            passed = False
            reasons.append("soft_entity check skipped: no matching tool call")
        else:
            ok, reason = soft_entity_ok(case["entity"], match[1], ground_llm)
            if not ok:
                passed = False
            reasons.append(reason)

    if "args" in checks:
        if match is None:
            passed = False
            reasons.append("args check skipped: no matching tool call")
        else:
            ok, reason = args_ok(case["args"], match[1])
            if not ok:
                passed = False
            reasons.append(reason)

    if "grounded" in checks:
        ok, reason = reply_has_grounding(reply_text, ground_llm)
        if not ok:
            passed = False
        reasons.append(reason)

    if "ambiguous" in checks:
        ok, reason = ambiguous_ok(ground_llm)
        if not ok:
            passed = False
        reasons.append(reason)

    hard_codes = [e.get("code") for e in error_frames if e.get("code") in HARD_ERROR_CODES]
    if hard_codes:
        passed = False
        reasons.append(f"error frame(s): {hard_codes}")

    return {
        "id": case["id"],
        "text": text,
        "tool_expected": case.get("tool"),
        "tools_called": [n for n, _ in called],
        "reply": reply_text,
        "passed": passed,
        "reasons": reasons,
    }


def load_cases(only: list[str] | None) -> list[dict[str, Any]]:
    cases = yaml.safe_load(CASES_PATH.read_text(encoding="utf-8"))
    if only:
        wanted = set(only)
        cases = [c for c in cases if c["id"] in wanted]
    return cases


async def main_async(only: list[str] | None) -> int:
    settings = get_settings()
    if not settings.sarvam_api_key:
        print("SARVAM_API_KEY is not set (backend/.env); aborting.")
        return 2

    cases = load_cases(only)
    session, frames = make_session()
    tools_gt = build_tool_functions(
        deps.get_district_service(), deps.get_forecast_service(), deps.get_recommendation_service()
    )

    results = []
    for case in cases:
        try:
            r = await run_case(session, frames, case, tools_gt)
        except Exception as exc:
            r = {
                "id": case["id"], "text": case["text"], "tool_expected": case.get("tool"),
                "tools_called": [], "reply": "", "passed": False,
                "reasons": [f"runner exception: {exc!r}"],
            }
        results.append(r)
        status = "PASS" if r["passed"] else "FAIL"
        print(f"[{status}] {case['id']}")
        for reason in r["reasons"]:
            print(f"    {reason}")

    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    by_tool: dict[str, list[bool]] = {}
    for r, c in zip(results, cases, strict=True):
        key = c.get("tool") or "no_tool"
        if isinstance(key, list):
            key = "|".join(key)
        by_tool.setdefault(key, []).append(r["passed"])

    print(f"\n{passed}/{total} passed ({round(100 * passed / total, 1) if total else 0}%)")
    print("\nBy tool:")
    for key, oks in sorted(by_tool.items()):
        print(f"  {key:<24} {sum(oks)}/{len(oks)}")

    failures = [r for r in results if not r["passed"]]
    if failures:
        print(f"\n{len(failures)} failing cases:")
        for r in failures:
            print(f"- {r['id']}: {r['text']!r}")
            print(f"    tools called: {r['tools_called']}")
            print(f"    reply: {r['reply'][:160]!r}")
            for reason in r["reasons"]:
                print(f"    reason: {reason}")
    return 0 if not failures else 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", default=None, help="run only these case ids")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main_async(args.only)))


if __name__ == "__main__":
    main()
