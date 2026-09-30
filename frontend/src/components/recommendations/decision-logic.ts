/**
 * Pure logic for the Recommendations decision desk: board columns, funnel, what-if, sensitivity
 * matrix, options considered and action titles. Unit tested in decision-logic.test.ts.
 */
import type { Facility, MedicineForecast, RecommendationV2, WarehouseSummary } from "@/lib/api/types";

export type ColumnId = "pending" | "moving" | "completed" | "closed";

export const COLUMNS: Array<{ id: ColumnId; label: string; hint: string }> = [
  { id: "pending", label: "Pending", hint: "Waiting for a decision" },
  { id: "moving", label: "Approved and moving", hint: "Approved, shipment planned or on the road" },
  { id: "completed", label: "Completed", hint: "Delivered and confirmed" },
  { id: "closed", label: "Rejected and expired", hint: "Rejected, expired or cancelled" },
];

export function columnOf(status: RecommendationV2["status"]): ColumnId {
  switch (status) {
    case "pending":
      return "pending";
    case "approved":
    case "modified":
    case "dispatched":
      return "moving";
    case "fulfilled":
      return "completed";
    default:
      return "closed";
  }
}

export function byColumn(recs: RecommendationV2[]): Record<ColumnId, RecommendationV2[]> {
  const out: Record<ColumnId, RecommendationV2[]> = { pending: [], moving: [], completed: [], closed: [] };
  const rank = { critical: 0, high: 1, normal: 2 } as const;
  for (const r of recs) out[columnOf(r.status)].push(r);
  out.pending.sort((a, b) => rank[a.priority] - rank[b.priority] || b.confidence - a.confidence || a.id.localeCompare(b.id));
  const byRecent = (a: RecommendationV2, b: RecommendationV2) =>
    new Date(b.resolved_at ?? b.created_at).getTime() - new Date(a.resolved_at ?? a.created_at).getTime();
  out.moving.sort(byRecent);
  out.completed.sort(byRecent);
  out.closed.sort(byRecent);
  return out;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---------- funnel ---------- */

export type FunnelStages = { generated: number; approved: number; dispatched: number; fulfilled: number };

export function funnel(recs: RecommendationV2[]): FunnelStages {
  const approvedSet = new Set<RecommendationV2["status"]>(["approved", "modified", "dispatched", "fulfilled"]);
  return {
    generated: recs.length,
    approved: recs.filter((r) => approvedSet.has(r.status)).length,
    dispatched: recs.filter((r) => r.status === "dispatched" || r.status === "fulfilled").length,
    fulfilled: recs.filter((r) => r.status === "fulfilled").length,
  };
}

export function funnelTitle(f: FunnelStages): string {
  if (f.generated === 0) return "No recommendation has been generated yet";
  const pct = Math.round((f.approved / f.generated) * 100);
  return `${pct}% of ${f.generated} recommendations were approved, ${f.fulfilled} reached a facility`;
}

/* ---------- approvals by district ---------- */

export type DistrictApprovalRow = {
  districtId: string;
  pending: number;
  moving: number;
  completed: number;
  closed: number;
  approvalRate: number | null;
};

export function approvalsByDistrict(recs: RecommendationV2[], districtIds: string[]): DistrictApprovalRow[] {
  return districtIds.map((id) => {
    const mine = recs.filter((r) => r.district_id === id);
    const col = byColumn(mine);
    const rejected = mine.filter((r) => r.status === "rejected").length;
    const approved = col.moving.length + col.completed.length;
    return {
      districtId: id,
      pending: col.pending.length,
      moving: col.moving.length,
      completed: col.completed.length,
      closed: col.closed.length,
      approvalRate: approved + rejected > 0 ? approved / (approved + rejected) : null,
    };
  });
}

export function approvalsTitle(rows: DistrictApprovalRow[], name: (id: string) => string): string {
  if (rows.length === 0) return "No district data";
  const worst = [...rows].sort((a, b) => b.pending - a.pending)[0];
  const total = rows.reduce((s, r) => s + r.pending, 0);
  if (total === 0) return "No district has decisions waiting";
  return `${name(worst.districtId)} holds ${worst.pending} of ${total} pending decisions`;
}

/* ---------- what-if: approve all critical ---------- */

export type WhatIf = {
  criticalNow: number;
  criticalAfter: number;
  stockoutsNow: number;
  stockoutsAfter: number;
  approved: number;
};

const STOCK_TYPES = new Set<RecommendationV2["type"]>(["replenishment", "stock_transfer"]);

/** Lines of stock under 3 days of cover, keyed facility|medicine. */
export function stockoutLines(medicines: MedicineForecast[]): Set<string> {
  return new Set(medicines.filter((m) => m.days_remaining < 3).map((m) => `${m.facility_id}|${m.medicine_name}`));
}

/**
 * Projected effect of approving every pending critical stock recommendation (always computed; the UI toggle chooses whether to show it). A facility that is
 * critical now leaves the critical set when every one of its stock-out lines is covered.
 */
export function whatIf(
  facilities: Facility[],
  medicines: MedicineForecast[],
  pending: RecommendationV2[],
): WhatIf {
  const lines = stockoutLines(medicines);
  const covered = new Set<string>();
  let approved = 0;
  for (const r of pending) {
    if (r.status !== "pending" || r.priority !== "critical" || !STOCK_TYPES.has(r.type)) continue;
    approved += 1;
    if (r.medicine_name) covered.add(`${r.target_facility_id}|${r.medicine_name}`);
  }
  const criticalIds = facilities.filter((f) => f.risk_level === "critical").map((f) => f.id);
  const rescued = criticalIds.filter((id) => {
    const mine = [...lines].filter((l) => l.startsWith(`${id}|`));
    return mine.length > 0 && mine.every((l) => covered.has(l));
  });
  return {
    criticalNow: criticalIds.length,
    criticalAfter: criticalIds.length - rescued.length,
    stockoutsNow: lines.size,
    stockoutsAfter: [...lines].filter((l) => !covered.has(l)).length,
    approved,
  };
}

export function whatIfTitle(w: WhatIf): string {
  if (w.approved === 0) return `${w.criticalNow} facilities are critical and no critical stock recommendation is pending`;
  return `Approving ${plural(w.approved, "critical recommendation")} takes critical facilities from ${w.criticalNow} to ${w.criticalAfter}`;
}

/* ---------- 5 x 5 sensitivity ---------- */

export const SHARES = [0, 25, 50, 75, 100] as const;
export const DELAYS = [0, 30, 60, 120, 240] as const;
/** A delivery counts as a save only if it lands while this share of the remaining cover is untouched. */
export const SAVE_WINDOW = 0.1;

/**
 * Projected critical facilities at day 3 when `share` percent of the pending stock recommendations
 * (critical first) are approved and every truck arrives `delayMin` late. Model assumption: a
 * facility is saved only when the truck lands within SAVE_WINDOW of its remaining cover.
 */
export function projectedCritical(
  facilities: Facility[],
  medicines: MedicineForecast[],
  pending: RecommendationV2[],
  share: number,
  delayMin: number,
): number {
  const rank = { critical: 0, high: 1, normal: 2 } as const;
  const stock = pending
    .filter((r) => r.status === "pending" && STOCK_TYPES.has(r.type) && r.medicine_name)
    .sort((a, b) => rank[a.priority] - rank[b.priority] || b.confidence - a.confidence || a.id.localeCompare(b.id));
  const take = Math.round((share / 100) * stock.length);
  const days = new Map(medicines.map((m) => [`${m.facility_id}|${m.medicine_name}`, m.days_remaining]));
  const saved = new Set<string>();
  for (const r of stock.slice(0, take)) {
    const cover = days.get(`${r.target_facility_id}|${r.medicine_name}`);
    if (cover === undefined) continue;
    const arrival = (r.eta_minutes ?? 0) + delayMin;
    if (arrival <= cover * 1440 * SAVE_WINDOW) saved.add(`${r.target_facility_id}|${r.medicine_name}`);
  }
  const lines = stockoutLines(medicines);
  const critical = facilities.filter((f) => f.risk_level === "critical");
  const rescued = critical.filter((f) => {
    const mine = [...lines].filter((l) => l.startsWith(`${f.id}|`));
    return mine.length > 0 && mine.every((l) => saved.has(l));
  });
  return critical.length - rescued.length;
}

export function sensitivityGrid(
  facilities: Facility[],
  medicines: MedicineForecast[],
  pending: RecommendationV2[],
): number[][] {
  return SHARES.map((s) => DELAYS.map((d) => projectedCritical(facilities, medicines, pending, s, d)));
}

export function sensitivityTitle(grid: number[][]): string {
  const best = grid[grid.length - 1][0];
  const base = grid[0][0];
  const worstApproved = grid[grid.length - 1][grid[0].length - 1];
  if (base === best) return `Approvals alone do not change the ${base} critical facilities in this model`;
  return `Approving everything on time cuts critical facilities from ${base} to ${best}; a 4 hour delay leaves ${worstApproved}`;
}

/* ---------- options considered ---------- */

export type OptionKind = "district" | "central" | "lateral";

export type ConsideredOption = {
  kind: OptionKind;
  label: string;
  sourceId: string | null;
  sourceName: string | null;
  km: number | null;
  etaMin: number | null;
  /** Units the facility uses while it waits. */
  unitsUsedWhileWaiting: number | null;
  criteria: { inRange: boolean | null; stock: boolean | null; coldChain: boolean | null; etaOk: boolean | null };
  chosen: boolean;
};

const R = 6371;

export function roadKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.3 * 10) / 10;
}

export function etaMinutes(km: number): number {
  return Math.round(30 + (km / 40) * 60);
}

export function optionsFor(
  rec: RecommendationV2,
  facilities: Facility[],
  warehouses: WarehouseSummary[],
  medicines: MedicineForecast[],
): ConsideredOption[] {
  if (rec.type !== "replenishment" && rec.type !== "stock_transfer") return [];
  const target = facilities.find((f) => f.id === rec.target_facility_id);
  const row = medicines.find((m) => m.facility_id === rec.target_facility_id && m.medicine_name === rec.medicine_name);
  if (!target) return [];
  const daily = row && row.days_remaining > 0 ? row.units_remaining / row.days_remaining : null;
  const etaLimit = rec.priority === "critical" ? 90 : 240;
  const cold = row?.cold_chain ?? false;

  function build(kind: OptionKind, label: string, src: { id: string; name: string; lat: number; lng: number } | null, warehouse: WarehouseSummary | null, stock: boolean | null, rangeKm: number): ConsideredOption {
    if (!src) {
      return { kind, label, sourceId: null, sourceName: null, km: null, etaMin: null, unitsUsedWhileWaiting: null, criteria: { inRange: null, stock, coldChain: null, etaOk: null }, chosen: false };
    }
    const km = roadKm(target as Facility, src);
    const eta = etaMinutes(km);
    return {
      kind,
      label,
      sourceId: src.id,
      sourceName: src.name,
      km,
      etaMin: eta,
      unitsUsedWhileWaiting: daily === null ? null : Math.round((eta / 1440) * daily),
      criteria: {
        inRange: km <= rangeKm,
        stock: src.id === rec.source_id ? true : stock,
        coldChain: cold ? (warehouse ? warehouse.cold_room : false) : true,
        etaOk: eta <= etaLimit,
      },
      chosen: src.id === rec.source_id,
    };
  }

  const ddw = warehouses.find((w) => w.type !== "central" && w.district_id === rec.district_id) ?? null;
  const central = warehouses.find((w) => w.type === "central") ?? null;
  const peers = facilities
    .filter((f) => f.district_id === rec.district_id && f.id !== rec.target_facility_id)
    .map((f) => ({ f, km: roadKm(target, f), m: medicines.find((m) => m.facility_id === f.id && m.medicine_name === rec.medicine_name) }))
    .filter((p) => p.m && p.m.days_remaining > 14)
    .sort((a, b) => a.km - b.km)[0];

  return [
    build("district", "District warehouse replenishment", ddw, ddw, null, 150),
    build("central", "Central warehouse replenishment", central, central, null, 150),
    build("lateral", "Lateral transfer from a peer", peers ? { id: peers.f.id, name: peers.f.name, lat: peers.f.lat, lng: peers.f.lng } : null, null, peers ? true : false, 40),
  ];
}

export function chosenReason(opts: ConsideredOption[]): string {
  const chosen = opts.find((o) => o.chosen);
  if (!chosen) return "The engine picked a source outside these three options.";
  const others = opts.filter((o) => !o.chosen && o.etaMin !== null);
  const slower = others.filter((o) => (o.etaMin ?? 0) > (chosen.etaMin ?? 0)).length;
  return slower === others.length && others.length > 0 ? "Fastest of the options with stock." : "Best fit on range, stock and cold chain.";
}

/* ---------- page titles ---------- */

export function boardTitle(cols: Record<ColumnId, RecommendationV2[]>): string {
  const crit = cols.pending.filter((r) => r.priority === "critical").length;
  return `${plural(cols.pending.length, "decision")} waiting, ${crit} critical; ${cols.moving.length} already moving`;
}
