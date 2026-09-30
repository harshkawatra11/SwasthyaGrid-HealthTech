import { describe, expect, it } from "vitest";
import type { DistrictSummaryRow, FacilityMatrix, MedicineMatrix, ShipmentSummary, StateSummary, VolumeSeries } from "@/lib/api/types";
import {
  breachCount,
  dimensionBins,
  executiveBlock,
  facilityMatrixTitle,
  footfallRows,
  impact,
  indexDrivers,
  lastEvents,
  leagueTitle,
  mapTitle,
  meanBands,
  medicineHotspot,
  medicineTitle,
  moneyshot,
  riskMixTitle,
  shortDistrict,
  shortMedicine,
  situationLines,
  timelineFromShipments,
  unitsInSummary,
  volumeTitle,
  watchlistTitle,
} from "./titles";

const counts = (c: number, s: number, m: number, h: number) => ({ critical: c, stress: s, monitor: m, healthy: h });

function district(id: string, name: string, over: Partial<DistrictSummaryRow> = {}): DistrictSummaryRow {
  return {
    district_id: id,
    name,
    center: { lat: 0, lng: 0 },
    facilities: 8,
    risk_counts: counts(1, 1, 2, 4),
    risk_index: 30,
    critical_facilities: [],
    stockout_items: 2,
    low_cover_items: 1,
    bed_occupancy_avg: 60,
    bed_next_week_avg: 76,
    doctors_high_risk: 1,
    diagnostics_down: 0,
    pending_recommendations: 3,
    shipments_in_transit: 1,
    on_time_rate_7d: 0.8,
    footfall_tomorrow: 200,
    ...over,
  };
}

const summary: StateSummary = {
  generated_at: "2026-09-26T08:00:00Z",
  scope: "all",
  totals: {
    facilities: 16,
    risk_counts: counts(3, 2, 4, 7),
    stockout_items: 5,
    low_cover_items: 4,
    bed_occupancy_avg: 65,
    bed_next_week_avg: 78,
    doctors_high_risk: 2,
    diagnostics_down: 1,
    pending_recommendations: 4,
    shipments_in_transit: 3,
    on_time_rate_7d: 0.87,
  },
  districts: [
    district("district_kota", "Kota District", { risk_index: 62, risk_counts: counts(2, 1, 1, 4) }),
    district("district_alwar", "Alwar District", { risk_index: 20, stockout_items: 0, risk_counts: counts(1, 1, 3, 3) }),
  ],
  top_risks: [
    { facility_id: "a", facility_name: "A", district_id: "district_kota", medicine_name: "ARV", days_remaining: 1.2, priority: "critical", inbound_shipment_id: null },
    { facility_id: "b", facility_name: "B", district_id: "district_kota", medicine_name: "TT", days_remaining: 2.2, priority: "critical", inbound_shipment_id: "SHP-1" },
  ],
};

describe("name helpers", () => {
  it("shortens districts and medicines", () => {
    expect(shortDistrict("Kota District")).toBe("Kota");
    expect(shortMedicine("Anti-Rabies Vaccine (ARV)")).toBe("ARV");
    expect(shortMedicine("Adrenaline (Epinephrine)")).toBe("Adrenaline");
    expect(shortMedicine("ORS")).toBe("ORS");
  });
});

describe("action titles", () => {
  it("map title names the worst district and the critical count from the data", () => {
    expect(mapTitle(summary)).toBe("Kota leads on risk (index 62); 3 of 16 facilities critical");
  });
  it("league title reports the spread", () => {
    expect(leagueTitle(summary.districts)).toBe("Risk index spans 42 points, from Alwar to Kota");
  });
  it("risk mix names the district with the most critical facilities", () => {
    expect(riskMixTitle(summary.districts)).toBe("2 of 3 critical facilities sit in Kota");
  });
  it("watchlist counts facilities with no inbound shipment", () => {
    expect(watchlistTitle(summary.top_risks)).toBe("2 facilities on the watchlist, 1 with no shipment on the way");
    expect(watchlistTitle([])).toMatch(/No facility/);
  });
  it("moneyshot is critical of total with the worst district", () => {
    expect(moneyshot(summary)).toEqual({ value: "3 of 16", line: "facilities are critical, most of them in Kota (2)" });
  });
});

const matrix: FacilityMatrix = {
  dimensions: [
    { id: "inventory", label: "Min days of cover", higher_is_worse: false, thresholds: [21, 14, 7, 3], unit: "days" },
    { id: "beds", label: "Beds next week", higher_is_worse: true, thresholds: [60, 75, 85, 95], unit: "%" },
    { id: "supply", label: "Inbound ETA", higher_is_worse: true, thresholds: [1, 3, 6, 12], unit: "hours" },
  ],
  rows: [
    { facility_id: "f1", facility_name: "PHC One", district_id: "d", risk_level: "critical", values: { inventory: 1.8, beds: 97, supply: null } },
    { facility_id: "f2", facility_name: "PHC Two", district_id: "d", risk_level: "healthy", values: { inventory: 30, beds: 50, supply: null } },
    { facility_id: "f3", facility_name: "PHC Three", district_id: "d", risk_level: "stress", values: { inventory: 2, beds: 60, supply: 2 } },
  ],
};

describe("facility matrix helpers", () => {
  it("counts dimensions in the two worst bands and ignores nulls", () => {
    expect(breachCount(matrix.rows[0].values, matrix.dimensions)).toBe(2);
    expect(breachCount(matrix.rows[1].values, matrix.dimensions)).toBe(0);
    expect(breachCount(matrix.rows[2].values, matrix.dimensions)).toBe(1);
  });
  it("title names the worst facility", () => {
    expect(facilityMatrixTitle(matrix)).toBe("1 facility breaches two or more dimensions; PHC One breaches 2");
  });
  it("bins every facility once per dimension", () => {
    for (const b of dimensionBins(matrix)) expect(b.bins.reduce((a, n) => a + n, 0) + b.empty).toBe(3);
  });
});

const med: MedicineMatrix = {
  medicines: [
    { name: "Anti-Rabies Vaccine (ARV)", emergency: true, cold_chain: true },
    { name: "ORS", emergency: false, cold_chain: false },
  ],
  districts: [
    { id: "district_kota", name: "Kota District" },
    { id: "district_alwar", name: "Alwar District" },
  ],
  cells: [
    { medicine_name: "Anti-Rabies Vaccine (ARV)", district_id: "district_kota", min_days_remaining: 1.2, facilities_below_threshold: 3, total_units: 10 },
    { medicine_name: "Anti-Rabies Vaccine (ARV)", district_id: "district_alwar", min_days_remaining: 2.4, facilities_below_threshold: 1, total_units: 10 },
    { medicine_name: "ORS", district_id: "district_alwar", min_days_remaining: 0.5, facilities_below_threshold: 9, total_units: 10 },
  ],
};

describe("medicine title", () => {
  it("picks the emergency medicine with most facilities under 3 days", () => {
    expect(medicineHotspot(med)?.districtId).toBe("district_kota");
    expect(medicineTitle(med)).toBe("Kota has 3 facilities under 3 days of ARV");
  });
  it("says so when nothing is under threshold", () => {
    expect(medicineTitle({ ...med, cells: [] })).toMatch(/No emergency medicine/);
  });
});

describe("situation and executive lines", () => {
  it("builds three lines from data", () => {
    const lines = situationLines(summary, { delayed_now: 2 }, []);
    expect(lines.map((l) => l.tone)).toEqual(["risk", "supply", "action"]);
    expect(lines[0].text).toContain("3 of 16");
    expect(lines[1].text).toContain("2 delayed");
    expect(lines[1].text).toContain("87%");
    expect(lines[2].text).toContain("no recommendation");
  });
  it("splits working from action", () => {
    const b = executiveBlock(summary, { delayed_now: 1 }, []);
    expect(b.working.join(" ")).toContain("7 of 16");
    expect(b.action.join(" ")).toContain("3 facilities are critical");
  });
});

describe("footfall scenarios", () => {
  const forecast = (base: number) => ({
    district_id: "x",
    series: [
      { day: "Mon", actual: 100, predicted: 98 },
      { day: "Tue", predicted: base },
    ],
    tomorrow_breakdown: {},
    confidence: 90,
    factors: [],
  });
  it("scales only forecast days", () => {
    const rows = footfallRows([{ id: "x", forecast: forecast(200) }], "pessimistic");
    expect(rows[0].x).toBe(98);
    expect(rows[1].x).toBe(250);
    expect(footfallRows([{ id: "x", forecast: forecast(200) }], "optimistic")[1].x).toBe(180);
    expect(footfallRows([{ id: "x", forecast: forecast(200) }], "realistic")[1].x).toBe(200);
  });
});

describe("volume title", () => {
  const points = (a: number, b: number): VolumeSeries["points"] =>
    Array.from({ length: 14 }, (_, i) => ({ date: `d${i}`, shipments: i < 7 ? a : b, delivered: 1, avg_transit_hours: 1, on_time_rate: 0.9 }));
  it("compares the last week to the previous one", () => {
    expect(volumeTitle({ points: points(10, 15) })).toBe("Shipment volume is up 50% on the previous week, at 15.0 a day");
    expect(volumeTitle({ points: points(10, 5) })).toMatch(/down 50%/);
  });
});

function ship(over: Partial<ShipmentSummary>): ShipmentSummary {
  return {
    id: "SHP-1",
    status: "arrived",
    priority: "critical",
    kind: "replenishment",
    district_id: "district_kota",
    origin: { id: "o", name: "DDW", kind: "warehouse" },
    destination: { id: "d", name: "PHC Kota-4" },
    lines_summary: "ARV 120 vials, TT 80 vials",
    weight_kg: 5,
    pallet_slots: 1,
    cold_chain: true,
    created_at: "2026-09-26T04:00:00Z",
    planned_start: "2026-09-26T04:30:00Z",
    planned_arrival: "2026-09-26T05:30:00Z",
    eta: "2026-09-26T06:00:00Z",
    delay_minutes: 0,
    progress: 1,
    vehicle: null,
    driver: null,
    source_recommendation_id: null,
    blocked_reason: null,
    ...over,
  };
}

describe("impact and timeline", () => {
  it("sums units and averages delivery time over arrived shipments", () => {
    expect(unitsInSummary("ARV 120 vials, TT 80 vials")).toBe(200);
    const m = impact([ship({}), ship({ id: "SHP-2", priority: "normal" }), ship({ id: "SHP-3", status: "in_transit" })], { on_time_rate_7d: 0.9 });
    expect(m.prevented).toBe(1);
    expect(m.unitsDelivered).toBe(200);
    expect(m.avgHoursToDelivery).toBe(2);
    expect(m.onTimeRate).toBe(0.9);
    expect(m.coldChainCompliance).toBe(1);
  });
  it("limits to the 20 newest events and de-duplicates", () => {
    const many = Array.from({ length: 30 }, (_, i) => ship({ id: `SHP-${i}`, created_at: `2026-09-26T0${i % 10}:00:00Z`, planned_start: null, status: "loading" }));
    const items = lastEvents(timelineFromShipments(many, "2026-09-26T12:00:00Z"), 20);
    expect(items).toHaveLength(20);
    expect(new Set(items.map((i) => i.key)).size).toBe(20);
    expect(new Date(items[0].at).getTime()).toBeGreaterThanOrEqual(new Date(items[19].at).getTime());
  });
  it("does not report events in the future of the simulated clock", () => {
    const items = timelineFromShipments([ship({ created_at: "2026-09-26T20:00:00Z", status: "recommended", planned_start: null })], "2026-09-26T12:00:00Z");
    expect(items).toHaveLength(0);
  });
});

describe("risk index drivers", () => {
  it("follows the plan 6.2 worked example (sums to 31.8)", () => {
    const d = district("x", "X", {
      facilities: 8,
      risk_counts: counts(2, 1, 0, 5),
      stockout_items: 3,
      bed_next_week_avg: 80,
      doctors_high_risk: 1,
    });
    const v = indexDrivers(d);
    expect(v.critical + v.stress + v.stockouts + v.beds + v.doctors).toBeCloseTo(31.8, 1);
  });
});

describe("meanBands", () => {
  it("averages bands and ignores missing values", () => {
    const m = meanBands({
      dimensions: [{ id: "beds", label: "Beds", higher_is_worse: true, thresholds: [60, 75, 85, 95], unit: "%" }],
      rows: [
        { facility_id: "a", facility_name: "A", district_id: "d", risk_level: "healthy", values: { beds: 50 } },
        { facility_id: "b", facility_name: "B", district_id: "d", risk_level: "healthy", values: { beds: 99 } },
        { facility_id: "c", facility_name: "C", district_id: "d", risk_level: "healthy", values: { beds: null } },
      ],
    });
    expect(m.beds).toBe(2);
  });
});
