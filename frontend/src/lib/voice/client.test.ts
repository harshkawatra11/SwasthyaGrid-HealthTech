import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orbAudio } from "@/lib/audio/levels";
import type { PlaybackHooks } from "@/lib/audio/playback";
import {
  CAPTION_CLEAR_MS,
  CONNECT_TIMEOUT_MS,
  IDLE_GRACE_MS,
  VoiceClient,
  type PlaybackLike,
  type SocketLike,
  type VoiceDeps,
} from "./client";
import { defaultVoiceUrl, type ClientFrame, type ServerFrame } from "./protocol";

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  sent: ClientFrame[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientFrame);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(frame: ServerFrame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  frames(t: ClientFrame["t"]) {
    return this.sent.filter((f) => f.t === t);
  }
}

class FakePlayback implements PlaybackLike {
  analyser = {} as AnalyserNode;
  isPlaying = false;
  pending = 0;
  stats = { enqueued: 0, scheduled: 0, discarded: 0 };
  pcm: { b64: string; rate: number }[] = [];
  wav: string[] = [];
  stopCalls = 0;
  closed = false;
  constructor(readonly hooks: PlaybackHooks) {}
  enqueueWavBase64(b64: string) {
    this.wav.push(b64);
    this.stats.enqueued += 1;
  }
  enqueuePcm16(b64: string, rate: number) {
    this.pcm.push({ b64, rate });
    this.stats.enqueued += 1;
  }
  stopAll() {
    this.stopCalls += 1;
    const was = this.isPlaying;
    this.isPlaying = false;
    if (was) this.hooks.onIdle?.();
  }
  async close() {
    this.closed = true;
  }
  /** Simulates the first audible sample. */
  startSounding() {
    this.isPlaying = true;
    this.hooks.onStart?.();
  }
  finish() {
    this.isPlaying = false;
    this.hooks.onIdle?.();
  }
}

interface Rig {
  client: VoiceClient;
  socket: FakeSocket;
  playback: () => FakePlayback;
  micFrame: (b64: string) => void;
  micEnabled: () => boolean;
  logs: string[];
}

async function rig(opts: { mic?: boolean; micFails?: boolean } = {}): Promise<Rig> {
  const socket = new FakeSocket();
  let playback!: FakePlayback;
  let onFrame: (b64: string) => void = () => undefined;
  let enabled = true;
  let clock = 0;
  const logs: string[] = [];
  const deps: VoiceDeps = {
    createSocket: () => socket,
    createPlayback: (hooks) => (playback = new FakePlayback(hooks)),
    startCapture: async (cb) => {
      if (opts.micFails) throw new Error("denied");
      onFrame = cb;
      return { setEnabled: (e) => (enabled = e), stop: () => undefined, warning: null };
    },
    url: () => "ws://127.0.0.1:8080/ws/voice",
    now: () => (clock += 3),
    log: (m) => logs.push(m),
  };
  const client = new VoiceClient(deps);
  await client.start({ mic: opts.mic });
  socket.open();
  return { client, socket, playback: () => playback, micFrame: (b) => onFrame(b), micEnabled: () => enabled, logs };
}

const ready: ServerFrame = { t: "ready", sttMode: "ws", ttsMode: "ws", protocol: 2, speaker: "shubh" };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  orbAudio.phase = "idle";
});

describe("connection", () => {
  it("sends a v2 hello and reports connected", async () => {
    const { client, socket } = await rig();
    expect(socket.sent[0]).toEqual({ t: "hello", language: "auto", scope: null, mode: "handsfree", protocol: 2 });
    expect(client.getSnapshot().status).toBe("connected");
  });

  it("fails after the connect timeout when the socket never opens", async () => {
    const socket = new FakeSocket();
    const client = new VoiceClient({
      createSocket: () => socket,
      createPlayback: (h) => new FakePlayback(h),
      startCapture: async () => ({ setEnabled: () => undefined, stop: () => undefined, warning: null }),
      url: () => "ws://127.0.0.1:1/ws/voice",
      now: () => 0,
    });
    void client.start();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS + 1);
    expect(client.getSnapshot().status).toBe("failed");
    expect(client.getSnapshot().errorMessage).toContain("127.0.0.1");
    expect(socket.closed).toBe(true);
  });

  it("can start again after a failure", async () => {
    const socket = new FakeSocket();
    const client = new VoiceClient({
      createSocket: () => socket,
      createPlayback: (h) => new FakePlayback(h),
      startCapture: async () => ({ setEnabled: () => undefined, stop: () => undefined, warning: null }),
      url: () => "ws://x",
      now: () => 0,
    });
    void client.start();
    socket.onclose?.();
    expect(client.getSnapshot().status).toBe("failed");
    void client.start();
    expect(client.getSnapshot().status).toBe("connecting");
  });

  it("reports a denied microphone without dropping the session", async () => {
    const { client } = await rig({ micFails: true });
    expect(client.getSnapshot().status).toBe("connected");
    expect(client.getSnapshot().errorMessage).toContain("Microphone access was denied");
  });

  it("stop ends the session, closes playback and returns the phase to idle", async () => {
    const { client, socket, playback } = await rig();
    socket.push(ready);
    client.stop();
    expect(socket.frames("bye")).toHaveLength(1);
    expect(playback().closed).toBe(true);
    expect(client.getSnapshot()).toMatchObject({ status: "idle", phase: "idle" });
    // Idempotent.
    client.stop();
  });

  it("derives the websocket url without localhost", () => {
    expect(defaultVoiceUrl({}, { protocol: "http:", hostname: "localhost" })).toBe("ws://127.0.0.1:8080/ws/voice");
    expect(defaultVoiceUrl({ apiBase: "http://localhost:8083/" })).toBe("ws://127.0.0.1:8083/ws/voice");
    expect(defaultVoiceUrl({ voiceUrl: "ws://h/x", apiBase: "http://y" })).toBe("ws://h/x");
  });
});

describe("phase transitions", () => {
  it("follows what the user hears: listening, thinking, speaking, back to listening after the grace", async () => {
    const { client, socket, playback } = await rig();
    const phase = () => client.getSnapshot().phase;
    socket.push(ready);
    expect(phase()).toBe("listening");
    expect(client.getSnapshot()).toMatchObject({ sttMode: "ws", ttsMode: "ws" });

    socket.push({ t: "partial", text: "kota" });
    expect(client.getSnapshot().caption).toBe("kota");
    socket.push({ t: "final", text: "kota mein kya hai", turnId: "t1", language: "hi-IN" });
    expect(phase()).toBe("thinking");
    socket.push({ t: "thinking", turnId: "t1", stage: "tools", label: "Checking Kota district data" });
    expect(client.getSnapshot().thinkingLabel).toBe("Checking Kota district data");

    // Receiving an audio frame does not make the orb speak; playback does.
    socket.push({ t: "audio", turnId: "t1", seq: 0, b64: "AAA=", encoding: "pcm_s16le", sampleRateHz: 24000 });
    expect(phase()).toBe("thinking");
    playback().startSounding();
    expect(phase()).toBe("speaking");

    playback().finish();
    expect(phase()).toBe("speaking");
    vi.advanceTimersByTime(IDLE_GRACE_MS + 1);
    expect(phase()).toBe("listening");
  });

  it("does not flicker when the next sentence starts inside the grace window", async () => {
    const { client, socket, playback } = await rig();
    socket.push(ready);
    playback().startSounding();
    playback().finish();
    vi.advanceTimersByTime(IDLE_GRACE_MS - 50);
    playback().startSounding();
    vi.advanceTimersByTime(IDLE_GRACE_MS * 2);
    expect(client.getSnapshot().phase).toBe("speaking");
  });

  it("does not leave speaking on a bare vad start", async () => {
    const { client, socket, playback } = await rig();
    socket.push(ready);
    playback().startSounding();
    socket.push({ t: "vad", state: "start" });
    socket.push({ t: "partial", text: "echo" });
    expect(client.getSnapshot().phase).toBe("speaking");
  });

  it("leaves thinking when a turn ends without any audio", async () => {
    const { client, socket } = await rig();
    socket.push(ready);
    socket.push({ t: "final", text: "hello", turnId: "t1" });
    socket.push({ t: "reply", turnId: "t1", text: "Hi", cards: [] });
    socket.push({ t: "turn_end", turnId: "t1", metrics: {} });
    expect(client.getSnapshot().phase).toBe("listening");
  });

  it("clears the caption two seconds after the assistant goes idle", async () => {
    const { client, socket, playback } = await rig();
    socket.push(ready);
    socket.push({ t: "reply_delta", turnId: "t1", text: "Kota has two critical PHCs." });
    expect(client.getSnapshot().caption).toBe("Kota has two critical PHCs.");
    playback().startSounding();
    playback().finish();
    vi.advanceTimersByTime(IDLE_GRACE_MS + 1);
    expect(client.getSnapshot().caption).not.toBeNull();
    vi.advanceTimersByTime(CAPTION_CLEAR_MS + 1);
    expect(client.getSnapshot().caption).toBeNull();
  });

  it("mirrors the phase onto orbAudio for the orb", async () => {
    const { socket } = await rig();
    socket.push(ready);
    expect(orbAudio.phase).toBe("listening");
  });
});

describe("audio routing", () => {
  it("routes pcm_s16le to the PCM path and wav to the decoder", async () => {
    const { socket, playback, client } = await rig();
    socket.push({ t: "audio", turnId: "t1", seq: 0, b64: "AQID", encoding: "pcm_s16le", sampleRateHz: 24000 });
    socket.push({ t: "audio", turnId: "t1", seq: 1, b64: "UklG", encoding: "wav", sampleRateHz: 24000, filler: true });
    expect(playback().pcm).toEqual([{ b64: "AQID", rate: 24000 }]);
    expect(playback().wav).toEqual(["UklG"]);
    expect(client.audioFrameCount).toBe(2);
  });
});

describe("barge-in and interrupt", () => {
  it("stops playback on the server interrupted frame and drops late audio for that turn", async () => {
    const { client, socket, playback } = await rig();
    socket.push(ready);
    socket.push({ t: "final", text: "q", turnId: "t1" });
    socket.push({ t: "reply_delta", turnId: "t1", text: "Part of an answer." });
    playback().startSounding();
    expect(client.getSnapshot().phase).toBe("speaking");

    socket.push({ t: "interrupted", turnId: "t1" });
    expect(playback().stopCalls).toBe(1);
    expect(client.getSnapshot().phase).toBe("listening");
    const line = client.getSnapshot().lines.find((l) => l.speaker === "assistant");
    expect(line).toMatchObject({ interrupted: true, streaming: false, text: "Part of an answer." });

    socket.push({ t: "audio", turnId: "t1", seq: 4, b64: "AQID", encoding: "pcm_s16le", sampleRateHz: 24000 });
    expect(playback().pcm).toHaveLength(0);
    // A new turn plays normally.
    socket.push({ t: "final", text: "q2", turnId: "t2" });
    socket.push({ t: "audio", turnId: "t2", seq: 0, b64: "AQID", encoding: "pcm_s16le", sampleRateHz: 24000 });
    expect(playback().pcm).toHaveLength(1);
  });

  it("Stop stops local playback first, tells the server and logs the latency", async () => {
    const { client, socket, playback, logs } = await rig();
    socket.push(ready);
    socket.push({ t: "final", text: "q", turnId: "t1" });
    playback().startSounding();
    client.interrupt();
    expect(playback().stopCalls).toBe(1);
    expect(socket.frames("interrupt")).toHaveLength(1);
    expect(client.getSnapshot().phase).toBe("listening");
    expect(logs.some((l) => l.includes("stopAll took"))).toBe(true);
    // Straggler audio from the stopped turn is ignored.
    socket.push({ t: "audio", turnId: "t1", seq: 9, b64: "AQID", encoding: "pcm_s16le", sampleRateHz: 24000 });
    expect(playback().pcm).toHaveLength(0);
  });
});

describe("typed questions", () => {
  it("adds the officer line once even though the server echoes clientTurnId", async () => {
    const { client, socket } = await rig();
    socket.push(ready);
    expect(client.sendTyped("  Which district needs attention first?  ")).toBe(true);
    const sent = socket.frames("text")[0] as Extract<ClientFrame, { t: "text" }>;
    expect(sent.body).toBe("Which district needs attention first?");
    expect(sent.clientTurnId).toBeTruthy();
    expect(client.getSnapshot().lines).toHaveLength(1);

    socket.push({ t: "final", text: "Which district needs attention first?", turnId: "t1", language: "en-IN", clientTurnId: sent.clientTurnId });
    const officers = client.getSnapshot().lines.filter((l) => l.speaker === "officer");
    expect(officers).toHaveLength(1);
    expect(officers[0].turnId).toBe("t1");
  });

  it("reports a failed send instead of dropping it silently", async () => {
    const { client, socket } = await rig();
    socket.readyState = 3;
    expect(client.sendTyped("hello")).toBe(false);
    expect(client.getSnapshot().errorMessage).toContain("not sent");
    expect(client.getSnapshot().lines).toHaveLength(0);
  });

  it("ignores empty text", async () => {
    const { client, socket } = await rig();
    expect(client.sendTyped("   ")).toBe(false);
    expect(socket.frames("text")).toHaveLength(0);
  });
});

describe("assistant lines", () => {
  it("collects the trace, streamed sentences, then the final reply with cards", async () => {
    const { client, socket } = await rig();
    socket.push({ t: "final", text: "kota?", turnId: "t1" });
    socket.push({ t: "thinking", turnId: "t1", stage: "tools", label: "Checking Kota district data" });
    socket.push({ t: "tool", turnId: "t1", name: "get_district_briefing", label: "Checking Kota district data", ok: true });
    socket.push({ t: "reply_delta", turnId: "t1", text: "One." });
    socket.push({ t: "reply_delta", turnId: "t1", text: "Two." });
    let a = client.getSnapshot().lines.find((l) => l.speaker === "assistant");
    expect(a).toMatchObject({ text: "One. Two.", streaming: true });
    expect(a?.trace).toEqual([{ name: "get_district_briefing", label: "Checking Kota district data", ok: true }]);

    socket.push({
      t: "reply",
      turnId: "t1",
      text: "One. Two.",
      toolCalls: ["get_district_briefing"],
      cards: [{ type: "fleet", counts: { idle: 2 } }],
      language: "en-IN",
    });
    a = client.getSnapshot().lines.find((l) => l.speaker === "assistant");
    expect(a).toMatchObject({ streaming: false, toolCalls: ["get_district_briefing"] });
    expect(a?.cards).toHaveLength(1);
    expect(client.getSnapshot().lines.filter((l) => l.speaker === "assistant")).toHaveLength(1);
  });

  it("records turn metrics with a median", async () => {
    const { client, socket } = await rig();
    for (const [i, ms] of [900, 1500, 1200].entries()) {
      socket.push({ t: "turn_end", turnId: `t${i}`, metrics: { finalToFirstAudioMs: ms } });
    }
    expect(client.getSnapshot().metrics).toEqual({ turns: 3, medianFirstAudioMs: 1200, lastFirstAudioMs: 1200 });
  });

  it("shows an error frame and closes on a fatal one", async () => {
    const { client, socket } = await rig();
    socket.push({ t: "error", message: "Sorry.", fatal: false, code: "llm_error" });
    expect(client.getSnapshot().errorMessage).toBe("Sorry.");
    expect(client.getSnapshot().status).toBe("connected");
    socket.push({ t: "error", message: "Gone.", fatal: true, code: "no_key" });
    expect(client.getSnapshot().status).toBe("idle");
  });
});

describe("microphone gating", () => {
  it("sends frames in hands-free mode and stops while muted", async () => {
    const { client, socket, micFrame, micEnabled } = await rig();
    micFrame("AAAA");
    expect(socket.frames("audio")).toHaveLength(1);
    client.setMuted(true);
    expect(micEnabled()).toBe(false);
    micFrame("BBBB");
    expect(socket.frames("audio")).toHaveLength(1);
    client.setMuted(false);
    micFrame("CCCC");
    expect(socket.frames("audio")).toHaveLength(2);
  });

  it("sends audio only while the push to talk key is held", async () => {
    const { client, socket, micFrame } = await rig();
    client.setMode("ptt");
    micFrame("AAAA");
    expect(socket.frames("audio")).toHaveLength(0);
    client.pttDown();
    micFrame("BBBB");
    client.pttUp();
    micFrame("CCCC");
    expect(socket.frames("audio")).toHaveLength(1);
    expect(socket.frames("ptt").map((f) => (f as { state: string }).state)).toEqual(["down", "up"]);
  });

  it("ignores pttDown in hands-free mode", async () => {
    const { client, socket } = await rig();
    client.pttDown();
    expect(socket.frames("ptt")).toHaveLength(0);
  });
});

describe("scope", () => {
  it("sends a context frame only when the scope changes", async () => {
    const { client, socket } = await rig();
    client.setScope("district_kota");
    client.setScope("district_kota");
    client.setScope(null);
    expect(socket.frames("context")).toEqual([
      { t: "context", scope: "district_kota" },
      { t: "context", scope: null },
    ]);
  });
});
