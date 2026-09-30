import type {
  DriverSummary,
  ShipmentSummary,
  VehicleSummary,
  WarehouseDetail,
  WarehouseSummary,
} from "@/lib/api/types";
import { fmtInt } from "@/lib/format";

/* ---------- fleet ---------- */

export type FleetKpis = {
  total: number;
  inUse: number;
  available: number;
  maintenance: number;
  serviceDue: number;
  avgUtilisation: number;
};

const IN_USE = new Set(["scheduled", "loading", "in_transit", "delayed", "returning"]);

export function fleetKpis(vehicles: readonly VehicleSummary[]): FleetKpis {
  const total = vehicles.length;
  const avg = total === 0 ? 0 : vehicles.reduce((a, v) => a + v.utilisation_7d, 0) / total;
  return {
    total,
    inUse: vehicles.filter((v) => IN_USE.has(v.live_status)).length,
    available: vehicles.filter((v) => v.live_status === "available").length,
    maintenance: vehicles.filter((v) => v.live_status === "maintenance").length,
    serviceDue: vehicles.filter((v) => v.service_due).length,
    avgUtilisation: avg * 100,
  };
}

export function fleetTitle(k: FleetKpis): string {
  if (k.total === 0) return "No vehicles in this scope";
  const parts = [`${k.available} of ${k.total} vehicles are ready to dispatch`];
  if (k.maintenance > 0) parts.push(`${k.maintenance} in maintenance`);
  if (k.serviceDue > 0) parts.push(`${k.serviceDue} past their service interval`);
  return parts.length === 1 ? parts[0] : `${parts[0]}, ${parts.slice(1).join(" and ")}`;
}

export type DepotUtilisation = { depotId: string; vehicles: number; inUse: number; utilisationPct: number };

/** Average 7 day utilisation per home depot, best first. */
export function depotUtilisation(vehicles: readonly VehicleSummary[]): DepotUtilisation[] {
  const by = new Map<string, VehicleSummary[]>();
  for (const v of vehicles) by.set(v.home_warehouse_id, [...(by.get(v.home_warehouse_id) ?? []), v]);
  return [...by.entries()]
    .map(([depotId, vs]) => ({
      depotId,
      vehicles: vs.length,
      inUse: vs.filter((v) => IN_USE.has(v.live_status)).length,
      utilisationPct: (vs.reduce((a, v) => a + v.utilisation_7d, 0) / vs.length) * 100,
    }))
    .sort((a, b) => b.utilisationPct - a.utilisationPct);
}

/** Km left before service (negative when overdue). */
export function kmToService(kmSince: number, interval = 15000): number {
  return interval - kmSince;
}

/* ---------- drivers ---------- */

export const DRIVER_HOURS_LIMIT = 9;

export function driversTitle(drivers: readonly DriverSummary[]): string {
  if (drivers.length === 0) return "No drivers in this scope";
  const onRoad = drivers.filter((d) => d.live_status === "driving").length;
  const near = drivers.filter((d) => d.hours_today >= DRIVER_HOURS_LIMIT - 1).length;
  const base = `${onRoad} of ${drivers.length} drivers are on the road`;
  return near > 0
    ? `${base}, ${near} within an hour of the ${DRIVER_HOURS_LIMIT} h limit`
    : `${base}, none near the ${DRIVER_HOURS_LIMIT} h limit`;
}

/** Days from `nowMs` to a date-only expiry (negative when expired). */
export function daysToExpiry(expiry: string, nowMs: number): number {
  return Math.ceil((new Date(`${expiry}T00:00:00Z`).getTime() - nowMs) / 86400_000);
}

/** Amber within 60 days, red when expired. */
export function licenceTone(days: number): "good" | "warning" | "critical" {
  if (days < 0) return "critical";
  return days <= 60 ? "warning" : "good";
}

/* ---------- planning ---------- */

export type QueueTotals = { count: number; weightKg: number; pallets: number; blocked: number; cold: number };

const PRIORITY_RANK = { critical: 0, high: 1, normal: 2 } as const;

/** Approved or recommended shipments with no vehicle yet, most urgent first. */
export function planningQueue(shipments: readonly ShipmentSummary[]): ShipmentSummary[] {
  return shipments
    .filter((s) => (s.status === "approved" || s.status === "recommended") && !s.vehicle)
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
}

export function queueTotals(queue: readonly ShipmentSummary[]): QueueTotals {
  return {
    count: queue.length,
    weightKg: queue.reduce((a, s) => a + s.weight_kg, 0),
    pallets: queue.reduce((a, s) => a + s.pallet_slots, 0),
    blocked: queue.filter((s) => !!s.blocked_reason).length,
    cold: queue.filter((s) => s.cold_chain).length,
  };
}

export function planningTitle(t: QueueTotals): string {
  if (t.count === 0) return "Nothing is waiting for a vehicle";
  const base = `${t.count} ${t.count === 1 ? "shipment is" : "shipments are"} waiting for a vehicle (${fmtInt(t.pallets)} pallets)`;
  return t.blocked > 0 ? `${base}, ${t.blocked} blocked` : `${base}, none blocked`;
}

/* ---------- warehouses ---------- */

export function warehousesTitle(ws: readonly WarehouseSummary[], nameOf: (id: string) => string = (i) => i): string {
  if (ws.length === 0) return "No warehouses in this scope";
  const outbound = ws.reduce((a, w) => a + w.outbound_today, 0);
  const low = ws.filter((w) => w.low_cover_medicines > 0);
  if (low.length === 0) return `${outbound} shipments left ${ws.length} warehouses today and no depot is short of cover`;
  const worst = [...low].sort((a, b) => b.low_cover_medicines - a.low_cover_medicines)[0];
  return `${low.length} of ${ws.length} warehouses have medicines under 7 days of cover, worst is ${nameOf(worst.id)}`;
}

export type StockRow = WarehouseDetail["stock"][number];

/** Days of cover meter tone: under 3 days critical, under 7 stress, else healthy, unknown monitor. */
export function coverTone(days: number | null): "critical" | "stress" | "healthy" | "monitor" {
  if (days === null || days === undefined) return "monitor";
  if (days < 3) return "critical";
  if (days < 7) return "stress";
  return "healthy";
}
