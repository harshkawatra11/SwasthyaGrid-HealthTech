import { orbAudio, type OrbPhase } from "@/lib/audio/levels";
import { detachOrbAnalysers } from "@/lib/audio/mic";
import { AudioPlaybackQueue, type PlaybackHooks } from "@/lib/audio/playback";
import { startMicCapture, type MicCapture } from "./capture";
import {
  defaultVoiceUrl,
  type ClientFrame,
  type FactCard,
  type ServerFrame,
  type TranscriptLine,
  type VoiceLanguage,
  type VoiceMode,
} from "./protocol";

export type VoiceStatus = "idle" | "connecting" | "connected" | "failed";

export interface VoiceState {
  status: VoiceStatus;
  phase: OrbPhase;
  thinkingLabel: string | null;
  caption: string | null;
  lines: TranscriptLine[];
  language: VoiceLanguage;
  mode: VoiceMode;
  muted: boolean;
  sttMode: "ws" | "typed" | null;
  ttsMode: "ws" | "rest" | null;
  metrics: { turns: number; medianFirstAudioMs: number | null; lastFirstAudioMs: number | null };
  errorMessage: string | null;
}

export interface StartOptions {
  language?: VoiceLanguage;
  scope?: string | null;
  mode?: VoiceMode;
  /** false opens a typed-only session without asking for the microphone. */
  mic?: boolean;
}

/** The subset of WebSocket the client uses (lets tests inject a fake). */
export interface SocketLike {
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface PlaybackLike {
  readonly analyser: AnalyserNode;
  readonly isPlaying: boolean;
  readonly pending: number;
  readonly stats: { enqueued: number; scheduled: number; discarded: number };
  enqueueWavBase64(b64: string): void;
  enqueuePcm16(b64: string, sampleRate: number): void;
  stopAll(): void;
  close(): Promise<void>;
}

export interface VoiceDeps {
  createSocket(url: string): SocketLike;
  createPlayback(hooks: PlaybackHooks): PlaybackLike;
  startCapture(onFrame: (b64: string) => void): Promise<Pick<MicCapture, "setEnabled" | "stop" | "warning">>;
  url(): string;
  now(): number;
  /** Dev-only diagnostics sink. */
  log?: (msg: string) => void;
}

const OPEN = 1;
export const CONNECT_TIMEOUT_MS = 8000;
export const IDLE_GRACE_MS = 250;
export const CAPTION_CLEAR_MS = 2000;

export function defaultDeps(): VoiceDeps {
  return {
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    createPlayback: (hooks) => new AudioPlaybackQueue(hooks),
    startCapture: startMicCapture,
    url: () =>
      defaultVoiceUrl(
        { voiceUrl: process.env.NEXT_PUBLIC_VOICE_WS_URL, apiBase: process.env.NEXT_PUBLIC_API_BASE },
        typeof window === "undefined" ? undefined : window.location,
      ),
    now: () => performance.now(),
    log: process.env.NODE_ENV !== "production" ? (m) => console.debug(m) : undefined,
  };
}

function newLine(partial: Partial<TranscriptLine> & Pick<TranscriptLine, "speaker" | "text">): TranscriptLine {
  return {
    id: crypto.randomUUID(),
    partial: false,
    toolCalls: [],
    cards: [],
    trace: [],
    turnId: null,
    clientTurnId: null,
    streaming: false,
    interrupted: false,
    ...partial,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Owns the microphone, the voice WebSocket and playback for one call.
 *  A plain class with a subscribe/getSnapshot surface so React reads it with
 *  useSyncExternalStore and tests drive it with a fake socket. Reusable after
 *  stop(): React strict mode unmounts and remounts the provider in dev. */
export class VoiceClient {
  private state: VoiceState = {
    status: "idle",
    phase: "idle",
    thinkingLabel: null,
    caption: null,
    lines: [],
    language: "auto",
    mode: "handsfree",
    muted: false,
    sttMode: null,
    ttsMode: null,
    metrics: { turns: 0, medianFirstAudioMs: null, lastFirstAudioMs: null },
    errorMessage: null,
  };
  private listeners = new Set<() => void>();
  private ws: SocketLike | null = null;
  private playback: PlaybackLike | null = null;
  private capture: Pick<MicCapture, "setEnabled" | "stop" | "warning"> | null = null;
  private opened = false;
  private started = false;
  private scope: string | null = null;
  private pttHeld = false;
  private activeTurnId: string | null = null;
  private interruptedTurns = new Set<string>();
  private firstAudioMs: number[] = [];
  private audioFrames = 0;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private captionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: VoiceDeps = defaultDeps()) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): VoiceState => this.state;

  /** Audio frames received this session (dev diagnostics). */
  get audioFrameCount(): number {
    return this.audioFrames;
  }

  get playbackStats() {
    return this.playback?.stats ?? null;
  }

  // ------------------------------------------------------------------ state

  private set(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    if (patch.phase) orbAudio.phase = patch.phase;
    this.listeners.forEach((l) => l());
  }

  private setPhase(phase: OrbPhase): void {
    if (this.state.phase !== phase) this.set({ phase });
  }

  private updateLines(fn: (lines: TranscriptLine[]) => TranscriptLine[]): void {
    this.set({ lines: fn(this.state.lines) });
  }

  private clearTimer(name: "connectTimer" | "graceTimer" | "captionTimer"): void {
    const t = this[name];
    if (t) clearTimeout(t);
    this[name] = null;
  }

  private send(frame: ClientFrame): boolean {
    const ws = this.ws;
    if (ws && ws.readyState === OPEN) {
      ws.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- session

  async start(opts: StartOptions = {}): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.opened = false;
    this.pttHeld = false;
    this.activeTurnId = null;
    this.interruptedTurns.clear();
    this.audioFrames = 0;
    if (opts.language) this.state = { ...this.state, language: opts.language };
    if (opts.mode) this.state = { ...this.state, mode: opts.mode };
    if (opts.scope !== undefined) this.scope = opts.scope;
    this.set({ status: "connecting", errorMessage: null });

    const url = this.deps.url();
    const failMessage = `Could not reach the voice service at ${url}. Check that the backend is running.`;
    const ws = this.deps.createSocket(url);
    this.ws = ws;
    this.playback = this.deps.createPlayback({
      onStart: () => this.onPlaybackStart(),
      onIdle: () => this.onPlaybackIdle(),
    });
    orbAudio.ttsAnalyser = this.playback.analyser;

    this.connectTimer = setTimeout(() => {
      if (this.opened || this.ws !== ws) return;
      try {
        ws.close();
      } catch {
        // already closing
      }
      this.teardown();
      this.set({ status: "failed", phase: "idle", errorMessage: failMessage });
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.opened = true;
      this.clearTimer("connectTimer");
      this.send({
        t: "hello",
        language: this.state.language,
        scope: this.scope,
        mode: this.state.mode,
        protocol: 2,
      });
      this.set({ status: "connected" });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let frame: ServerFrame;
      try {
        frame = JSON.parse(ev.data) as ServerFrame;
      } catch {
        return;
      }
      this.handleFrame(frame);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const neverOpened = !this.opened;
      this.clearTimer("connectTimer");
      this.teardown();
      this.set({
        status: neverOpened ? "failed" : "idle",
        phase: "idle",
        thinkingLabel: null,
        errorMessage: neverOpened ? failMessage : this.state.errorMessage,
      });
    };
    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.set({ errorMessage: this.opened ? "Connection to the voice agent dropped." : failMessage });
    };

    if (opts.mic === false) return;
    try {
      const capture = await this.deps.startCapture((b64) => this.onMicFrame(b64));
      if (this.ws !== ws) {
        capture.stop();
        return;
      }
      this.capture = capture;
      capture.setEnabled(!this.state.muted);
      if (capture.warning) this.set({ errorMessage: capture.warning });
    } catch {
      if (this.ws === ws) {
        this.set({ errorMessage: "Microphone access was denied. Type your question instead." });
      }
    }
  }

  stop(): void {
    this.clearTimer("connectTimer");
    if (this.ws) {
      this.send({ t: "bye" });
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
    this.teardown();
    this.set({ status: "idle", phase: "idle", thinkingLabel: null });
  }

  /** Releases capture, playback and timers. Keeps lines and settings. */
  private teardown(): void {
    this.clearTimer("graceTimer");
    this.clearTimer("captionTimer");
    this.capture?.stop();
    this.capture = null;
    const playback = this.playback;
    this.playback = null;
    if (playback) {
      playback.stopAll();
      void playback.close();
    }
    detachOrbAnalysers();
    this.ws = null;
    this.started = false;
    this.opened = false;
    this.pttHeld = false;
  }

  // ----------------------------------------------------------- user actions

  /** Stops the assistant now: local playback first, then tell the server. */
  interrupt(): void {
    const t0 = this.deps.now();
    this.playback?.stopAll();
    const elapsed = this.deps.now() - t0;
    this.deps.log?.(`[voice] stopAll took ${elapsed.toFixed(2)} ms`);
    if (this.activeTurnId) this.interruptedTurns.add(this.activeTurnId);
    this.send({ t: "interrupt" });
    this.clearTimer("graceTimer");
    if (this.state.status === "connected") this.set({ phase: "listening", thinkingLabel: null });
    this.updateLines((ls) => ls.map((l) => (l.streaming ? { ...l, streaming: false, interrupted: true } : l)));
  }

  sendTyped(text: string): boolean {
    const body = text.trim();
    if (!body) return false;
    const clientTurnId = crypto.randomUUID();
    if (!this.send({ t: "text", body, clientTurnId })) {
      this.set({ errorMessage: "Not connected to the voice service, so that question was not sent." });
      return false;
    }
    this.updateLines((ls) => [...ls, newLine({ speaker: "officer", text: body, clientTurnId })]);
    return true;
  }

  setMuted(muted: boolean): void {
    this.capture?.setEnabled(!muted);
    this.set({ muted });
  }

  pttDown(): void {
    if (this.state.mode !== "ptt" || this.pttHeld) return;
    this.pttHeld = true;
    this.send({ t: "ptt", state: "down" });
    if (this.state.status === "connected" && this.state.phase !== "speaking") this.setPhase("listening");
  }

  pttUp(): void {
    if (!this.pttHeld) return;
    this.pttHeld = false;
    this.send({ t: "ptt", state: "up" });
  }

  setLanguage(language: VoiceLanguage): void {
    this.set({ language });
  }

  setMode(mode: VoiceMode): void {
    this.pttHeld = false;
    this.set({ mode });
  }

  setScope(scope: string | null): void {
    if (scope === this.scope) return;
    this.scope = scope;
    this.send({ t: "context", scope });
  }

  private onMicFrame(b64: string): void {
    if (this.state.muted) return;
    if (this.state.mode === "ptt" && !this.pttHeld) return;
    this.send({ t: "audio", b64 });
  }

  // --------------------------------------------------------------- playback

  private onPlaybackStart(): void {
    this.clearTimer("graceTimer");
    this.clearTimer("captionTimer");
    this.setPhase("speaking");
  }

  private onPlaybackIdle(): void {
    this.clearTimer("graceTimer");
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      const pb = this.playback;
      if (!pb || pb.isPlaying || pb.pending > 0) return;
      if (this.state.phase === "speaking") {
        this.setPhase("listening");
        this.scheduleCaptionClear();
      }
    }, IDLE_GRACE_MS);
  }

  private scheduleCaptionClear(): void {
    this.clearTimer("captionTimer");
    this.captionTimer = setTimeout(() => {
      this.captionTimer = null;
      if (this.state.phase !== "speaking") this.set({ caption: null });
    }, CAPTION_CLEAR_MS);
  }

  // ----------------------------------------------------------------- frames

  handleFrame(frame: ServerFrame): void {
    switch (frame.t) {
      case "ready":
        this.set({
          sttMode: frame.sttMode === "ws" ? "ws" : "typed",
          ttsMode: frame.ttsMode ?? null,
          phase: this.state.phase === "idle" ? "listening" : this.state.phase,
        });
        break;
      case "vad":
        // Never stops playback: a bare vad start can be the assistant's own voice.
        if (frame.state === "start" && this.state.phase !== "speaking") this.setPhase("listening");
        break;
      case "partial":
        this.clearTimer("captionTimer");
        this.updateLines((ls) => upsertPartial(ls, frame.text));
        this.set({ caption: frame.text });
        if (this.state.phase !== "speaking") this.setPhase("listening");
        break;
      case "final":
        this.onFinal(frame);
        break;
      case "thinking":
        this.activeTurnId = frame.turnId;
        if (this.interruptedTurns.has(frame.turnId)) break;
        this.ensureAssistant(frame.turnId);
        this.set({ thinkingLabel: frame.label });
        if (this.state.phase !== "speaking") this.setPhase("thinking");
        break;
      case "tool":
        if (this.interruptedTurns.has(frame.turnId)) break;
        this.updateAssistant(frame.turnId, (l) => ({
          ...l,
          trace: [...l.trace, { name: frame.name, label: frame.label, ok: frame.ok }],
        }));
        break;
      case "reply_delta":
        if (this.interruptedTurns.has(frame.turnId)) break;
        this.updateAssistant(frame.turnId, (l) => ({
          ...l,
          streaming: true,
          text: l.text ? `${l.text} ${frame.text}` : frame.text,
        }));
        this.clearTimer("captionTimer");
        this.set({ caption: frame.text });
        break;
      case "reply":
        if (this.interruptedTurns.has(frame.turnId)) break;
        this.updateAssistant(frame.turnId, (l) => ({
          ...l,
          text: frame.text,
          toolCalls: frame.toolCalls ?? [],
          cards: (frame.cards ?? []) as FactCard[],
          streaming: false,
        }));
        this.set({ thinkingLabel: null });
        break;
      case "audio":
        this.onAudio(frame);
        break;
      case "interrupted":
        this.onInterrupted(frame.turnId);
        break;
      case "turn_end":
        this.onTurnEnd(frame);
        break;
      case "error":
        this.set({ errorMessage: frame.message });
        if (frame.fatal) this.stop();
        break;
    }
  }

  private onFinal(frame: Extract<ServerFrame, { t: "final" }>): void {
    this.activeTurnId = frame.turnId;
    this.interruptedTurns.delete(frame.turnId);
    this.updateLines((ls) => {
      // A typed question was already added optimistically; match it, never duplicate.
      if (frame.clientTurnId) {
        const i = ls.findIndex((l) => l.speaker === "officer" && l.clientTurnId === frame.clientTurnId);
        if (i >= 0) {
          const next = [...ls];
          next[i] = { ...next[i], turnId: frame.turnId, text: frame.text || next[i].text };
          return next;
        }
      }
      return finalizeOfficer(ls, frame.text, frame.turnId);
    });
    this.clearTimer("captionTimer");
    this.set({ caption: null });
    if (this.state.phase !== "speaking") this.setPhase("thinking");
  }

  private onAudio(frame: Extract<ServerFrame, { t: "audio" }>): void {
    this.audioFrames += 1;
    if (this.interruptedTurns.has(frame.turnId)) return;
    const pb = this.playback;
    if (!pb) return;
    if (frame.encoding === "wav") pb.enqueueWavBase64(frame.b64);
    else pb.enqueuePcm16(frame.b64, frame.sampleRateHz);
  }

  private onInterrupted(turnId: string): void {
    this.interruptedTurns.add(turnId);
    this.playback?.stopAll();
    this.clearTimer("graceTimer");
    this.updateAssistant(turnId, (l) => ({ ...l, streaming: false, interrupted: true }), false);
    this.set({ thinkingLabel: null, phase: this.state.status === "connected" ? "listening" : this.state.phase });
  }

  private onTurnEnd(frame: Extract<ServerFrame, { t: "turn_end" }>): void {
    const ms = frame.metrics?.finalToFirstAudioMs;
    if (typeof ms === "number") this.firstAudioMs.push(ms);
    this.set({
      thinkingLabel: null,
      metrics: {
        turns: this.state.metrics.turns + 1,
        medianFirstAudioMs: median(this.firstAudioMs),
        lastFirstAudioMs: typeof ms === "number" ? ms : this.state.metrics.lastFirstAudioMs,
      },
    });
    this.updateLines((ls) => ls.map((l) => (l.turnId === frame.turnId && l.streaming ? { ...l, streaming: false } : l)));
    const pb = this.playback;
    if (pb) {
      this.deps.log?.(
        `[voice] turn_end ${frame.turnId}: audio frames ${this.audioFrames}, queue enqueued ${pb.stats.enqueued}, scheduled ${pb.stats.scheduled}, discarded ${pb.stats.discarded}`,
      );
    }
    // No audio ever started (TTS off or failed): leave the thinking state.
    if (this.state.phase === "thinking" && pb && !pb.isPlaying && pb.pending === 0) {
      this.setPhase("listening");
      this.scheduleCaptionClear();
    }
  }

  // ------------------------------------------------------- assistant lines

  private ensureAssistant(turnId: string): void {
    this.updateLines((ls) =>
      ls.some((l) => l.speaker === "assistant" && l.turnId === turnId)
        ? ls
        : [...ls, newLine({ speaker: "assistant", text: "", turnId, streaming: true })],
    );
  }

  private updateAssistant(turnId: string, fn: (l: TranscriptLine) => TranscriptLine, create = true): void {
    if (create) this.ensureAssistant(turnId);
    this.updateLines((ls) => ls.map((l) => (l.speaker === "assistant" && l.turnId === turnId ? fn(l) : l)));
  }
}

function upsertPartial(ls: TranscriptLine[], text: string): TranscriptLine[] {
  const last = ls[ls.length - 1];
  if (last && last.speaker === "officer" && last.partial) {
    return [...ls.slice(0, -1), { ...last, text }];
  }
  return [...ls, newLine({ speaker: "officer", text, partial: true })];
}

function finalizeOfficer(ls: TranscriptLine[], text: string, turnId: string): TranscriptLine[] {
  const last = ls[ls.length - 1];
  if (last && last.speaker === "officer" && last.partial) {
    return [...ls.slice(0, -1), { ...last, text, partial: false, turnId }];
  }
  return [...ls, newLine({ speaker: "officer", text, turnId })];
}
