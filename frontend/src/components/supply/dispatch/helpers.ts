import type { ShipmentStatus } from "@/lib/domain";
import { fmtDuration, fmtPct } from "@/lib/format";
import type { LogisticsKpis, ShipmentSummary, VolumeSeries } from "@/lib/api/types";

export const PROVENANCE =
  "Simulated operational data. Routes: OpenStreetMap contributors via OSRM. Boundaries: geoBoundaries (ODbL).";

/* ---------- volume and transit time ---------- */

export type Period = "week" | "month" | "quarter";
export const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, quarter: 90 };
export const PERIOD_LABEL: Record<Period, string> = { week: "Week", month: "Month", quarter: "Quarter" };

export type VolumePoint = { date: string; label: string; shipments: number; hours: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-05" to "05.09.2026" (the reference tooltip date style). */
export function fmtDotDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}

/** "2026-09-05" to "5 Sep". */
export function fmtShortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** Last N days of the volume series, ready for the chart. */
export function volumePoints(series: VolumeSeries | undefined, period: Period): VolumePoint[] {
  const pts = series?.points ?? [];
  return pts.slice(-PERIOD_DAYS[period]).map((p) => ({
    date: p.date,
    label: fmtShortDate(p.date),
    shipments: p.shipments,
    hours: p.avg_transit_hours,
  }));
}

export type VolumeFinding = { title: string; peak: VolumePoint | null; changePct: number | null };

/** Action title: compare the second half of the window with the first half. */
export function volumeFinding(points: VolumePoint[]): VolumeFinding {
  if (points.length < 4) return { title: "Waiting for shipment history", peak: null, changePct: null };
  const mid = Math.floor(points.length / 2);
  const sum = (xs: VolumePoint[], k: "shipments" | "hours") => xs.reduce((a, p) => a + p[k], 0);
  const first = points.slice(0, mid);
  const second = points.slice(mid);
  const v1 = sum(first, "shipments") / first.length;
  const v2 = sum(second, "shipments") / second.length;
  const t2 = sum(second, "hours") / second.length;
  const changePct = v1 > 0 ? Math.round(((v2 - v1) / v1) * 100) : null;
  const peak = points.reduce((a, p) => (p.shipments > a.shipments ? p : a), points[0]);
  const trend =
    changePct === null || Math.abs(changePct) < 3
      ? "Volume is flat"
      : changePct > 0
        ? `Volume is up ${changePct}%`
        : `Volume is down ${Math.abs(changePct)}%`;
  return { title: `${trend}, average transit ${fmtDuration(t2 * 60)}`, peak, changePct };
}

/* ---------- status overview ---------- */

export const STATUS_ORDER: ShipmentStatus[] = [
  "delivered",
  "arrived",
  "in_transit",
  "loading",
  "approved",
  "delayed",
  "recommended",
  "cancelled",
];

export type StatusSegment = { status: ShipmentStatus; count: number; pct: number };

export function statusSegments(counts: Partial<Record<ShipmentStatus, number>> | undefined): StatusSegment[] {
  const c = counts ?? {};
  const total = STATUS_ORDER.reduce((a, s) => a + (c[s] ?? 0), 0);
  if (total === 0) return [];
  return STATUS_ORDER.filter((s) => (c[s] ?? 0) > 0).map((s) => ({
    status: s,
    count: c[s] ?? 0,
    pct: ((c[s] ?? 0) / total) * 100,
  }));
}

export function statusTitle(counts: Partial<Record<ShipmentStatus, number>> | undefined): string {
  const c = counts ?? {};
  const moving = (c.in_transit ?? 0) + (c.delayed ?? 0) + (c.loading ?? 0);
  const total = STATUS_ORDER.reduce((a, s) => a + (c[s] ?? 0), 0);
  if (total === 0) return "No shipments recorded today";
  const waiting = c.arrived ?? 0;
  return `${moving} of ${total} shipments are moving, ${waiting} await receipt`;
}

/* ---------- headline ---------- */

export function dispatchTitle(k: LogisticsKpis | undefined): string {
  if (!k || k.in_transit_now === undefined) return "Live dispatch monitor";
  const delayed = k.delayed_now ?? 0;
  const rate = k.on_time_rate_today;
  const base = `${k.in_transit_now} ${k.in_transit_now === 1 ? "truck" : "trucks"} moving`;
  const tail = delayed > 0 ? `${delayed} delayed` : "none delayed";
  return rate === null || rate === undefined ? `${base}, ${tail}` : `${base}, ${tail}, ${fmtPct(rate * 100)} on time today`;
}

export function fmtRate(r: number | null | undefined): string {
  return r === null || r === undefined ? "n/a" : fmtPct(r * 100);
}

/* ---------- orders ---------- */

const ACTIVE_RANK: Record<ShipmentStatus, number> = {
  delayed: 0,
  in_transit: 1,
  loading: 2,
  approved: 3,
  arrived: 4,
  recommended: 5,
  delivered: 6,
  cancelled: 7,
};

export type OrderPeriod = "today" | "week" | "all";
export const ORDER_PERIOD_LABEL: Record<OrderPeriod, string> = { today: "Today", week: "7 days", all: "All" };

/** Active shipments first (worst first), then by newest creation. Drafts (recommended) are not orders. */
export function sortOrders(items: ShipmentSummary[]): ShipmentSummary[] {
  return [...items].sort((a, b) => {
    const r = ACTIVE_RANK[a.status] - ACTIVE_RANK[b.status];
    if (r !== 0) return r;
    return b.created_at.localeCompare(a.created_at);
  });
}

export function filterOrders(items: ShipmentSummary[], period: OrderPeriod, simNow: string | null | undefined): ShipmentSummary[] {
  const real = items.filter((s) => s.status !== "recommended");
  if (period === "all" || !simNow) return real;
  const now = new Date(simNow).getTime();
  const window = period === "today" ? 24 * 3600e3 : 7 * 24 * 3600e3;
  return real.filter((s) => now - new Date(s.created_at).getTime() <= window);
}

export function matchesQuery(s: Pick<ShipmentSummary, "id" | "destination" | "origin">, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [s.id, s.destination.name, s.origin.name].some((t) => t.toLowerCase().includes(needle));
}

/* ---------- map chips ---------- */

export type ChipSpec = {
  shipmentId: string;
  status: ShipmentStatus;
  lat: number;
  lng: number;
  /** Extra vertical stagger in px so chips sharing a location do not sit on top of each other. */
  stack: number;
  destination: string;
};

type Point = { lat: number; lng: number };

/**
 * Chips for shipments that are not currently driving (driving ones come from the live positions store):
 * loading and approved wait at the origin, arrived and delivered sit at the destination, cancelled at the origin.
 */
export function anchoredChips(
  shipments: readonly ShipmentSummary[],
  nodes: ReadonlyMap<string, Point>,
  liveIds: ReadonlySet<string>,
  limit = 22,
): ChipSpec[] {
  const out: ChipSpec[] = [];
  const buckets = new Map<string, number>();
  const sorted = [...shipments].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const s of sorted) {
    if (out.length >= limit) break;
    if (s.status === "recommended" || liveIds.has(s.id)) continue;
    if (s.status === "in_transit" || s.status === "delayed") continue;
    const nodeId = s.status === "arrived" || s.status === "delivered" ? s.destination.id : s.origin.id;
    const p = nodes.get(nodeId);
    if (!p) continue;
    const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
    const n = buckets.get(key) ?? 0;
    buckets.set(key, n + 1);
    out.push({ shipmentId: s.id, status: s.status, lat: p.lat, lng: p.lng, stack: n * 20, destination: s.destination.name });
  }
  return out;
}
