import { describe, expect, it, vi } from "vitest";
import { bearing, lerpLatLng, splitRoute, tickFraction } from "./geo";
import { tileConfig, tileProvider } from "./tiles";
import { createPositionsStore } from "@/lib/live/positions-store";

describe("lerpLatLng", () => {
  it("interpolates and clamps t", () => {
    expect(lerpLatLng([0, 0], [10, 20], 0)).toEqual([0, 0]);
    expect(lerpLatLng([0, 0], [10, 20], 0.5)).toEqual([5, 10]);
    expect(lerpLatLng([0, 0], [10, 20], 1)).toEqual([10, 20]);
    expect(lerpLatLng([0, 0], [10, 20], 2)).toEqual([10, 20]);
    expect(lerpLatLng([0, 0], [10, 20], -1)).toEqual([0, 0]);
  });
});

describe("bearing", () => {
  it("returns compass degrees for the four directions", () => {
    expect(bearing([26, 75], [27, 75])).toBeCloseTo(0, 5);
    expect(bearing([26, 75], [26, 76])).toBeCloseTo(90, 0);
    expect(bearing([26, 75], [25, 75])).toBeCloseTo(180, 5);
    expect(bearing([26, 75], [26, 74])).toBeCloseTo(270, 0);
  });
  it("stays in [0, 360)", () => {
    const b = bearing([26.9, 75.8], [25.2, 75.8]);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});

describe("tickFraction and splitRoute", () => {
  it("clamps the elapsed fraction", () => {
    expect(tickFraction(1500, 1000, 1000)).toBe(0.5);
    expect(tickFraction(5000, 1000, 1000)).toBe(1);
    expect(tickFraction(900, 1000, 1000)).toBe(0);
  });
  it("splits a route at the travelled index", () => {
    const path: [number, number][] = [[0, 0], [1, 1], [2, 2], [3, 3]];
    const { travelled, remaining } = splitRoute(path, 1);
    expect(travelled).toEqual([[0, 0], [1, 1]]);
    expect(remaining).toEqual([[1, 1], [2, 2], [3, 3]]);
    expect(splitRoute(path, 99).remaining).toEqual([[3, 3]]);
  });
});

describe("tiles", () => {
  it("defaults to esri (CARTO shows an API key watermark) and opts into carto by env value", () => {
    expect(tileProvider(undefined)).toBe("esri");
    expect(tileProvider("carto")).toBe("carto");
    expect(tileConfig("dark", "carto").url).toContain("dark_all");
    expect(tileConfig("light", "carto").url).toContain("light_all");
    expect(tileConfig("dark", "esri").url).toContain("World_Dark_Gray_Base");
    expect(tileConfig("light", "esri").url).toContain("World_Light_Gray_Base");
  });
});

describe("positions store", () => {
  it("notifies subscribers on publish and stops after unsubscribe", () => {
    const store = createPositionsStore();
    const cb = vi.fn();
    const off = store.subscribe(cb);
    const item = { shipment_id: "SHP-1", vehicle_id: "V1", lat: 1, lng: 2, bearing: 0, speed_kmh: 40, progress: 0.1, status: "in_transit" as const };
    store.publish([item], 100);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ receivedAt: 100, items: [item] });
    off();
    store.publish([], 200);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
