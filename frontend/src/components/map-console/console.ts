import type { DistrictSummaryRow, ShipmentSummary } from "@/lib/api/types";

export type LayerKey = "choropleth" | "facilities" | "warehouses" | "trucks" | "routes" | "delayedOnly";

export type Selection = { kind: "district" | "facility" | "shipment"; id: string };

export type LayerDef = { key: LayerKey; label: string; defaultOn: boolean };

/** Layer toggles for the GIS console, in panel order. `delayedOnly` filters the truck and route layers. */
export const LAYERS: LayerDef[] = [
  { key: "choropleth", label: "Risk choropleth", defaultOn: true },
  { key: "facilities", label: "Facilities", defaultOn: true },
  { key: "warehouses", label: "Warehouses", defaultOn: true },
  { key: "trucks", label: "Live trucks", defaultOn: true },
  { key: "routes", label: "Active routes", defaultOn: false },
  { key: "delayedOnly", label: "Delayed only", defaultOn: false },
];

export function defaultLayerState(): Record<LayerKey, boolean> {
  return Object.fromEntries(LAYERS.map((l) => [l.key, l.defaultOn])) as Record<LayerKey, boolean>;
}

/** District with the highest risk index (worst first), or null for an empty list. */
export function worstDistrict(rows: readonly DistrictSummaryRow[]): DistrictSummaryRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => b.risk_index - a.risk_index)[0];
}

/** 1-based rank of a district by risk index, worst is 1. */
export function districtRank(rows: readonly DistrictSummaryRow[], districtId: string): number {
  const sorted = [...rows].sort((a, b) => b.risk_index - a.risk_index);
  return sorted.findIndex((r) => r.district_id === districtId) + 1;
}

/** Action-title finding for a district drawer, computed from live state summary rows. */
export function districtActionTitle(row: DistrictSummaryRow, rows: readonly DistrictSummaryRow[]): string {
  const rank = districtRank(rows, row.district_id);
  const of = rows.length;
  const critical = row.risk_counts.critical;
  if (critical > 0) {
    return `${row.name} ranks ${rank} of ${of} on risk index, with ${critical} facilit${critical === 1 ? "y" : "ies"} critical`;
  }
  return `${row.name} ranks ${rank} of ${of} on risk index, no facility is critical`;
}

/** One line summarising the live truck network from the logistics KPI snapshot. */
export function networkHeadline(inTransit: number, delayed: number): string {
  if (inTransit === 0 && delayed === 0) return "No trucks are moving right now";
  if (delayed === 0) return `${inTransit} truck${inTransit === 1 ? "" : "s"} in transit, none delayed`;
  return `${inTransit} truck${inTransit === 1 ? "" : "s"} in transit, ${delayed} delayed`;
}

/** Action-title finding for a shipment drawer. */
export function shipmentActionTitle(s: ShipmentSummary): string {
  if (s.delay_minutes > 0) return `${s.id} to ${s.destination.name} is running ${s.delay_minutes} min late`;
  if (s.status === "delivered") return `${s.id} delivered to ${s.destination.name}`;
  return `${s.id} is ${s.status.replace(/_/g, " ")}, heading to ${s.destination.name}`;
}

/** Bounded set of shipment ids eligible for a drawn route (in transit or delayed, most delayed first). */
export function routeCandidates(items: readonly ShipmentSummary[], delayedOnly: boolean, limit = 8): string[] {
  return items
    .filter((s) => (delayedOnly ? s.status === "delayed" : s.status === "in_transit" || s.status === "delayed"))
    .sort((a, b) => b.delay_minutes - a.delay_minutes)
    .slice(0, limit)
    .map((s) => s.id);
}
