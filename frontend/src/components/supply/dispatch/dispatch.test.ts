import { describe, expect, it } from "vitest";
import type { ShipmentSummary } from "@/lib/api/types";
import {
  anchoredChips,
  dispatchTitle,
  filterOrders,
  fmtDotDate,
  matchesQuery,
  sortOrders,
  statusSegments,
  statusTitle,
  volumeFinding,
  volumePoints,
} from "./helpers";

function ship(over: Partial<ShipmentSummary> & { id: string }): ShipmentSummary {
  return {
    status: "loading",
    priority: "normal",
    kind: "routine",
    district_id: "district_kota",
    origin: { id: "ddw_kota", name: "DDW Kota", kind: "warehouse" },
    destination: { id: "kota_phc_4", name: "PHC Kota-4" },
    lines_summary: "",
    weight_kg: 10,
    pallet_slots: 1,
    cold_chain: false,
    created_at: "2026-09-26T04:00:00Z",
    planned_start: null,
    planned_arrival: null,
    eta: null,
    delay_minutes: 0,
    progress: 0,
    vehicle: null,
    driver: null,
    source_recommendation_id: null,
    blocked_reason: null,
    ...over,
  } as ShipmentSummary;
}

describe("dispatch helpers", () => {
  it("formats the reference tooltip date", () => {
    expect(fmtDotDate("2026-06-05")).toBe("05.06.2026");
  });

  it("slices the volume series by period and derives the action title", () => {
    const points = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
      shipments: i < 20 ? 10 : 15,
      delivered: 10,
      avg_transit_hours: 1,
      on_time_rate: 0.8,
    }));
    const week = volumePoints({ points }, "week");
    expect(week).toHaveLength(7);
    const month = volumePoints({ points }, "month");
    expect(month).toHaveLength(30);
    const f = volumeFinding(month);
    expect(f.title).toContain("Volume is up");
    expect(f.title).toContain("1h");
    expect(f.peak?.shipments).toBe(15);
    expect(volumeFinding([]).changePct).toBeNull();
  });

  it("builds proportional status segments in a fixed order", () => {
    const segs = statusSegments({ in_transit: 3, delivered: 1, cancelled: 0, delayed: 1 });
    expect(segs.map((s) => s.status)).toEqual(["delivered", "in_transit", "delayed"]);
    expect(segs.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(100);
    expect(statusSegments({})).toEqual([]);
    expect(statusTitle({ in_transit: 4, delayed: 1, arrived: 5 })).toBe("5 of 10 shipments are moving, 5 await receipt");
  });

  it("writes the dispatch headline from KPIs", () => {
    expect(dispatchTitle({ in_transit_now: 6, delayed_now: 1, on_time_rate_today: 0.87 })).toBe("6 trucks moving, 1 delayed, 87% on time today");
    expect(dispatchTitle(undefined)).toBe("Live dispatch monitor");
  });

  it("sorts active orders first and drops drafts", () => {
    const items = [
      ship({ id: "A", status: "delivered" }),
      ship({ id: "B", status: "delayed" }),
      ship({ id: "C", status: "recommended" }),
      ship({ id: "D", status: "in_transit", created_at: "2026-09-26T05:00:00Z" }),
    ];
    expect(sortOrders(filterOrders(items, "all", null)).map((s) => s.id)).toEqual(["B", "D", "A"]);
  });

  it("filters orders by sim-time window", () => {
    const items = [ship({ id: "old", created_at: "2026-09-10T00:00:00Z" }), ship({ id: "new", created_at: "2026-09-26T04:00:00Z" })];
    expect(filterOrders(items, "today", "2026-09-26T06:00:00Z").map((s) => s.id)).toEqual(["new"]);
    expect(filterOrders(items, "week", "2026-09-26T06:00:00Z").map((s) => s.id)).toEqual(["new"]);
  });

  it("matches the search box on id and destination", () => {
    const s = ship({ id: "SHP-200042" });
    expect(matchesQuery(s, "200042")).toBe(true);
    expect(matchesQuery(s, "kota-4")).toBe(true);
    expect(matchesQuery(s, "zzz")).toBe(false);
    expect(matchesQuery(s, "  ")).toBe(true);
  });

  it("anchors parked shipments at origin or destination and staggers shared spots", () => {
    const nodes = new Map([
      ["ddw_kota", { lat: 25.2, lng: 75.8 }],
      ["kota_phc_4", { lat: 25.4, lng: 75.9 }],
    ]);
    const items = [
      ship({ id: "L1", status: "loading", created_at: "2026-09-26T05:00:00Z" }),
      ship({ id: "L2", status: "loading", created_at: "2026-09-26T04:00:00Z" }),
      ship({ id: "A1", status: "arrived" }),
      ship({ id: "T1", status: "in_transit" }),
      ship({ id: "R1", status: "recommended" }),
    ];
    const chips = anchoredChips(items, nodes, new Set());
    expect(chips.map((c) => c.shipmentId).sort()).toEqual(["A1", "L1", "L2"]);
    const l = chips.filter((c) => c.status === "loading");
    expect(l.map((c) => c.stack).sort()).toEqual([0, 20]);
    expect(chips.find((c) => c.shipmentId === "A1")?.lat).toBe(25.4);
  });
});
