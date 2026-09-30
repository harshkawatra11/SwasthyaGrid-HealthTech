"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LiveDot } from "@/components/ds/LiveDot";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { ScopeSwitcher } from "@/components/shell/ScopeSwitcher";
import { fmtInt } from "@/lib/format";
import { useScope, withScope } from "@/lib/scope";
import { useVoice } from "@/lib/voice/VoiceSessionProvider";
import type { VoiceLanguage, VoiceMode } from "@/lib/voice/protocol";
import { ConversationPanel } from "./ConversationPanel";
import { VoiceStage } from "./VoiceStage";
import { connectionLabel, FOOTER_NOTE } from "./voice-copy";
import { useAsk } from "./useAsk";
import { useVoiceHotkeys } from "./useVoiceHotkeys";

const LANGUAGES = [
  { value: "auto", label: "Auto" },
  { value: "en-IN", label: "English" },
  { value: "hi-IN", label: "हिंदी" },
] as const;

const MODES = [
  { value: "handsfree", label: "Hands-free" },
  { value: "ptt", label: "Hold to talk" },
] as const;

function ms(v: number | null): string {
  return v === null ? "-" : `${fmtInt(Math.round(v))} ms`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[90px]">
      <p className="eyebrow">{label}</p>
      <p className="num text-[12px] text-text">{value}</p>
    </div>
  );
}

export function VoicePage() {
  const voice = useVoice();
  const { state } = voice;
  const ask = useAsk();
  const router = useRouter();
  const params = useSearchParams();
  const { scope } = useScope();
  const asked = useRef(false);
  useVoiceHotkeys();

  // /voice?ask=... (from the command palette): send once, then drop the parameter.
  const askParam = params.get("ask");
  useEffect(() => {
    if (!askParam || asked.current) return;
    asked.current = true;
    ask(askParam);
    router.replace(withScope("/voice", scope));
  }, [askParam, ask, router, scope]);

  const live = state.status === "connected" ? "live" : state.status === "connecting" ? "stale" : "offline";

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-136px)] lg:overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <p className="eyebrow">Command</p>
          <h1 className="text-[18px] font-semibold leading-tight text-text">Voice Control Room</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScopeSwitcher />
          <SegmentedControl<VoiceLanguage>
            ariaLabel="Language"
            value={state.language}
            onChange={(l) => voice.setLanguage(l)}
            options={LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
          />
          <SegmentedControl<VoiceMode>
            ariaLabel="Mode"
            value={state.mode}
            onChange={(m) => voice.setMode(m)}
            options={MODES.map((m) => ({ value: m.value, label: m.label }))}
          />
          <span
            data-testid="connection-chip"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 text-[12px] text-text"
          >
            <LiveDot state={live} />
            {connectionLabel(state.status)}
          </span>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-3 lg:flex-1 lg:grid-cols-12">
        <div className="min-h-[520px] lg:col-span-8 lg:min-h-0">
          <VoiceStage onAsk={ask} />
        </div>
        <div className="relative min-h-[320px] lg:col-span-4 lg:min-h-0">
          <ConversationPanel lines={state.lines} onSend={ask} />
        </div>
      </div>

      <div
        data-testid="metrics-strip"
        className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-border bg-surface-1 px-3 py-2"
      >
        <Metric label="Turns" value={fmtInt(state.metrics.turns)} />
        <Metric label="Median first audio" value={ms(state.metrics.medianFirstAudioMs)} />
        <Metric label="Last first audio" value={ms(state.metrics.lastFirstAudioMs)} />
        <Metric label="STT mode" value={state.sttMode ?? "-"} />
        <Metric label="TTS mode" value={state.ttsMode ?? "-"} />
        <Metric label="Language" value={LANGUAGES.find((l) => l.value === state.language)?.label ?? state.language} />
      </div>
      <p className="text-[11px] leading-tight text-muted">{FOOTER_NOTE}</p>
    </div>
  );
}
