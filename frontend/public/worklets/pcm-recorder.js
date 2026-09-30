// Converts the microphone's Float32 frames to 16-bit PCM and posts
// them to the main thread in ~100ms chunks, matching the Live API's
// required input format (raw 16-bit PCM, little-endian, mono, 16kHz).
// Runs on the audio rendering thread; ScriptProcessorNode is not used
// here because it runs on the main thread and can glitch under load,
// which AudioWorkletProcessor avoids by design.

class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    // sampleRate is a global in the AudioWorkletGlobalScope, set by the
    // AudioContext this node was created on (must be 16000 for this to
    // produce 16kHz PCM without a separate resample step).
    this.chunkSamples = Math.round(sampleRate * 0.1);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channelData = input[0];
    if (!channelData) return true;

    for (let i = 0; i < channelData.length; i++) {
      this.buffer.push(channelData[i]);
    }

    while (this.buffer.length >= this.chunkSamples) {
      const chunk = this.buffer.splice(0, this.chunkSamples);
      const pcm16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-recorder", PcmRecorderProcessor);
