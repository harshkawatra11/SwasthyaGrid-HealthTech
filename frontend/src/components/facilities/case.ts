import type { Step } from "@/components/ds/Stepper";
import type { MedicineForecast, PerformanceRow, ShipmentSummary } from "@/lib/api/types";
import type { ShipmentStatus } from "@/lib/domain";

export const PERF_DIMS: Array<{ key: keyof PerformanceRow; label: string }> = [
  { key: "inventory", label: "Inventory" },
  { key: "attendance", label: "Attendance" },
  { key: "diagnostics", label: "Diagnostics" },
  { key: "patient_wait", label: "Patient wait" },
  { key: "forecast_accuracy", label: "Forecast accuracy" },
];

const FLOW: Array<{ key: string; label: string; statuses: ShipmentStatus[] }> = [
  { key: "approved", label: "Approved", statuses: ["approved"] },
  { key: "loading", label: "Loading", statuses: ["loading"] },
  { key: "transit", label: "In transit", statuses: ["in_transit", "delayed"] },
  { key: "arrived", label: "Arrived", statuses: ["arrived"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
];

/** Stepper state derived from a shipment status. */
export function stepsFor(status: ShipmentStatus): Step[] {
  const cur = FLOW.findIndex((f) => f.statuses.includes(status));
  return FLOW.map((f, i) => ({
    key: f.key,
    label: f.label,
    state: cur === -1 ? "upcoming" : status === "delivered" || i < cur ? "done" : i === cur ? "current" : "upcoming",
  }));
}

export function isActive(s: ShipmentSummary): boolean {
  return ["approved", "loading", "in_transit", "delayed", "arrived"].includes(s.status);
}

export function lowestCover(meds: MedicineForecast[]): MedicineForecast | null {
  return meds.length ? [...meds].sort((a, b) => a.days_remaining - b.days_remaining)[0] : null;
}

export function shortMed(name: string): string {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : name;
}

export function caseTitle(name: string, meds: MedicineForecast[], inbound: ShipmentSummary[]): string {
  const low = lowestCover(meds);
  if (!low) return `${name} has no medicine below the watch threshold`;
  const active = inbound.filter(isActive);
  const tail = active.length > 0 ? `, ${active.length} shipment${active.length === 1 ? " is" : "s are"} inbound` : ", nothing is inbound";
  return `${name} has ${low.days_remaining} days of ${shortMed(low.medicine_name)}${tail}`;
}

/** Weakest performance dimension against the district mean. */
export function weakestDimension(p: PerformanceRow, district: PerformanceRow[]): { label: string; value: number; gap: number } | null {
  let best: { label: string; value: number; gap: number } | null = null;
  for (const d of PERF_DIMS) {
    const v = p[d.key] as number;
    const peers = district.filter((x) => x.facility_id !== p.facility_id).map((x) => x[d.key] as number);
    const avg = peers.length ? peers.reduce((a, b) => a + b, 0) / peers.length : v;
    const gap = v - avg;
    if (!best || gap < best.gap) best = { label: d.label, value: v, gap };
  }
  return best;
}

export function districtMean(rows: PerformanceRow[], excludeId: string): Record<string, number> {
  const out: Record<string, number> = {};
  const peers = rows.filter((r) => r.facility_id !== excludeId);
  for (const d of PERF_DIMS) {
    out[d.key] = peers.length ? Math.round(peers.reduce((a, r) => a + (r[d.key] as number), 0) / peers.length) : 0;
  }
  return out;
}
