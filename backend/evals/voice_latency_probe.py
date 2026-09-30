"""Latency probe for the voice agent (plan 7.10, B8).

Opens the real `/ws/voice` protocol 2 socket, sends typed questions with TTS on
and reports the server side `turn_end.metrics` (final to first audio of any
kind, final to first answer audio) plus a client side send-to-first-audio-frame
check. Turns are grouped by whether the model called a tool.

Live Sarvam calls: 2 per tool turn, 1 per no-tool turn, plus TTS. Budget is 2
probes per plan. Usage:

    python -m evals.voice_latency_probe --url ws://127.0.0.1:8094/ws/voice
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from typing import Any

import websockets

QUESTIONS: list[tuple[str, str]] = [
    ("no_tool", "What is ORS used for?"),
    ("tools", "How many critical facilities are there in Kota district?"),
    ("no_tool", "What does a district drug warehouse do?"),
    ("tools", "Which district has the most stock-outs?"),
    ("tools", "Which shipments are delayed right now?"),
]

TURN_TIMEOUT_S = 40.0


def median(values: list[float]) -> float | None:
    return round(statistics.median(values), 1) if values else None


async def _until(ws: Any, kinds: set[str], timeout: float) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    async with asyncio.timeout(timeout):
        while True:
            frame = json.loads(await ws.recv())
            frames.append(frame)
            if frame.get("t") in kinds:
                return frames


async def run_probe(url: str, language: str = "en-IN") -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"t": "hello", "language": language, "scope": None, "mode": "ptt", "protocol": 2}))
        head = await _until(ws, {"ready"}, 15)
        ready = head[-1]
        # The opening greeting is a canned turn; let it finish before measuring.
        await _until(ws, {"turn_end"}, TURN_TIMEOUT_S)
        for idx, (kind, question) in enumerate(QUESTIONS):
            sent = time.monotonic()
            await ws.send(json.dumps({"t": "text", "body": question, "clientTurnId": f"probe-{idx}"}))
            frames = await _until(ws, {"turn_end"}, TURN_TIMEOUT_S)
            reply = ""
            for f in frames:
                if f.get("t") == "reply":
                    reply = f.get("text", "")
                if f.get("t") == "error":
                    errors.append(f"turn {idx}: {f.get('code')} {f.get('message')}")
            metrics = frames[-1]["metrics"]
            rows.append(
                {
                    "kind": kind,
                    "question": question,
                    "tools": metrics.get("tools", []),
                    "firstTokenMs": metrics.get("finalToFirstTokenMs"),
                    "firstAudioMs": metrics.get("finalToFirstAudioMs"),
                    "firstAnswerAudioMs": metrics.get("finalToFirstAnswerAudioMs"),
                    "totalMs": metrics.get("totalMs"),
                    "clientWallMs": round((time.monotonic() - sent) * 1000),
                    "fillerPlayed": any(f.get("t") == "audio" and f.get("filler") for f in frames),
                    "audioFrames": sum(1 for f in frames if f.get("t") == "audio"),
                    "reply": reply,
                }
            )
        await ws.send(json.dumps({"t": "bye"}))
    return {"ready": {k: ready.get(k) for k in ("sttMode", "ttsMode", "protocol", "speaker")}, "rows": rows, "errors": errors}


def summarise(result: dict[str, Any]) -> dict[str, Any]:
    rows = result["rows"]

    def col(sel: str, key: str) -> list[float]:
        return [r[key] for r in rows if (sel == "all" or (sel == "tools") == bool(r["tools"])) and r[key] is not None]

    return {
        "all": {"firstAudioMs": median(col("all", "firstAudioMs")), "firstAnswerAudioMs": median(col("all", "firstAnswerAudioMs"))},
        "no_tools": {"firstAudioMs": median(col("no_tools", "firstAudioMs")), "firstAnswerAudioMs": median(col("no_tools", "firstAnswerAudioMs"))},
        "with_tools": {"firstAudioMs": median(col("tools", "firstAudioMs")), "firstAnswerAudioMs": median(col("tools", "firstAnswerAudioMs"))},
    }


def print_report(result: dict[str, Any]) -> None:
    print("ready:", result["ready"])
    print(f"{'#':<2} {'tools':<28} {'1st token':>9} {'1st audio':>9} {'1st ans':>8} {'total':>7} {'filler':>6}  question")
    for i, r in enumerate(result["rows"]):
        print(
            f"{i:<2} {','.join(r['tools']) or '-':<28} {r['firstTokenMs']!s:>9} {r['firstAudioMs']!s:>9} "
            f"{r['firstAnswerAudioMs']!s:>8} {r['totalMs']!s:>7} {r['fillerPlayed']!s:>6}  {r['question']}"
        )
    s = summarise(result)
    print("median final-to-first-audio (any):      all", s["all"]["firstAudioMs"], "| no tools", s["no_tools"]["firstAudioMs"], "| tools", s["with_tools"]["firstAudioMs"])
    print("median final-to-first-answer-audio:     all", s["all"]["firstAnswerAudioMs"], "| no tools", s["no_tools"]["firstAnswerAudioMs"], "| tools", s["with_tools"]["firstAnswerAudioMs"])
    print("targets (7.1): no tools answer audio <= 1800, tools any audio <= 1200, one tool round answer audio <= 3200")
    print("errors:", result["errors"] or "none")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://127.0.0.1:8080/ws/voice")
    parser.add_argument("--language", default="en-IN")
    args = parser.parse_args()
    result = asyncio.run(run_probe(args.url, args.language))
    print_report(result)


if __name__ == "__main__":
    main()
