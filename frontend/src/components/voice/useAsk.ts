"use client";

import { useCallback, useEffect, useRef } from "react";
import { useVoice } from "@/lib/voice/VoiceSessionProvider";

/** Sends a typed question. When no session is live it starts one first (inside the
 *  caller's click, so the AudioContext is allowed) and sends once connected. */
export function useAsk(): (text: string) => void {
  const voice = useVoice();
  const pending = useRef<string[]>([]);
  const { status } = voice.state;

  useEffect(() => {
    if (status !== "connected" || pending.current.length === 0) return;
    const queued = pending.current.splice(0);
    for (const q of queued) voice.sendTyped(q);
  }, [status, voice]);

  return useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body) return;
      if (status === "connected") {
        voice.sendTyped(body);
        return;
      }
      pending.current.push(body);
      if (status === "idle" || status === "failed") void voice.start();
    },
    [status, voice],
  );
}
