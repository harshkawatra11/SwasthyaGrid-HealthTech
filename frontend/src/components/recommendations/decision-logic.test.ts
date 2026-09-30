import { describe, expect, it } from "vitest";
import type { Facility, MedicineForecast, RecommendationV2, WarehouseSummary } from "@/lib/api/types";
import {
  approvalsByDistrict,
  approvalsTitle,
  byColumn,
  chosenReason,
  columnOf,
  funnel,
  funnelTitle,
  optionsFor,
  projectedCritical,
  roadKm,
  sensitivityGrid,
  sensitivityTitle,
  whatIf,
  whatIfTitle,
} from "./decision-logic";
import { defaultQuantity, quantityOverride } from "./decision-actions";

function rec(over: Partial<RecommendationV2>): RecommendationV2 {
  return {
    id: "rec_1",
    type: "replenishment",
    district_id: "district_kota",
    source_kind: "warehouse",
    source_id: "ddw_kota",
    source_facility_id: "ddw_kota",
    target_facility_id: "f1",
    subject: "ARV",
    medicine_name: "ARV",
    quantity: 100,
    unit: "vial",
    quantity_or_detail: "100 vials",
    priority: "critical",
    confidence: 80,
    reasons: [],
    status: "pending",
    created_at: "2026-09-26T03:00:00Z",
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    shipment_id: null,
    distance_km: 20,
    eta_minutes: 60,
    episode: 1,
    ...over,
  };
}

const fac = (id: string, risk: Facility["risk_level"], lat = 25.2, lng = 75.8): Facility => ({
  id,
  name: id,
  type: "PHC",
  lat,
  lng,
  beds_total: 20,
  district_id: "district_kota",
  risk_level: risk,
});
const med = (facility_id: string, medicine_name: string, days: number, units = days * 10): MedicineForecast => ({
  facility_id,
  medicine_name,
  units_remaining: units,
  days_remaining: days,
  risk: "high",
  confidence: 90,
  factors: [],
  cold_chain: true,
});

describe("board columns", () => {
  it("maps every status to one of the four columns", () => {
    expect(columnOf("pending")).toBe("pending");
    expect((["approved", "modified", "dispatched"] as const).map(columnOf)).toEqual(["moving", "moving", "moving"]);
    expect(columnOf("fulfilled")).toBe("completed");
    expect((["rejected", "expired", "cancelled"] as const).map(columnOf)).toEqual(["closed", "closed", "closed"]);
  });
  it("sorts pending by priority then confidence", () => {
    const cols = byColumn([
      rec({ id: "a", priority: "normal", confidence: 99 }),
      rec({ id: "b", priority: "critical", confidence: 60 }),
      rec({ id: "c", priority: "critical", confidence: 90 }),
    ]);
    expect(cols.pending.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

describe("funnel and district approvals", () => {
  const all = [
    rec({ id: "1" }),
    rec({ id: "2", status: "approved" }),
    rec({ id: "3", status: "dispatched" }),
    rec({ id: "4", status: "fulfilled" }),
    rec({ id: "5", status: "rejected" }),
  ];
  it("counts cumulative stages", () => {
    expect(funnel(all)).toEqual({ generated: 5, approved: 3, dispatched: 2, fulfilled: 1 });
    expect(funnelTitle(funnel(all))).toBe("60% of 5 recommendations were approved, 1 reached a facility");
  });
  it("computes the approval rate per district", () => {
    const rows = approvalsByDistrict(all, ["district_kota", "district_alwar"]);
    expect(rows[0]).toMatchObject({ pending: 1, moving: 2, completed: 1, closed: 1 });
    expect(rows[0].approvalRate).toBeCloseTo(0.75);
    expect(rows[1].approvalRate).toBeNull();
    expect(approvalsTitle(rows, (id) => id)).toBe("district_kota holds 1 of 1 pending decisions");
  });
});

describe("what-if approve all critical", () => {
  const facilities = [fac("f1", "critical"), fac("f2", "critical"), fac("f3", "healthy")];
  const medicines = [med("f1", "ARV", 1.2), med("f2", "ARV", 1.5), med("f2", "TT", 2), med("f3", "ORS", 20)];
  it("removes a facility only when all its stock-out lines are covered", () => {
    const pending = [
      rec({ id: "a", target_facility_id: "f1", medicine_name: "ARV" }),
      rec({ id: "b", target_facility_id: "f2", medicine_name: "ARV" }),
    ];
    const w = whatIf(facilities, medicines, pending);
    expect(w).toMatchObject({ criticalNow: 2, criticalAfter: 1, stockoutsNow: 3, stockoutsAfter: 1, approved: 2 });
    expect(whatIfTitle(w)).toBe("Approving 2 critical recommendations takes critical facilities from 2 to 1");
  });
  it("ignores non critical and non stock recommendations", () => {
    const pending = [rec({ id: "a", priority: "high" }), rec({ id: "b", type: "bed_redirect" })];
    expect(whatIf(facilities, medicines, pending).approved).toBe(0);
  });
});

describe("sensitivity matrix", () => {
  const facilities = [fac("f1", "critical"), fac("f2", "critical")];
  const medicines = [med("f1", "ARV", 1.2), med("f2", "ARV", 1.2)];
  const pending = [
    rec({ id: "a", target_facility_id: "f1", eta_minutes: 60 }),
    rec({ id: "b", target_facility_id: "f2", eta_minutes: 60, confidence: 70 }),
  ];
  it("shrinks as more is approved and grows with delay", () => {
    expect(projectedCritical(facilities, medicines, pending, 0, 0)).toBe(2);
    expect(projectedCritical(facilities, medicines, pending, 50, 0)).toBe(1);
    expect(projectedCritical(facilities, medicines, pending, 100, 0)).toBe(0);
    // cover 1.2 d = 1728 min, window 10% = 172.8 min; 60 + 120 = 180 misses it
    expect(projectedCritical(facilities, medicines, pending, 100, 120)).toBe(2);
    expect(projectedCritical(facilities, medicines, pending, 100, 60)).toBe(0);
  });
  it("is monotone in both axes", () => {
    const g = sensitivityGrid(facilities, medicines, pending);
    for (const row of g) for (let i = 1; i < row.length; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1]);
    for (let r = 1; r < g.length; r++) g[r].forEach((v, c) => expect(v).toBeLessThanOrEqual(g[r - 1][c]));
    expect(sensitivityTitle(g)).toMatch(/^Approving everything on time cuts critical facilities from 2 to 0/);
  });
});

describe("options considered", () => {
  const wh = (id: string, type: string, lat: number, lng: number, cold = true): WarehouseSummary => ({
    id,
    name: id,
    type,
    district_id: "district_kota",
    lat,
    lng,
    capacity_pallets: 1,
    docks: 1,
    cold_room: cold,
    outbound_today: 0,
    reserved_units: 0,
    low_cover_medicines: 0,
  });
  const facilities = [fac("f1", "critical", 25.2, 75.8), fac("peer", "healthy", 25.25, 75.85)];
  const medicines = [med("f1", "ARV", 1.2), med("peer", "ARV", 30)];
  const warehouses = [wh("ddw_kota", "ddw", 25.3, 75.9), wh("wh_central", "central", 26.9, 75.8)];
  it("returns district, central and lateral options and marks the chosen one", () => {
    const o = optionsFor(rec({}), facilities, warehouses, medicines);
    expect(o.map((x) => x.kind)).toEqual(["district", "central", "lateral"]);
    expect(o.find((x) => x.chosen)?.kind).toBe("district");
    expect(o[2].sourceId).toBe("peer");
    expect(o[2].criteria.coldChain).toBe(false);
    expect(o[0].criteria.inRange).toBe(true);
    expect(o[1].criteria.inRange).toBe(false);
    expect(chosenReason(o)).toMatch(/Best fit/);
    expect(chosenReason(o.filter((x) => x.kind !== "lateral"))).toMatch(/Fastest/);
  });
  it("gives no options for bed and staff recommendations", () => {
    expect(optionsFor(rec({ type: "bed_redirect" }), facilities, warehouses, medicines)).toEqual([]);
  });
  it("distance is a road estimate above the straight line", () => {
    expect(roadKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeGreaterThan(111.19);
  });
});

describe("approve quantity override", () => {
  it("prefills from quantity and sends an override only when changed", () => {
    const r = rec({ quantity: 39, quantity_or_detail: "39 vials" });
    expect(defaultQuantity(r)).toBe("39");
    expect(quantityOverride(r, "39")).toBeUndefined();
    expect(quantityOverride(r, "50")).toBe("50");
    expect(defaultQuantity(rec({ quantity: null, quantity_or_detail: "Redirect 12 admissions" }))).toBe("12");
  });
});
