import { describe, expect, it } from "vitest";
import type { MedicineForecast, PerformanceRow, ShipmentSummary } from "@/lib/api/types";
import { caseTitle, districtMean, lowestCover, shortMed, stepsFor, weakestDimension } from "./case";

const med = (name: string, days: number): MedicineForecast => ({
  facility_id: "f", medicine_name: name, units_remaining: 10, days_remaining: days, risk: "high", confidence: 80, factors: [],
});
const ship = (status: ShipmentSummary["status"]) => ({ status }) as ShipmentSummary;
const perf = (id: string, v: number): PerformanceRow => ({ facility_id: id, facility_name: id, district_id: "d", overall: v, inventory: v, attendance: v, diagnostics: v, patient_wait: v, forecast_accuracy: v });

describe("facility case file helpers", () => {
  it("derives stepper state from status", () => {
    expect(stepsFor("in_transit").map((s) => s.state)).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(stepsFor("delayed")[2].state).toBe("current");
    expect(stepsFor("delivered").every((s) => s.state === "done")).toBe(true);
    expect(stepsFor("recommended").every((s) => s.state === "upcoming")).toBe(true);
  });

  it("finds the lowest cover and writes the title", () => {
    const meds = [med("ORS", 4), med("Anti-Rabies Vaccine (ARV)", 1.8)];
    expect(lowestCover(meds)?.medicine_name).toBe("Anti-Rabies Vaccine (ARV)");
    expect(caseTitle("PHC Kota-4", meds, [ship("in_transit"), ship("delivered")])).toBe("PHC Kota-4 has 1.8 days of ARV, 1 shipment is inbound");
    expect(caseTitle("PHC Kota-4", meds, [])).toContain("nothing is inbound");
    expect(caseTitle("PHC X", [], [])).toBe("PHC X has no medicine below the watch threshold");
    expect(shortMed("Paracetamol")).toBe("Paracetamol");
  });

  it("compares against district peers", () => {
    const rows = [perf("a", 60), perf("b", 80), perf("c", 90)];
    expect(districtMean(rows, "a").inventory).toBe(85);
    const w = weakestDimension(rows[0], rows);
    expect(w?.gap).toBe(-25);
  });
});
