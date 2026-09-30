import { describe, expect, it } from "vitest";
import type { DistrictSummaryRow, ShipmentSummary } from "@/lib/api/types";
import { defaultLayerState, districtActionTitle, districtRank, networkHeadline, routeCandidates, shipmentActionTitle, worstDistrict } from "./console";

function district(id: string, name: string, riskIndex: number, critical: number): DistrictSummaryRow {
  return {
    district_id: id,
    name,
    center: { lat: 0, lng: 0 },
    facilities: 8,
    risk_index: riskIndex,
    critical_facilities: [],
    footfall_tomorrow: 100,
    risk_counts: { healthy: 8 - critical, monitor: 0, stress: 0, critical },
    stockout_items: 0,
    low_cover_items: 0,
    bed_occupancy_avg: 60,
    bed_next_week_avg: 65,
    doctors_high_risk: 0,
    diagnostics_down: 0,
    pending_recommendations: 0,
    shipments_in_transit: 0,
    on_time_rate_7d: 90,
  };
}

function shipment(over: Partial<ShipmentSummary>): ShipmentSummary {
  return {
    id: "SHP-1",
    status: "in_transit",
    priority: "normal",
    kind: "routine",
    district_id: "district_kota",
    origin: { id: "w1", name: "Warehouse", kind: "warehouse" },
    destination: { id: "f1", name: "PHC Kota-4" },
    lines_summary: "ORS x 40",
    weight_kg: 10,
    pallet_slots: 1,
    cold_chain: false,
    created_at: "2026-01-01T00:00:00Z",
    planned_start: null,
    planned_arrival: null,
    eta: null,
    delay_minutes: 0,
    progress: 0.5,
    vehicle: null,
    driver: null,
    source_recommendation_id: null,
    blocked_reason: null,
    ...over,
  };
}

describe("map console helpers", () => {
  it("defaults facilities, warehouses, trucks and choropleth on, routes and delayed-only off", () => {
    const state = defaultLayerState();
    expect(state.facilities).toBe(true);
    expect(state.warehouses).toBe(true);
    expect(state.trucks).toBe(true);
    expect(state.choropleth).toBe(true);
    expect(state.routes).toBe(false);
    expect(state.delayedOnly).toBe(false);
  });

  it("ranks districts by risk index, worst first", () => {
    const rows = [district("a", "Alwar", 30, 1), district("b", "Bikaner", 55, 3), district("c", "Kota", 40, 2)];
    expect(worstDistrict(rows)?.district_id).toBe("b");
    expect(districtRank(rows, "b")).toBe(1);
    expect(districtRank(rows, "a")).toBe(3);
  });

  it("writes an action title with rank and critical count", () => {
    const rows = [district("a", "Alwar", 30, 1), district("b", "Bikaner", 55, 3)];
    expect(districtActionTitle(rows[1], rows)).toBe("Bikaner ranks 1 of 2 on risk index, with 3 facilities critical");
    expect(districtActionTitle(rows[0], rows)).toContain("ranks 2 of 2");
    const clean = district("z", "Udaipur", 10, 0);
    expect(districtActionTitle(clean, [clean])).toBe("Udaipur ranks 1 of 1 on risk index, no facility is critical");
  });

  it("summarises the truck network", () => {
    expect(networkHeadline(0, 0)).toBe("No trucks are moving right now");
    expect(networkHeadline(3, 0)).toBe("3 trucks in transit, none delayed");
    expect(networkHeadline(3, 1)).toBe("3 trucks in transit, 1 delayed");
  });

  it("writes a shipment action title", () => {
    expect(shipmentActionTitle(shipment({ delay_minutes: 25 }))).toBe("SHP-1 to PHC Kota-4 is running 25 min late");
    expect(shipmentActionTitle(shipment({ status: "delivered" }))).toBe("SHP-1 delivered to PHC Kota-4");
    expect(shipmentActionTitle(shipment({ status: "approved" }))).toBe("SHP-1 is approved, heading to PHC Kota-4");
  });

  it("picks bounded route candidates, worst delay first", () => {
    const items = [
      shipment({ id: "A", status: "in_transit", delay_minutes: 0 }),
      shipment({ id: "B", status: "delayed", delay_minutes: 40 }),
      shipment({ id: "C", status: "delivered", delay_minutes: 0 }),
      shipment({ id: "D", status: "delayed", delay_minutes: 15 }),
    ];
    expect(routeCandidates(items, false)).toEqual(["B", "D", "A"]);
    expect(routeCandidates(items, true)).toEqual(["B", "D"]);
    expect(routeCandidates(items, false, 1)).toEqual(["B"]);
  });
});
