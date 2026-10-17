import { afterEach, describe, expect, it, vi } from "vitest";
import { startMicCapture } from "./capture";

afterEach(() => vi.unstubAllGlobals());

describe("microphone capture graph", () => {
  it("renders the recorder through a silent sink and releases it on stop", async () => {
    const stop = vi.fn();
    const source = { connect: vi.fn() };
    const sink = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    const destination = {};
    const node = { port: { onmessage: null }, connect: vi.fn(), disconnect: vi.fn() };
    const close = vi.fn(async () => {});
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({
      getAudioTracks: () => [{ enabled: true }], getTracks: () => [{ stop }],
    })) } });
    vi.stubGlobal("AudioContext", class {
      sampleRate = 16000;
      destination = destination;
      audioWorklet = { addModule: vi.fn(async () => {}) };
      resume = vi.fn(async () => {});
      close = close;
      createMediaStreamSource = () => source;
      createGain = () => sink;
      createAnalyser = () => ({ fftSize: 0 });
    });
    vi.stubGlobal("AudioWorkletNode", class { constructor() { return node; } });
    const capture = await startMicCapture(vi.fn());
    expect(node.connect).toHaveBeenCalledWith(sink);
    expect(sink.gain.value).toBe(0);
    expect(sink.connect).toHaveBeenCalledWith(destination);
    capture.stop();
    expect(node.disconnect).toHaveBeenCalled();
    expect(sink.disconnect).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
