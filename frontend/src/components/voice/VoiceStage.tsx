"use client";

import { Loader2, Mic, MicOff, Power, Square } from "lucide-react";
import { OrbStage } from "@/components/orb/OrbStage";
import { cn } from "@/lib/cn";
import { useVoice } from "@/lib/voice/VoiceSessionProvider";
import { micLabel, statusLine, SUGGESTED_PROMPTS } from "./voice-copy";

const roundBtn =
  "inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-[12px] font-medium text-white/85 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

/** The dark stage: orb, status line, live caption, controls and suggested prompts. */
export function VoiceStage({ onAsk }: { onAsk: (text: string) => void }) {
  const voice = useVoice();
  const { state } = voice;
  const connected = state.status === "connected";
  const connecting = state.status === "connecting";
  const ptt = state.mode === "ptt";
  const busy = state.phase === "speaking" || state.phase === "thinking";

  function onMicClick() {
    if (state.status === "idle" || state.status === "failed") void voice.start();
    else if (connected && !ptt) voice.setMuted(!state.muted);
  }

  const micPressed = connected && (ptt ? state.phase === "listening" : !state.muted);

  return (
    <section
      aria-label="Voice stage"
      className="flex h-full min-h-0 flex-col items-center justify-between gap-2 overflow-hidden rounded-md border border-border bg-[var(--stage-bg)] px-4 py-3"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <OrbStage phase={state.phase} size={260} />
      </div>

      <div className="flex w-full max-w-xl flex-col items-center gap-1 text-center">
        <p aria-live="polite" className="text-[13px] text-white/60">
          {statusLine(state)}
        </p>
        <p
          data-testid="live-caption"
          className={cn("min-h-[2lh] text-[16px] leading-snug text-white", state.phase === "listening" && "italic text-white/80")}
        >
          {state.caption}
        </p>
        {state.status === "failed" && state.errorMessage && (
          <p role="alert" className="text-[12px] text-[var(--risk-critical)]">
            {state.errorMessage}
          </p>
        )}
        {connected && state.errorMessage && <p className="text-[12px] text-white/50">{state.errorMessage}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          aria-label={micLabel(state)}
          aria-pressed={micPressed}
          disabled={connecting}
          onClick={ptt && connected ? undefined : onMicClick}
          onPointerDown={ptt && connected ? () => voice.pttDown() : undefined}
          onPointerUp={ptt && connected ? () => voice.pttUp() : undefined}
          onPointerLeave={ptt && connected ? () => voice.pttUp() : undefined}
          className={cn(
            "relative inline-flex h-12 w-12 items-center justify-center rounded-full border transition-colors",
            micPressed ? "border-brand bg-brand text-bg" : "border-white/20 bg-white/10 text-white hover:bg-white/15",
            "disabled:cursor-wait",
          )}
        >
          {connecting ? (
            <Loader2 size={20} className="animate-spin" aria-hidden />
          ) : connected && state.muted && !ptt ? (
            <MicOff size={20} aria-hidden />
          ) : (
            <Mic size={20} aria-hidden />
          )}
        </button>
        <button type="button" className={roundBtn} disabled={!busy} onClick={() => voice.interrupt()} aria-label="Stop answer">
          <Square size={13} aria-hidden />
          Stop answer
        </button>
        <button
          type="button"
          className={roundBtn}
          disabled={!connected}
          aria-pressed={state.muted}
          onClick={() => voice.setMuted(!state.muted)}
          aria-label={state.muted ? "Unmute microphone" : "Mute microphone"}
        >
          {state.muted ? <MicOff size={13} aria-hidden /> : <Mic size={13} aria-hidden />}
          {state.muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" className={roundBtn} disabled={state.status === "idle"} onClick={() => voice.stop()} aria-label="End session">
          <Power size={13} aria-hidden />
          End session
        </button>
      </div>

      <div className="flex max-w-2xl flex-wrap justify-center gap-1.5" role="group" aria-label="Suggested prompts">
        {SUGGESTED_PROMPTS.map((p) => (
          <button
            key={p.text}
            type="button"
            lang={p.lang === "hi" ? "hi" : "en"}
            onClick={() => onAsk(p.text)}
            className="rounded-full border border-white/12 px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/8 hover:text-white"
          >
            {p.text}
          </button>
        ))}
      </div>
    </section>
  );
}
