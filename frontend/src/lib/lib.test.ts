import { describe, expect, it } from "vitest";
import { heatColor, heatBin, heatLegend, type HeatScale } from "./heat";
import {
  fmtClock,
  fmtDateTime,
  fmtDuration,
  fmtInt,
  fmtKg,
  fmtKm,
  fmtPct,
  fmtRelative,
} from "./format";
import { avatarColor, avatarSeries, initials } from "./avatar";
import { sortRows } from "./sort";
import { statusVar, riskVar, tint } from "./domain";

describe("heatColor", () => {
  const worse: HeatScale = { thresholds: [10, 20, 30, 40], higherIsWorse: true };
  const better: HeatScale = { thresholds: [40, 30, 20, 10], higherIsWorse: false };

  it("returns the empty colour for null", () => {
    expect(heatColor(null, worse)).toBe("var(--heat-empty)");
    expect(heatColor(null, better)).toBe("var(--heat-empty)");
  });

  it("higher is worse: bin = count(v > t), boundaries stay in the lower bin", () => {
    const cases: [number, number][] = [
      [0, 0], [10, 0], [10.01, 1], [20, 1], [20.01, 2], [30, 2], [30.01, 3], [40, 3], [40.01, 4], [999, 4],
    ];
    for (const [v, bin] of cases) {
      expect(heatBin(v, worse)).toBe(bin);
      expect(heatColor(v, worse)).toBe(`var(--heat-${bin})`);
    }
  });

  it("lower is worse: bin = count(v < t), boundaries stay in the lower bin", () => {
    const cases: [number, number][] = [
      [999, 0], [40, 0], [39.99, 1], [30, 1], [29.99, 2], [20, 2], [19.99, 3], [10, 3], [9.99, 4], [0, 4],
    ];
    for (const [v, bin] of cases) {
      expect(heatBin(v, better)).toBe(bin);
    }
  });

  it("legend has five labels", () => {
    expect(heatLegend(worse)).toEqual(["<= 10", "<= 20", "<= 30", "<= 40", "> 40"]);
    expect(heatLegend(better, (v) => `${v}%`)).toHaveLength(5);
  });
});

describe("format", () => {
  it("fmtInt uses en-IN grouping", () => {
    expect(fmtInt(123456)).toBe("1,23,456");
    expect(fmtInt(999)).toBe("999");
    expect(fmtInt(1234567.6)).toBe("12,34,568");
  });
  it("fmtPct", () => {
    expect(fmtPct(82.4)).toBe("82%");
    expect(fmtPct(82.46, 1)).toBe("82.5%");
  });
  it("fmtKg and fmtKm", () => {
    expect(fmtKg(4.4)).toBe("4.4 kg");
    expect(fmtKg(12345)).toBe("12,345 kg");
    expect(fmtKm(114)).toBe("114 km");
    expect(fmtKm(6.25)).toBe("6.3 km");
  });
  it("fmtDuration", () => {
    expect(fmtDuration(85)).toBe("1h 25m");
    expect(fmtDuration(45)).toBe("45m");
    expect(fmtDuration(120)).toBe("2h");
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(-5)).toBe("0m");
  });
  it("fmtRelative", () => {
    const now = "2026-09-26T08:30:00Z";
    expect(fmtRelative("2026-09-26T08:48:00Z", now)).toBe("in 18 min");
    expect(fmtRelative("2026-09-26T08:18:00Z", now)).toBe("12 min ago");
    expect(fmtRelative("2026-09-26T08:30:10Z", now)).toBe("now");
    expect(fmtRelative("2026-09-26T09:55:00Z", now)).toBe("in 1h 25m");
    expect(fmtRelative("2026-09-29T08:30:00Z", now)).toBe("in 3d");
  });
  it("fmtClock and fmtDateTime use IST", () => {
    expect(fmtClock("2026-09-26T08:35:00Z")).toBe("14:05");
    expect(fmtDateTime("2026-09-26T08:35:00Z")).toBe("26 Sep, 14:05");
    expect(fmtClock("2026-09-25T18:30:00Z")).toBe("00:00");
    expect(fmtDateTime("2026-09-25T20:00:00Z")).toBe("26 Sep, 01:30");
  });
});

describe("avatar", () => {
  it("initials", () => {
    expect(initials("Dr. Meera Singh")).toBe("DS");
    expect(initials("Ravi Kumar")).toBe("RK");
    expect(initials("  ashok  ")).toBe("A");
    expect(initials("")).toBe("?");
  });
  it("colour is deterministic and within the six series tokens", () => {
    expect(avatarColor("Ravi Kumar")).toBe(avatarColor("Ravi Kumar"));
    for (const n of ["A", "Ravi Kumar", "Meera", "Sunita Devi", "x y z"]) {
      const s = avatarSeries(n);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(6);
      expect(avatarColor(n)).toBe(`var(--series-${s})`);
    }
    const distinct = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(avatarSeries));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe("sortRows", () => {
  it("sorts numbers numerically, not lexically", () => {
    expect(sortRows([10, 9, 100, 1], (x) => x, "asc")).toEqual([1, 9, 10, 100]);
    expect(sortRows([10, 9, 100, 1], (x) => x, "desc")).toEqual([100, 10, 9, 1]);
  });
  it("sorts strings with en-IN locale compare and puts empties last", () => {
    expect(sortRows(["b", "a", null, "C"], (x) => x, "asc")).toEqual(["a", "b", "C", null]);
    expect(sortRows(["b", "a", null, "C"], (x) => x, "desc")).toEqual(["C", "b", "a", null]);
  });
  it("is stable", () => {
    const rows = [
      { k: 1, n: "x" },
      { k: 1, n: "y" },
      { k: 0, n: "z" },
    ];
    expect(sortRows(rows, (r) => r.k, "asc").map((r) => r.n)).toEqual(["z", "x", "y"]);
  });
});

describe("domain tokens", () => {
  it("maps in_transit to the hyphenated token", () => {
    expect(statusVar("in_transit")).toBe("var(--status-in-transit)");
    expect(statusVar("delivered")).toBe("var(--status-delivered)");
    expect(riskVar("critical")).toBe("var(--risk-critical)");
    expect(tint("var(--red)")).toBe("color-mix(in srgb, var(--red) 12%, transparent)");
  });
});
