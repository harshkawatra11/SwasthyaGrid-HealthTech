// The bridge between the voice session (which owns two AudioContexts, one
// for mic capture and one for playback) and the orb (which reads amplitude
// every animation frame). A module-level singleton rather than React
// context or state: only one call is ever active at a time in this product,
// the orb needs to read at 60fps with zero re-renders, and threading two
// AnalyserNode refs through prop chains would be pure ceremony for that.

export type OrbPhase = "idle" | "listening" | "thinking" | "speaking";

export interface OrbAudioState {
  micAnalyser: AnalyserNode | null;
  ttsAnalyser: AnalyserNode | null;
  phase: OrbPhase;
}

export const orbAudio: OrbAudioState = {
  micAnalyser: null,
  ttsAnalyser: null,
  phase: "idle",
};

const scratch = new Uint8Array(512);

/** RMS of an analyser's current time-domain buffer, 0..1. Reused across mic
 *  and TTS analysers via a single scratch buffer to avoid an allocation per
 *  frame on the hot path. */
export function analyserRms(analyser: AnalyserNode): number {
  // Cast needed because TS's DOM lib types getByteTimeDomainData as wanting
  // Uint8Array<ArrayBuffer> specifically, while `new Uint8Array(n)` infers
  // the more general Uint8Array<ArrayBufferLike>; they are the same thing
  // at runtime for a plain heap-allocated typed array.
  if (analyser.fftSize !== scratch.length) {
    // fftSize can differ per analyser; fall back to a right-sized read rather
    // than assuming the shared scratch buffer always fits.
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
    return rmsOf(buf);
  }
  analyser.getByteTimeDomainData(scratch as Uint8Array<ArrayBuffer>);
  return rmsOf(scratch);
}

function rmsOf(buf: Uint8Array): number {
  let sumSquares = 0;
  for (let i = 0; i < buf.length; i++) {
    const centered = (buf[i] - 128) / 128;
    sumSquares += centered * centered;
  }
  return Math.sqrt(sumSquares / buf.length);
}
