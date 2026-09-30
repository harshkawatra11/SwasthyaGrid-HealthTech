"""Incremental sentence segmentation for streamed model output.

Text arrives in small deltas; each complete sentence is handed to the TTS
stream as soon as it is known. Rules (plan 7.5):

- A terminator `. ! ? ।` ends a sentence only when followed by whitespace (or
  the stream ends), so "2.5" stays whole.
- A period after `Dr. Mr. Mrs. Ms. No. vs. e.g. i.e.` does not end a sentence.
- A buffer over 180 characters without a terminator is cut at the last comma
  or space before the limit.
"""

import re

TERMINATORS = ".!?।"
MAX_UNBROKEN = 180
_ABBREVIATION_RE = re.compile(r"(?:^|\s)(?:dr|mr|mrs|ms|no|vs|e\.g|i\.e)$", re.IGNORECASE)


class SentenceSegmenter:
    def __init__(self) -> None:
        self._buf = ""

    def feed(self, text: str) -> list[str]:
        """Add text; return the sentences that are now complete."""
        self._buf += text
        out: list[str] = []
        while True:
            end = self._next_boundary()
            if end is None:
                break
            sentence = self._buf[: end + 1].strip()
            self._buf = self._buf[end + 1 :].lstrip()
            if sentence:
                out.append(sentence)
        while len(self._buf) > MAX_UNBROKEN:
            window = self._buf[:MAX_UNBROKEN]
            comma = window.rfind(",")
            space = window.rfind(" ")
            if comma >= space and comma > 0:
                cut, rest = comma + 1, comma + 1
            elif space > 0:
                cut, rest = space, space + 1
            else:
                cut, rest = MAX_UNBROKEN, MAX_UNBROKEN
            piece = self._buf[:cut].strip()
            self._buf = self._buf[rest:].lstrip()
            if piece:
                out.append(piece)
        return out

    def flush(self) -> str:
        """Return whatever is left (possibly empty) and reset."""
        rest = self._buf.strip()
        self._buf = ""
        return rest

    def _next_boundary(self) -> int | None:
        buf = self._buf
        for i, ch in enumerate(buf[:-1]):
            if ch not in TERMINATORS or not buf[i + 1].isspace():
                continue
            if ch == "." and _ABBREVIATION_RE.search(buf[:i]):
                continue
            return i
        return None
