"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Power, Square } from "lucide-react";
import { OrbFallback } from "@/components/orb/OrbFallback";
import { useScope, withScope } from "@/lib/scope";
import { useVoice } from "@/lib/voice/VoiceSessionProvider";
import { statusLine } from "./voice-copy";

/** Bottom-right dock on every page except /voice, shown only while a call is live. */
export function VoiceDock() {
  const pathname = usePathname();
  const voice = useVoice();
  const { scope } = useScope();
  const { state } = voice;
  if (pathname === "/voice" || state.status !== "connected") return null;
  const busy = state.phase === "speaking" || state.phase === "thinking";

  return (
    <aside
      data-testid="voice-dock"
      aria-label="Voice call"
      className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border-strong bg-surface-2 p-3 shadow-[var(--shadow-overlay)]"
    >
      <div className="flex items-start gap-3">
        <OrbFallback phase={state.phase} size={36} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <Link href={withScope("/voice", scope)} className="text-[12px] font-semibold text-text hover:text-brand">
            Voice Control Room
          </Link>
          <p aria-live="polite" className="text-[11px] text-muted">
            {statusLine(state)}
          </p>
          {state.caption && (
            <p data-testid="dock-caption" className="mt-1 line-clamp-3 text-[12px] text-text">
              {state.caption}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!busy}
          onClick={() => voice.interrupt()}
          aria-label="Stop answer"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2 text-[11px] text-text hover:bg-surface-3 disabled:opacity-40"
        >
          <Square size={11} aria-hidden />
          Stop answer
        </button>
        <button
          type="button"
          onClick={() => voice.stop()}
          aria-label="End session"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2 text-[11px] text-text hover:bg-surface-3"
        >
          <Power size={11} aria-hidden />
          End session
        </button>
      </div>
    </aside>
  );
}
