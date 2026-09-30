import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlaybackQueue, pcm16ToFloat32 } from "./playback";
import { attachMicAnalyser, detachOrbAnalysers } from "./mic";
import { orbAudio } from "./levels";

class FakeSource {
  buffer: { duration: number; id?: number } | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connect = vi.fn();
  disconnect = vi.fn();
  start(at: number) {
    this.startedAt = at;
  }
  stop() {
    this.stopped = true;
  }
  end() {
    this.onended?.();
  }
}

interface Deferred {
  resolve: (b: { duration: number; id: number }) => void;
}

let sources: FakeSource[];
let decodes: Deferred[];
let now: number;

class FakeContext {
  state = "running";
  destination = {};
  get currentTime() {
    return now;
  }
  createAnalyser() {
    return { fftSize: 0, connect: vi.fn(), getByteTimeDomainData: vi.fn() };
  }
  createBufferSource() {
    const s = new FakeSource();
    sources.push(s);
    return s;
  }
  createBuffer(_ch: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data, data };
  }
  decodeAudioData() {
    return new Promise((resolve) => {
      decodes.push({ resolve: resolve as Deferred["resolve"] });
    });
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

function b64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  sources = [];
  decodes = [];
  now = 1;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pcm16ToFloat32", () => {
  it("maps the extremes and zero", () => {
    const out = pcm16ToFloat32(new Uint8Array([0x00, 0x80, 0x00, 0x00, 0xff, 0x7f]));
    expect(out[0]).toBe(-1);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeCloseTo(32767 / 32768, 6);
  });

  it("ignores a trailing odd byte", () => {
    expect(pcm16ToFloat32(new Uint8Array([0x00, 0x40, 0x01])).length).toBe(1);
  });
});

describe("AudioPlaybackQueue", () => {
  it("schedules PCM chunks back to back with a 20 ms lead", async () => {
    const q = new AudioPlaybackQueue();
    // 240 samples at 24 kHz is 10 ms.
    const chunk = b64(new Array(480).fill(0));
    q.enqueuePcm16(chunk, 24000);
    q.enqueuePcm16(chunk, 24000);
    await flush();
    expect(sources).toHaveLength(2);
    expect(sources[0].startedAt).toBeCloseTo(1.02, 5);
    expect(sources[1].startedAt).toBeCloseTo(1.03, 5);
  });

  it("keeps arrival order when decodes resolve out of order", async () => {
    const q = new AudioPlaybackQueue();
    q.enqueueWavBase64(b64([1, 2]));
    q.enqueueWavBase64(b64([3, 4]));
    await flush();
    // Only the first decode has been requested: the second waits its turn.
    expect(decodes).toHaveLength(1);
    decodes[0].resolve({ duration: 0.5, id: 1 });
    await flush();
    expect(decodes).toHaveLength(2);
    decodes[1].resolve({ duration: 0.25, id: 2 });
    await flush();
    expect(sources.map((s) => s.buffer?.id)).toEqual([1, 2]);
    expect(sources[1].startedAt).toBeCloseTo((sources[0].startedAt as number) + 0.5, 5);
  });

  it("discards a decode that resolves after stopAll", async () => {
    const q = new AudioPlaybackQueue();
    q.enqueueWavBase64(b64([1, 2]));
    await flush();
    q.stopAll();
    decodes[0].resolve({ duration: 0.5, id: 1 });
    await flush();
    expect(sources).toHaveLength(0);
    expect(q.stats.discarded).toBe(1);
    // A chunk enqueued after the stop plays normally.
    q.enqueueWavBase64(b64([5, 6]));
    await flush();
    decodes[1].resolve({ duration: 0.5, id: 3 });
    await flush();
    expect(sources).toHaveLength(1);
  });

  it("stopAll stops and disconnects every source and reports idle once", async () => {
    const onIdle = vi.fn();
    const q = new AudioPlaybackQueue({ onIdle });
    const chunk = b64(new Array(480).fill(0));
    q.enqueuePcm16(chunk, 24000);
    q.enqueuePcm16(chunk, 24000);
    await flush();
    expect(q.isPlaying).toBe(true);
    q.stopAll();
    expect(sources.every((s) => s.stopped && s.disconnect.mock.calls.length > 0)).toBe(true);
    expect(q.isPlaying).toBe(false);
    expect(onIdle).toHaveBeenCalledTimes(1);
    q.stopAll();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("fires onStart when the first source begins and onIdle when the last ends", async () => {
    const onStart = vi.fn();
    const onIdle = vi.fn();
    const q = new AudioPlaybackQueue({ onStart, onIdle });
    const chunk = b64(new Array(480).fill(0));
    q.enqueuePcm16(chunk, 24000);
    q.enqueuePcm16(chunk, 24000);
    await flush();
    expect(onStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(25);
    expect(onStart).toHaveBeenCalledTimes(1);
    sources[0].end();
    expect(onIdle).not.toHaveBeenCalled();
    expect(q.isPlaying).toBe(true);
    sources[1].end();
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(q.isPlaying).toBe(false);
  });

  it("does not fire onStart after stopAll cancelled the pending start", async () => {
    const onStart = vi.fn();
    const q = new AudioPlaybackQueue({ onStart });
    q.enqueuePcm16(b64(new Array(480).fill(0)), 24000);
    await flush();
    q.stopAll();
    vi.advanceTimersByTime(100);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("close is idempotent", async () => {
    const q = new AudioPlaybackQueue();
    await q.close();
    await q.close();
  });
});

describe("mic analyser", () => {
  it("taps the source without touching a destination and registers with the orb", () => {
    const analyser = { fftSize: 0 } as unknown as AnalyserNode;
    const ctx = { createAnalyser: () => analyser };
    const source = { connect: vi.fn() };
    const out = attachMicAnalyser(ctx, source);
    expect(out.fftSize).toBe(512);
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(orbAudio.micAnalyser).toBe(analyser);
    detachOrbAnalysers();
    expect(orbAudio.micAnalyser).toBeNull();
    expect(orbAudio.ttsAnalyser).toBeNull();
  });
});
