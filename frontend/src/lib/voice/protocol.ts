/** Wire protocol v2 for /ws/voice (plan 7.2). The client speaks only v2. */

export type VoiceLanguage = "auto" | "en-IN" | "hi-IN";
export type VoiceMode = "handsfree" | "ptt";

export type RiskLevel = "healthy" | "monitor" | "stress" | "critical";

export type FactCard =
  | {
      type: "district_summary";
      district_id: string;
      name: string;
      risk_counts: Partial<Record<RiskLevel, number>>;
      risk_index?: number | null;
      critical: { id: string; name: string }[];
    }
  | {
      type: "facility";
      facility_id: string;
      name: string;
      district_name?: string;
      risk: RiskLevel | string;
      medicines: { name: string; days: number | null; risk: RiskLevel | string }[];
      beds_next_week?: number | null;
    }
  | {
      type: "shortages";
      rows: { facility_id: string; facility: string; district: string; medicine: string; days: number | null }[];
    }
  | {
      type: "ranking";
      metric: string;
      unit: string;
      rows: { district_id: string; name: string; value: number }[];
    }
  | {
      type: "shipments";
      rows: { id: string; status: string; destination: string; eta?: string | number | null }[];
    }
  | {
      type: "shipment";
      id: string;
      status: string;
      eta?: string | number | null;
      progress?: number | null;
      driver?: string | null;
      vehicle?: string | null;
      temp_c?: number | null;
    }
  | {
      type: "fleet";
      counts: Record<string, number>;
      queued?: number | null;
    };

export interface TurnMetrics {
  finalToFirstTokenMs?: number | null;
  finalToFirstAudioMs?: number | null;
  totalMs?: number | null;
  tools?: string[];
}

export type ServerFrame =
  | { t: "ready"; sessionId?: string; sttMode: "ws" | "typed" | "rest"; ttsMode?: "ws" | "rest"; protocol?: number; speaker?: string }
  | { t: "vad"; state: "start" | "end" }
  | { t: "partial"; text: string }
  | { t: "final"; text: string; turnId: string; language?: string; clientTurnId?: string }
  | { t: "thinking"; turnId: string; stage: "planning" | "tools" | "answering"; label: string }
  | { t: "tool"; turnId: string; name: string; args?: Record<string, unknown>; label: string; ok: boolean }
  | { t: "reply_delta"; turnId: string; text: string }
  | { t: "reply"; turnId: string; text: string; toolCalls?: string[]; cards?: FactCard[]; language?: string }
  | {
      t: "audio";
      turnId: string;
      seq: number;
      b64: string;
      encoding?: "pcm_s16le" | "wav";
      sampleRateHz: number;
      filler?: boolean;
    }
  | { t: "interrupted"; turnId: string }
  | { t: "turn_end"; turnId: string; metrics?: TurnMetrics }
  | { t: "error"; message: string; fatal?: boolean; code?: string };

export type ClientFrame =
  | { t: "hello"; language: VoiceLanguage; scope: string | null; mode: VoiceMode; protocol: 2 }
  | { t: "audio"; b64: string }
  | { t: "text"; body: string; clientTurnId: string }
  | { t: "context"; scope: string | null; facilityId?: string | null }
  | { t: "ptt"; state: "down" | "up" }
  | { t: "interrupt" }
  | { t: "bye" };

export interface TraceItem {
  name: string;
  label: string;
  ok: boolean;
}

export interface TranscriptLine {
  id: string;
  speaker: "assistant" | "officer";
  text: string;
  partial: boolean;
  toolCalls: string[];
  cards: FactCard[];
  trace: TraceItem[];
  turnId: string | null;
  clientTurnId: string | null;
  /** True while the assistant answer is still streaming in. */
  streaming: boolean;
  interrupted: boolean;
}

/** The websocket URL. Never "localhost": a browser WebSocket does not fall back from ::1 to IPv4. */
export function defaultVoiceUrl(env: { voiceUrl?: string; apiBase?: string } = {}, loc?: { protocol: string; hostname: string }): string {
  if (env.voiceUrl) return env.voiceUrl;
  if (env.apiBase) {
    const base = env.apiBase.replace(/\/+$/, "").replace(/^http/, "ws").replace("//localhost", "//127.0.0.1");
    return `${base}/ws/voice`;
  }
  if (!loc) return "ws://127.0.0.1:8080/ws/voice";
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const host = loc.hostname === "localhost" ? "127.0.0.1" : loc.hostname;
  return `${proto}//${host}:8080/ws/voice`;
}
