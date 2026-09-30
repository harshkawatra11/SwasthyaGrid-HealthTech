"use client";

import { useEffect } from "react";
import { useVoice } from "@/lib/voice/VoiceSessionProvider";

function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/** Esc interrupts, M toggles mute, Space is push to talk (ptt mode). Never while typing. */
export function useVoiceHotkeys(): void {
  const voice = useVoice();
  const { mode, muted, status } = voice.state;
  const { interrupt, setMuted, pttDown, pttUp } = voice;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        interrupt();
        return;
      }
      if (inEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === "m" || e.key === "M") && !e.repeat) {
        if (status === "connected") setMuted(!muted);
      } else if (e.code === "Space" && mode === "ptt" && status === "connected") {
        e.preventDefault();
        if (!e.repeat) pttDown();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && mode === "ptt" && !inEditable(e.target)) pttUp();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mode, muted, status, interrupt, setMuted, pttDown, pttUp]);
}
