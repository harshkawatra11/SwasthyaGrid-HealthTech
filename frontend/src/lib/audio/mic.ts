import { orbAudio } from "./levels";

/** Taps the microphone source with an analyser for the orb. The analyser is
 *  deliberately never connected to a destination: the officer's own voice must
 *  not be routed to the speakers. */
export function attachMicAnalyser(
  ctx: Pick<AudioContext, "createAnalyser">,
  source: Pick<MediaStreamAudioSourceNode, "connect">,
): AnalyserNode {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  orbAudio.micAnalyser = analyser;
  return analyser;
}

/** Clears both analysers on teardown so the orb stops reading a closed context. */
export function detachOrbAnalysers(): void {
  orbAudio.micAnalyser = null;
  orbAudio.ttsAnalyser = null;
  orbAudio.phase = "idle";
}
