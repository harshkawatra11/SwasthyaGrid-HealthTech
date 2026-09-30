import { describe, expect, it } from "vitest";
import type { DistrictSummaryRow, MedicineMatrix, StateSummary } from "@/lib/api/types";
import { relativeScale } from "./ComparisonMatrix";
import {
  applyScenario,
  districtCover,
  leagueTitle,
  median,
  peakDay,
  quadrantPoints,
  quadrantTitle,
  shortMedicine,
  shortName,
  stockoutTitle,
  topShortage,
} from "./metrics";

function row(id: string, name: string, over: Partial<DistrictSummaryRow> = {}): DistrictSummaryRow {
  return {
    district_id: id,
    name,
    center: { lat: 0, lng: 0 },
    facilities: 8,
    risk_counts: { healthy: 4, monitor: 2, stress: 1, critical: 1 },
    risk_index: 30,
    critical_facilities: [],
    stockout_items: 2,
    low_cover_items: 2,
    bed_occupancy_avg: 60,
    bed_next_week_avg: 70,
    doctors_high_risk: 0,
    diagnostics_down: 0,
    pending_recommendations: 3,
    shipments_in_transit: 1,
    on_time_rate_7d: 0.8,
    footfall_tomorrow: 200,
    ...over,
  };
}

const matrix: MedicineMatrix = {
  medicines: [],
  districts: [],
  cells: [
    { medicine_name: "ARV", district_id: "a", min_days_remaining: 1.2, facilities_below_threshold: 2, total_units: 10 },
    { medicine_name: "ORS", district_id: "a", min_days_remaining: 4, facilities_below_threshold: 0, total_units: 10 },
    { medicine_name: "TT", district_id: "a", min_days_remaining: 9, facilities_below_threshold: 0, total_units: 10 },
    { medicine_name: "ARV", district_id: "b", min_days_remaining: 20, facilities_below_threshold: 0, total_units: 10 },
    { medicine_name: "ORS", district_id: "b", min_days_remaining: null, facilities_below_threshold: 0, total_units: 0 },
  ],
};

describe("district metrics", () => {
  it("median handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("district cover is the median of per medicine minimum and ignores nulls", () => {
    expect(districtCover(matrix, "a")).toBe(4);
    expect(districtCover(matrix, "b")).toBe(20);
    expect(districtCover(matrix, "zzz")).toBeNull();
  });

  it("top shortage picks the lowest cover", () => {
    expect(topShortage(matrix, "a")).toEqual({ medicine: "ARV", days: 1.2, facilitiesBelow: 2 });
    expect(topShortage(matrix, "zzz")).toBeNull();
  });

  it("names are shortened", () => {
    expect(shortName("Kota District")).toBe("Kota");
    expect(shortMedicine("Anti-Rabies Vaccine (ARV)")).toBe("ARV");
    expect(shortMedicine("Paracetamol")).toBe("Paracetamol");
  });

  it("quadrant flags thin cover with high bed pressure and titles it", () => {
    const summary = {
      districts: [row("a", "Alpha District", { bed_next_week_avg: 82 }), row("b", "Beta District", { bed_next_week_avg: 90 })],
    } as unknown as StateSummary;
    const pts = quadrantPoints(summary, matrix);
    expect(pts.map((p) => p.danger)).toEqual([true, false]);
    expect(quadrantTitle(pts)).toBe("Alpha combines under 7 days of cover with beds above 75% next week");
    expect(quadrantTitle(pts.map((p) => ({ ...p, danger: false })))).toContain("No district combines");
  });

  it("league and stock-out titles compute from the rows", () => {
    const rows = [row("a", "Alpha District", { risk_index: 40, pending_recommendations: 6 }), row("b", "Beta District", { risk_index: 25 })];
    expect(leagueTitle(rows)).toBe("Alpha carries the highest risk index (40), 15 points above Beta");
    expect(stockoutTitle(rows)).toBe("4 stock-out items wait on 9 pending approvals, Alpha holds 6");
  });

  it("scenario scales only forecast days", () => {
    const s = [
      { day: "Mon", actual: 100, predicted: 100 },
      { day: "Sat", predicted: 200 },
    ];
    expect(applyScenario(s, "pessimistic")).toEqual([{ day: "Mon", actual: 100, predicted: 100 }, { day: "Sat", predicted: 250 }]);
    expect(applyScenario(s, "realistic")).toEqual(s);
    expect(peakDay(s)).toEqual({ day: "Sat", value: 200 });
  });

  it("relative scale gives five distinct bins across a column", () => {
    const sc = relativeScale([0, 10], true);
    expect(sc.thresholds).toEqual([2, 4, 6, 8]);
    expect(relativeScale([0, 10], false).thresholds).toEqual([8, 6, 4, 2]);
  });
});
