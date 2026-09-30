"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic } from "lucide-react";
import { OrbFallback } from "@/components/orb/OrbFallback";
import { useScope, withScope } from "@/lib/scope";
import { useVoice } from "@/lib/voice/VoiceSessionProvider";
import type { OrbPhase } from "@/lib/audio/levels";

const PHASE_LABEL: Record<OrbPhase, string> = {
  idle: "Voice",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

/** Topbar entry to the Voice page. A mic icon when no call is live; while a
 *  call is live, the 28 px CSS orb (never a second WebGL canvas) and the phase. */
export function VoiceButton() {
  const pathname = usePathname();
  const { state } = useVoice();
  const { scope } = useScope();
  if (pathname === "/voice") return null;

  const live = state.status === "connected" || state.status === "connecting";
  const phase: OrbPhase = state.status === "connected" ? state.phase : "idle";
  const label = state.status === "connecting" ? "Connecting" : PHASE_LABEL[phase];

  return (
    <Link
      href={withScope("/voice", scope)}
      data-testid="voice-button"
      aria-label={live ? `Voice call, ${label}. Open Voice Control Room` : "Open Voice Control Room"}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 text-[12px] text-muted hover:bg-surface-3 hover:text-text"
    >
      {live ? (
        <>
          <OrbFallback phase={phase} size={28} />
          <span className="hidden text-text sm:inline">{label}</span>
        </>
      ) : (
        <>
          <Mic size={14} aria-hidden />
          <span className="hidden lg:inline">Voice</span>
        </>
      )}
    </Link>
  );
}
