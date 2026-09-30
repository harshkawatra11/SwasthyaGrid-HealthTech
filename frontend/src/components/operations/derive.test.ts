import { describe, expect, it } from "vitest";
import {
  absenceByWeekday,
  capacityWaterfall,
  countBelow,
  coverUnder,
  deriveFootfall,
  diagState,
  emergencyTitle,
  enrichBeds,
  enrichMedicines,
  facilityRefs,
  fanSeries,
  footfallPoints,
  forecastStart,
  histogram,
  medicineDistrictMin,
  minCoverByFacility,
  pearson,
  shortMedicine,
  stockoutTitle,
  weekUnder,
} from "./derive";
import type { Facility, MedicineForecast } from "@/lib/api/types";

const facilities: Facility[] = [
  { id: "a", name: "PHC Alpha", type: "PHC", lat: 0, lng: 0, beds_total: 20, district_id: "district_kota", risk_level: "critical" },
  { id: "b", name: "PHC Beta", type: "PHC", lat: 0, lng: 0, beds_total: 40, district_id: "district_alwar", risk_level: "healthy" },
];
const med = (facility_id: string, medicine_name: string, days_remaining: number): MedicineForecast => ({
  facility_id,
  medicine_name,
  units_remaining: 10,
  days_remaining,
  risk: "low",
  confidence: 90,
  factors: [],
});

describe("inventory derivations", () => {
  const refs = facilityRefs(facilities);
  const rows = enrichMedicines(
    [med("a", "Anti-Rabies Vaccine (ARV)", 1.8), med("a", "ORS", 20), med("b", "Anti-Rabies Vaccine (ARV)", 12), med("b", "ORS", 2.5)],
    refs,
  );

  it("joins names, districts and catalogue flags", () => {
    expect(rows[0].facilityName).toBe("PHC Alpha");
    expect(rows[0].districtId).toBe("district_kota");
    expect(rows[0].emergency).toBe(true);
    expect(rows[0].coldChain).toBe(true);
    expect(rows[1].emergency).toBe(false);
  });

  it("shortens medicine names", () => {
    expect(shortMedicine("Anti-Rabies Vaccine (ARV)")).toBe("ARV");
    expect(shortMedicine("ORS")).toBe("ORS");
  });

  it("counts stock-outs and applies the demand factor", () => {
    expect(countBelow(rows, 3)).toBe(2);
    expect(coverUnder(10, 1.25)).toBe(8);
    expect(countBelow(rows, 3, 1.25)).toBe(2);
    expect(countBelow(rows, 3, 0.5)).toBe(0);
  });

  it("ranks facilities by weakest item", () => {
    const ranked = minCoverByFacility(rows);
    expect(ranked[0]).toMatchObject({ facilityId: "a", min: 1.8, below3: 1 });
    expect(ranked[1].min).toBe(2.5);
  });

  it("finds the weakest facility per medicine and district", () => {
    expect(medicineDistrictMin(rows, "Anti-Rabies Vaccine (ARV)", "district_kota")).toBe(1.8);
    expect(medicineDistrictMin(rows, "ORS", "district_kota")).toBe(20);
    expect(medicineDistrictMin(rows, "Oxytocin", "district_kota")).toBeNull();
  });

  it("writes titles from the numbers", () => {
    expect(stockoutTitle(2, 2, 1)).toBe("2 stock-outs inside 3 days across 2 facilities");
    expect(stockoutTitle(1, 1, 1.25)).toContain("if demand surges 25%");
    expect(stockoutTitle(0, 0, 1)).toContain("No facility");
    expect(emergencyTitle(rows)).toBe("Kota leads 1 facilities under 7 days of ARV");
  });
});

describe("footfall derivations", () => {
  const base = {
    district_id: "district_jaipur_rural",
    series: [
      { day: "Mon", actual: 100, predicted: 96 },
      { day: "Tue", actual: 110, predicted: 108 },
      { day: "Wed", predicted: 120 },
      { day: "Thu", predicted: 130 },
    ],
    tomorrow_breakdown: { children: 10 },
    confidence: 90,
    factors: [],
  };
  const pts = footfallPoints(base);

  it("finds where the forecast starts", () => {
    expect(forecastStart(pts)).toBe(2);
  });

  it("widens the band with the horizon and scales only future days", () => {
    const fan = fanSeries(pts, 90, 1.25);
    expect(fan[0].predicted).toBe(96);
    expect(fan[2].predicted).toBe(150);
    expect((fan[3].band ?? 0) > (fan[2].band ?? 0)).toBe(true);
    expect(fan[3].lo).toBeLessThan(fan[3].predicted ?? 0);
  });

  it("derives a stable stand-in for another district", () => {
    const d = deriveFootfall(base, "district_kota", 8);
    expect(d.district_id).toBe("district_kota");
    expect(deriveFootfall(base, "district_jaipur_rural", 8)).toBe(base);
    expect(deriveFootfall(base, "district_kota", 8)).toEqual(d);
  });
});

describe("beds derivations", () => {
  const beds = enrichBeds(
    [{ facility_id: "a", occupied: 16, occupancy_pct: 80, predicted_tomorrow_pct: 88, predicted_next_week_pct: 90 }, {} as never],
    facilityRefs(facilities),
  );
  it("skips empty rows and joins capacity", () => {
    expect(beds).toHaveLength(1);
    expect(beds[0].total).toBe(20);
  });
  it("scales next week pressure and caps at 100", () => {
    expect(weekUnder(beds[0], 1.25)).toBe(100);
    expect(weekUnder(beds[0], 0.9)).toBe(81);
  });
  it("builds a waterfall that adds up", () => {
    const w = capacityWaterfall(beds, 1);
    expect(w.total).toBe(20);
    expect(w.occupied).toBe(16);
    expect(w.occupied + w.extra + w.free).toBe(20);
  });
});

describe("doctors, diagnostics and stats", () => {
  it("puts high likelihood on the named weekday", () => {
    const w = absenceByWeekday({
      facility_id: "a",
      doctor_name: "Dr A",
      specialty: "GP",
      absence_pattern: "5 consecutive Mondays",
      risk_level: "high",
      patient_delay_pct: 30,
    });
    expect(w[0]).toBeGreaterThan(0.8);
    expect(Math.max(...w.slice(1))).toBeLessThan(0.4);
  });
  it("classifies diagnostic status", () => {
    expect(diagState("available")).toBe("available");
    expect(diagState("machine_failure")).toBe("down");
    expect(diagState("degraded_output")).toBe("degraded");
    expect(diagState(undefined)).toBe("none");
  });
  it("computes correlation and histogram bins", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
    const h = histogram([61, 70, 70, 100], [60, 70, 80, 100]);
    expect(h.map((b) => b.count)).toEqual([1, 2, 1]);
  });
});
