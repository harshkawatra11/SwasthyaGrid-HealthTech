import { statusVar, type ShipmentStatus } from "@/lib/domain";

export type GanttScale = {
  startMs: number;
  endMs: number;
  width: number;
  /** Pixel x for a timestamp (not clamped). */
  x: (ms: number) => number;
  /** Timestamp for a pixel x. */
  invert: (px: number) => number;
  /** Fraction 0..1 of the window for a timestamp (clamped). */
  fraction: (ms: number) => number;
};

/** Linear time scale over the sim-day window, width in pixels. */
export function ganttScale(startIso: string, endIso: string, width: number): GanttScale {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const span = Math.max(1, endMs - startMs);
  return {
    startMs,
    endMs,
    width,
    x: (ms) => ((ms - startMs) / span) * width,
    invert: (px) => startMs + (px / width) * span,
    fraction: (ms) => Math.min(1, Math.max(0, (ms - startMs) / span)),
  };
}

export type GanttBar = { x: number; w: number };

/** Pixel rectangle of a segment, clipped to the window; null when it lies outside. Minimum width 2px. */
export function segmentBar(scale: GanttScale, startIso: string, endIso: string): GanttBar | null {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (b <= scale.startMs || a >= scale.endMs) return null;
  const x0 = scale.x(Math.max(a, scale.startMs));
  const x1 = scale.x(Math.min(b, scale.endMs));
  return { x: x0, w: Math.max(2, x1 - x0) };
}

const IST_OFFSET_MS = 5.5 * 3600_000;

export type GanttTick = { ms: number; label: string };

/** Whole IST hour ticks inside the window, labelled "05:00". */
export function hourTicks(startIso: string, endIso: string): GanttTick[] {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const firstLocal = Math.ceil((start + IST_OFFSET_MS) / 3600_000) * 3600_000;
  const out: GanttTick[] = [];
  for (let l = firstLocal; l - IST_OFFSET_MS <= end; l += 3600_000) {
    const ms = l - IST_OFFSET_MS;
    const h = new Date(l).getUTCHours();
    out.push({ ms, label: `${String(h).padStart(2, "0")}:00` });
  }
  return out;
}

export type SegmentKind = "load" | "drive" | "dwell" | "incident" | (string & {});

/** Colour token for a segment: load cyan, drive by trip status, dwell violet, incident orange. */
export function segmentColor(kind: SegmentKind, status: ShipmentStatus): string {
  if (kind === "load") return "var(--cyan)";
  if (kind === "dwell") return "var(--violet)";
  if (kind === "incident") return "var(--orange)";
  return statusVar(status);
}

export const SEGMENT_LABEL: Record<string, string> = {
  load: "Loading",
  drive: "Driving",
  dwell: "Unloading and dwell",
  incident: "Incident",
};

/** Sim-day window fallback: 05:00 to 23:00 IST of the day containing `simNowIso`. */
export function simDayWindow(simNowIso: string): { start: string; end: string } {
  const t = new Date(simNowIso).getTime() + IST_OFFSET_MS;
  const dayStartLocal = Math.floor(t / 86400_000) * 86400_000;
  const start = dayStartLocal + 5 * 3600_000 - IST_OFFSET_MS;
  const end = dayStartLocal + 23 * 3600_000 - IST_OFFSET_MS;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
