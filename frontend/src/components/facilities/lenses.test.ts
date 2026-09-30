import { describe, expect, it } from "vitest";
import { LENS_DEFS, histogram, isLens, lensColor, lensTitle, matchesFilters, parseFilters, rankByLens, tileName, type FacilityRow } from "./lenses";

const row = (id: string, risk: FacilityRow["risk_level"], v: Partial<FacilityRow["values"]> = {}): FacilityRow => ({
  facility_id: id,
  facility_name: `PHC ${id}`,
  district_id: "d",
  risk_level: risk,
  values: { inventory: 10, beds: 70, staffing: 0, diagnostics: 0, performance: 85, supply: null, ...v },
});

describe("facility lenses", () => {
  const rows = [row("A", "healthy"), row("B", "critical", { inventory: 1.2, beds: 96, performance: 60 }), row("C", "stress", { inventory: 5, staffing: 1 })];

  it("ranks worst first per lens", () => {
    expect(rankByLens("risk", rows).map((r) => r.facility_id)).toEqual(["B", "C", "A"]);
    expect(rankByLens("stock", rows).map((r) => r.facility_id)).toEqual(["B", "C", "A"]);
    expect(rankByLens("beds", rows)[0].facility_id).toBe("B");
    expect(rankByLens("performance", rows)[0].facility_id).toBe("B");
    expect(rankByLens("staffing", rows)[0].facility_id).toBe("C");
  });

  it("colours by the heat scale and risk tokens", () => {
    expect(lensColor("risk", rows[1])).toBe("var(--risk-critical)");
    expect(lensColor("stock", rows[1])).toBe("var(--heat-4)");
    expect(lensColor("stock", rows[0])).toBe("var(--heat-2)");
    expect(lensColor("beds", rows[1])).toBe("var(--heat-4)");
    expect(lensColor("staffing", rows[2])).toBe("var(--heat-4)");
  });

  it("parses deep link filters", () => {
    const f = parseFilters((k) => ({ risk: "critical,stress,bogus", type: "phc", q: " Kota " })[k] ?? null);
    expect(f).toEqual({ risks: ["critical", "stress"], type: "PHC", q: "Kota" });
    expect(matchesFilters(rows[1], "PHC", f)).toBe(false);
    expect(matchesFilters(rows[1], "PHC", { risks: ["critical"], type: "PHC", q: "" })).toBe(true);
    expect(matchesFilters(rows[0], "CHC", { risks: [], type: "PHC", q: "" })).toBe(false);
  });

  it("titles are computed from the rows", () => {
    expect(lensTitle("risk", rows)).toBe("1 of 3 facilities are critical, PHC B first in line");
    expect(lensTitle("stock", rows)).toBe("1 of 3 facilities hold under 3 days of some medicine, PHC B lowest at 1.2d");
    expect(lensTitle("staffing", rows)).toBe("1 of 3 facilities have a doctor at high absence risk");
    expect(lensTitle("risk", [])).toBe("No facilities match the filters");
  });

  it("histogram bins and helpers", () => {
    const h = histogram([45, 55, 65, 65, 75, 95, 100]);
    expect(h.map((b) => b.count)).toEqual([1, 1, 2, 1, 0, 2]);
    expect(isLens("beds")).toBe(true);
    expect(isLens("x")).toBe(false);
    expect(tileName("CHC Kota-3")).toBe("Kota-3");
    expect(LENS_DEFS.stock.format(3)).toBe("3d");
  });
});
