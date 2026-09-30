import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CausalChain, coverTone } from "./kit";
import { PRINT_CSS, Scorecard } from "./Scorecard";
import { districtHeadline, riskCountsOf } from "./metrics";

describe("district scorecard", () => {
  it("print stylesheet limits output to the scorecard on A4", () => {
    expect(PRINT_CSS).toContain("@media print");
    expect(PRINT_CSS).toContain("size: A4");
    expect(PRINT_CSS).toContain(".sg-scorecard, .sg-scorecard *");
  });

  it("renders KPIs, heatmap row, top risks and actions", () => {
    const row = {
      district_id: "d", name: "Kota District", center: { lat: 0, lng: 0 }, facilities: 2,
      risk_counts: { healthy: 1, monitor: 0, stress: 0, critical: 1 }, risk_index: 21, critical_facilities: [],
      stockout_items: 1, low_cover_items: 0, bed_occupancy_avg: 60, bed_next_week_avg: 76, doctors_high_risk: 1,
      diagnostics_down: 0, pending_recommendations: 1, shipments_in_transit: 0, on_time_rate_7d: 0.7, footfall_tomorrow: 100,
    };
    render(
      <Scorecard
        row={row}
        matrix={{
          dimensions: [{ id: "inventory", label: "Min days of cover", higher_is_worse: false, thresholds: [21, 14, 7, 3], unit: "days" }],
          rows: [{ facility_id: "f1", facility_name: "PHC Kota-4", district_id: "d", risk_level: "critical", values: { inventory: 1.2 } }],
        }}
        topRisks={[{ facility_id: "f1", facility_name: "PHC Kota-4", district_id: "d", medicine_name: "Anti-Rabies Vaccine (ARV)", days_remaining: 1.2, priority: "critical", inbound_shipment_id: null }]}
        actions={[]}
        generatedAt="26 Sep"
        facilityName={() => "x"}
      />,
    );
    expect(screen.getByText("Kota district scorecard")).toBeTruthy();
    expect(screen.getAllByText("PHC Kota-4").length).toBe(2);
    expect(screen.getByText("1.2 days of cover")).toBeTruthy();
    expect(screen.getByText("No approved or completed actions yet.")).toBeTruthy();
  });

  it("headline and helpers", () => {
    const rows = [
      { facility_id: "a", facility_name: "A", district_id: "d", risk_level: "critical" as const, values: {} },
      { facility_id: "b", facility_name: "B", district_id: "d", risk_level: "healthy" as const, values: {} },
    ];
    expect(districtHeadline(rows, "Kota")).toBe("1 of 2 facilities in Kota are critical");
    expect(riskCountsOf(rows)).toEqual({ healthy: 1, monitor: 0, stress: 0, critical: 1 });
    expect(coverTone(2)).toBe("critical");
    expect(coverTone(10)).toBe("monitor");
    expect(coverTone(30)).toBe("healthy");
  });

  it("causal chain shows every step and the effect", () => {
    render(<CausalChain steps={["Rain", "Dengue"]} effect="Stock pressure" />);
    expect(screen.getByText("Rain")).toBeTruthy();
    expect(screen.getByText("Stock pressure")).toBeTruthy();
  });
});
