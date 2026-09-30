import type { VoiceState } from "@/lib/voice/client";

export const SUGGESTED_PROMPTS: { lang: "en" | "hi"; text: string }[] = [
  { lang: "en", text: "Give me the state situation in 30 seconds" },
  { lang: "en", text: "Which district needs attention first?" },
  { lang: "en", text: "When will ARV reach PHC Kota-4?" },
  { lang: "hi", text: "कोटा में अभी क्या हाल है?" },
  { lang: "hi", text: "बीकानेर में कौन सी दवाइयाँ खत्म होने वाली हैं?" },
  { lang: "hi", text: "ORS और Paracetamol का stock कहाँ कम है?" },
];

export const FOOTER_NOTE =
  "Answers about districts come only from live SwasthyaGrid data. General explanations are marked as general guidance.";

/** The one line under the orb. Reflects what the user actually hears and says. */
export function statusLine(s: Pick<VoiceState, "status" | "phase" | "thinkingLabel" | "muted" | "mode" | "errorMessage">): string {
  if (s.status === "connecting") return "Connecting";
  if (s.status === "failed") return s.errorMessage ?? "Could not connect to the voice service";
  if (s.status !== "connected") return "Press the microphone to start";
  if (s.phase === "thinking") return s.thinkingLabel ?? "Thinking";
  if (s.phase === "speaking") return "Speaking";
  if (s.muted) return "Muted";
  if (s.mode === "ptt") return "Hold the microphone or Space to talk";
  return "Listening";
}

export function connectionLabel(status: VoiceState["status"]): string {
  return status === "connected" ? "Live" : status === "connecting" ? "Connecting" : status === "failed" ? "Failed" : "Not connected";
}

export function micLabel(s: Pick<VoiceState, "status" | "muted" | "mode">): string {
  if (s.status === "idle") return "Start voice session";
  if (s.status === "failed") return "Retry voice session";
  if (s.status === "connecting") return "Connecting";
  if (s.mode === "ptt") return "Hold to talk";
  return s.muted ? "Microphone muted, click to unmute" : "Microphone on, click to mute";
}
