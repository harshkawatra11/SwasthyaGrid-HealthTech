import { bytesToB64 } from "@/lib/audio/b64";
import { attachMicAnalyser } from "@/lib/audio/mic";

export interface MicCapture {
  /** Enables or disables the microphone track (mute). */
  setEnabled(enabled: boolean): void;
  stop(): void;
  /** Non-fatal notice, for example a device that ignored the 16 kHz request. */
  warning: string | null;
}

/** Opens the microphone, runs the PCM16 worklet at 16 kHz and reports about
 *  100 ms frames as base64. The source also feeds an analyser for the orb; it
 *  is never connected to the destination, so the officer is not echoed back.
 *  Must run inside a user gesture or the AudioContext starts suspended. */
export async function startMicCapture(onFrame: (b64: string) => void): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.resume();
    let warning: string | null = null;
    if (ctx.sampleRate !== 16000) {
      warning = `Microphone started at ${ctx.sampleRate}Hz instead of 16000Hz. Speech recognition accuracy may suffer on this device.`;
    }
    await ctx.audioWorklet.addModule("/worklets/pcm-recorder.js");
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-recorder");
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onFrame(bytesToB64(new Uint8Array(e.data)));
    src.connect(node);
    attachMicAnalyser(ctx, src);
    const owned = ctx;
    return {
      warning,
      setEnabled(enabled) {
        stream.getAudioTracks().forEach((t) => {
          t.enabled = enabled;
        });
      },
      stop() {
        node.port.onmessage = null;
        stream.getTracks().forEach((t) => t.stop());
        void owned.close().catch(() => undefined);
      },
    };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => undefined);
    throw err;
  }
}
