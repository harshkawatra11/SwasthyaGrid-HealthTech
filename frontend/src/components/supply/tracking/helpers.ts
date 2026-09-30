import type { Step, StepState } from "@/components/ds/Stepper";
import type { ShipmentStatus } from "@/lib/domain";
import { fmtClock, fmtDuration, fmtRelative } from "@/lib/format";
import type { ShipmentDetail, ShipmentEvent } from "@/lib/api/types";
import type { LatLng } from "@/lib/map/geo";

export const TEMP_BAND = { min: 2, max: 8 } as const;

export function tempInBand(t: number | null | undefined): boolean {
  return t !== null && t !== undefined && t >= TEMP_BAND.min && t <= TEMP_BAND.max;
}

const STEP_DEFS = [
  { key: "recommended", label: "Recommended", event: "created" },
  { key: "approved", label: "Approved", event: "approved" },
  { key: "loading", label: "Loading", event: "loading_started" },
  { key: "in_transit", label: "In transit", event: "departed" },
  { key: "arrived", label: "Arrived", event: "arrived" },
  { key: "delivered", label: "Delivered", event: "pod_confirmed" },
] as const;

/** Index of the current step for a live status (delayed is still in transit). */
export function currentStepIndex(status: ShipmentStatus): number {
  switch (status) {
    case "recommended":
      return 0;
    case "approved":
      return 1;
    case "loading":
      return 2;
    case "in_transit":
    case "delayed":
      return 3;
    case "arrived":
      return 4;
    case "delivered":
      return 5;
    default:
      return -1;
  }
}

/** Stepper state from the live status; timestamps come from the derived event log. */
export function stepperSteps(status: ShipmentStatus, events: readonly ShipmentEvent[]): Step[] {
  const at = (type: string) => events.find((e) => e.type === type)?.at ?? null;
  if (status === "cancelled") {
    const lastDone = STEP_DEFS.reduce((n, d, i) => (at(d.event) ? i : n), 0);
    return STEP_DEFS.map((d, i) => ({
      key: d.key,
      label: d.label,
      at: at(d.event),
      state: (i <= lastDone ? "done" : "skipped") as StepState,
    }));
  }
  const cur = currentStepIndex(status);
  return STEP_DEFS.map((d, i) => {
    let state: StepState = i < cur ? "done" : i === cur ? "current" : "upcoming";
    if (status === "delivered" && i === cur) state = "done";
    return { key: d.key, label: d.label, at: at(d.event), state };
  });
}

/** Big ETA line for the hero panel. */
export function etaHeadline(d: Pick<ShipmentDetail, "status" | "eta" | "planned_start" | "blocked_reason" | "destination" | "origin" | "pod">, simNow: string | null): string {
  switch (d.status) {
    case "delivered":
      return d.pod ? `Delivered ${fmtClock(d.pod.confirmed_at)}` : "Delivered";
    case "arrived":
      return `Awaiting confirmation at ${d.destination.name}`;
    case "cancelled":
      return "Cancelled";
    case "recommended":
      return "Awaiting approval";
    case "approved":
      return d.blocked_reason ?? (d.planned_start ? `Departs ${fmtClock(d.planned_start)}` : "Queued for a vehicle");
    case "loading":
      return `Loading at ${d.origin.name}`;
    default:
      if (!d.eta || !simNow) return "Arrival time pending";
      return `Arriving ${fmtRelative(d.eta, simNow)}`;
  }
}

export function etaSubline(d: Pick<ShipmentDetail, "status" | "eta" | "planned_arrival" | "delay_minutes">): string {
  if (d.status === "delivered" || d.status === "cancelled" || d.status === "recommended") return "";
  const parts: string[] = [];
  if (d.eta) parts.push(`ETA ${fmtClock(d.eta)} IST`);
  if (d.planned_arrival && d.status !== "arrived") parts.push(`planned ${fmtClock(d.planned_arrival)}`);
  if (d.delay_minutes > 0) parts.push(`${fmtDuration(d.delay_minutes)} behind plan`);
  return parts.join(", ");
}

export type DelayInfo = { minutes: number; reason: string };

/** Delay banner content: the open incident if there is one, otherwise a plain slip. */
export function delayInfo(d: Pick<ShipmentDetail, "status" | "delay_minutes" | "events">): DelayInfo | null {
  if (d.status === "delivered" || d.status === "cancelled" || d.status === "arrived") return null;
  if (d.status !== "delayed" && d.delay_minutes < 10) return null;
  const events = [...d.events].sort((a, b) => a.at.localeCompare(b.at));
  const started = [...events].reverse().find((e) => e.type === "incident_started");
  const cleared = [...events].reverse().find((e) => e.type === "incident_cleared");
  const open = started && (!cleared || cleared.at < started.at);
  const reason = started ? started.detail || started.title : "Running behind the promised time";
  return { minutes: d.delay_minutes, reason: open || d.status === "delayed" ? reason : `Earlier: ${reason}` };
}

/** Index of the path point nearest to the truck, searching the whole (downsampled) path. */
export function nearestPathIndex(path: ReadonlyArray<readonly [number, number]>, p: { lat: number; lng: number } | null): number {
  if (!p || path.length === 0) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const dy = path[i][0] - p.lat;
    const dx = (path[i][1] - p.lng) * Math.cos((p.lat * Math.PI) / 180);
    const dd = dx * dx + dy * dy;
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  }
  return best;
}

export function toPath(path: ReadonlyArray<readonly [number, number]>): LatLng[] {
  return path.map((p) => [p[0], p[1]] as LatLng);
}

export function starText(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(full) + "☆".repeat(5 - full);
}

export function canCancel(status: ShipmentStatus, canApprove: boolean): boolean {
  return canApprove && status !== "arrived" && status !== "delivered" && status !== "cancelled";
}

export type CargoRow = { name: string; units: number; cartons: number; weight: number; cold: boolean };

export function cargoRows(d: Pick<ShipmentDetail, "lines">): CargoRow[] {
  return d.lines.map((l) => ({ name: l.medicine_name, units: l.units, cartons: l.cartons, weight: l.weight_kg, cold: l.cold_chain }));
}
