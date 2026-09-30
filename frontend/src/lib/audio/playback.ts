import { b64ToBytes } from "./b64";

export interface PlaybackHooks {
  /** Fires when the first source of an idle queue actually starts sounding. */
  onStart?: () => void;
  /** Fires when the last scheduled source has ended, or after stopAll. */
  onIdle?: () => void;
}

export interface PlaybackStats {
  enqueued: number;
  scheduled: number;
  discarded: number;
}

/** Converts little-endian signed 16-bit PCM bytes to Float32 samples in -1..1. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const count = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** Schedules decoded audio back to back on a dedicated playback AudioContext
 *  using a playhead cursor, so sentence chunks never overlap. Separate from
 *  the mic context: capture is pinned to 16 kHz for STT.
 *
 *  Decodes are serialised through `tail` so chunks are scheduled in arrival
 *  order even when decodeAudioData resolves out of order. `generation` bumps on
 *  stopAll(); a decode that resolves afterwards sees a stale generation and is
 *  discarded instead of playing over the next turn. */
export class AudioPlaybackQueue {
  readonly analyser: AnalyserNode;
  readonly stats: PlaybackStats = { enqueued: 0, scheduled: 0, discarded: 0 };
  private ctx: AudioContext;
  private playhead = 0;
  private generation = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private tail: Promise<void> = Promise.resolve();
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly hooks: PlaybackHooks = {}) {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(this.ctx.destination);
  }

  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  /** Chunks accepted but not yet scheduled or discarded (still decoding). */
  get pending(): number {
    return Math.max(0, this.stats.enqueued - this.stats.scheduled - this.stats.discarded);
  }

  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  enqueueWavBase64(b64: string): void {
    const gen = this.generation;
    this.stats.enqueued += 1;
    this.chain(gen, async () => {
      const bytes = b64ToBytes(b64);
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return this.ctx.decodeAudioData(copy);
    });
  }

  enqueuePcm16(b64: string, sampleRate: number): void {
    const gen = this.generation;
    this.stats.enqueued += 1;
    this.chain(gen, async () => {
      const samples = pcm16ToFloat32(b64ToBytes(b64));
      if (samples.length === 0) return null;
      const buf = this.ctx.createBuffer(1, samples.length, sampleRate);
      buf.getChannelData(0).set(samples);
      return buf;
    });
  }

  /** Stops everything immediately and invalidates in-flight decodes. */
  stopAll(): void {
    this.generation += 1;
    const wasActive = this.sources.size > 0;
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    for (const src of this.sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // already ended
      }
      try {
        src.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.sources.clear();
    this.playhead = this.ctx.currentTime;
    if (wasActive) this.hooks.onIdle?.();
  }

  /** RMS of the current output buffer, 0..1. Callers write the result into a
   *  ref, never React state. */
  getLevel(): number {
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const c = (buf[i] - 128) / 128;
      sum += c * c;
    }
    return Math.sqrt(sum / buf.length);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    for (const src of this.sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // already ended
      }
    }
    this.sources.clear();
    try {
      await this.ctx.close();
    } catch {
      // context already closed
    }
  }

  private chain(gen: number, decode: () => Promise<AudioBuffer | null>): void {
    this.tail = this.tail
      .then(async () => {
        if (gen !== this.generation || this.closed) {
          this.stats.discarded += 1;
          return;
        }
        await this.resume();
        const buf = await decode();
        if (gen !== this.generation || this.closed || !buf) {
          this.stats.discarded += 1;
          return;
        }
        this.schedule(buf);
      })
      .catch(() => {
        this.stats.discarded += 1;
      });
  }

  private schedule(buf: AudioBuffer): void {
    const idleBefore = this.sources.size === 0;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (this.sources.size === 0) this.hooks.onIdle?.();
    };
    const startAt = Math.max(this.ctx.currentTime + 0.02, this.playhead);
    src.start(startAt);
    this.playhead = startAt + buf.duration;
    this.stats.scheduled += 1;
    if (idleBefore) {
      const gen = this.generation;
      const delay = Math.max(0, (startAt - this.ctx.currentTime) * 1000);
      this.startTimer = setTimeout(() => {
        this.startTimer = null;
        if (gen === this.generation) this.hooks.onStart?.();
      }, delay);
    }
  }
}
