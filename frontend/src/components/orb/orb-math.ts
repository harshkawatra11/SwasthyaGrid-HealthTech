import * as THREE from "three";
import type { OrbPhase } from "@/lib/audio/levels";

/** RMS below the floor is treated as silence; the span maps speech RMS to 0..1. */
export const ENV_FLOOR = 0.008;
export const ENV_SPAN = 0.112;

/** Envelope target for a raw analyser RMS. Idle never moves. */
export function envelopeTarget(raw: number, phase: OrbPhase): number {
  if (phase === "idle") return 0;
  return Math.max(0, Math.min(1, (raw - ENV_FLOOR) / ENV_SPAN));
}

/** One smoothing step: fast attack (70 ms), slow release (280 ms). */
export function stepEnvelope(current: number, target: number, delta: number): number {
  const tau = target > current ? 0.07 : 0.28;
  return current + (target - current) * (1 - Math.exp(-delta / tau));
}

/** Scale factors for the glass group and the inner volume at envelope `a`. */
export function orbScales(a: number, phase: OrbPhase, t: number): { group: number; volume: number } {
  return {
    group: 1 + (phase === "idle" ? 0.002 * Math.sin(t * 0.6) : 0) + 0.024 * a,
    volume: 0.78 * (1 + 0.035 * a),
  };
}

/** Frame-rate independent colour lerp factor with a 0.4 s time constant. */
export function colorLerpFactor(delta: number): number {
  return 1 - Math.exp(-delta / 0.4);
}

interface PhaseHex {
  top: string;
  bottom: string;
  brightness: number;
}

/** Inner volume colours by phase (plan 8.4). Hex is unavoidable here: WebGL
 *  uniforms cannot read CSS variables. The values are the --brand, --cyan,
 *  --violet and --info tokens. */
export const ORB_PHASE_HEX: Record<OrbPhase, PhaseHex> = {
  idle: { top: "#2dd4a7", bottom: "#4cc9e8", brightness: 0.6 },
  listening: { top: "#2dd4a7", bottom: "#4cc9e8", brightness: 1 },
  thinking: { top: "#9b87f5", bottom: "#4cc9e8", brightness: 1 },
  speaking: { top: "#9b87f5", bottom: "#5b8def", brightness: 1 },
};

/** The shader writes colours straight to the framebuffer with no colour
 *  management, so the sRGB numbers are stored as-is (Linear colour space
 *  means "do not convert"). */
export function shaderColor(hex: string, brightness = 1): THREE.Color {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Color().setRGB(
    (((n >> 16) & 255) / 255) * brightness,
    (((n >> 8) & 255) / 255) * brightness,
    ((n & 255) / 255) * brightness,
    THREE.LinearSRGBColorSpace,
  );
}

export function phaseColors(phase: OrbPhase): { top: THREE.Color; bottom: THREE.Color } {
  const p = ORB_PHASE_HEX[phase];
  return { top: shaderColor(p.top, p.brightness), bottom: shaderColor(p.bottom, p.brightness) };
}

/** CSS glow behind the canvas, by phase (plan 8.4 item 8). */
export const ORB_GLOW: Record<OrbPhase, string> = {
  idle: "rgb(45 212 167 / 0.08)",
  listening: "rgb(45 212 167 / 0.18)",
  thinking: "rgb(155 135 245 / 0.16)",
  speaking: "rgb(91 141 239 / 0.2)",
};

/** CSS-token colour pair for the fallback orb, by phase. */
export const ORB_CSS_COLORS: Record<OrbPhase, { top: string; bottom: string }> = {
  idle: { top: "var(--brand)", bottom: "var(--cyan)" },
  listening: { top: "var(--brand)", bottom: "var(--cyan)" },
  thinking: { top: "var(--violet)", bottom: "var(--cyan)" },
  speaking: { top: "var(--violet)", bottom: "var(--info)" },
};
