import { describe, expect, it } from "vitest";
import { chipHtml, shipmentColor } from "./ChipLayer";

describe("shipment identity colors", () => {
  it("distinguishes eight consecutive dispatches and keeps each identity stable", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `SHP-${200020 + i}`);
    expect(new Set(ids.map(shipmentColor)).size).toBe(8);
    const color = shipmentColor(ids[0]);
    for (const status of ["in_transit", "delayed", "arrived"] as const) {
      expect(chipHtml(ids[0], status, { live: true })).toContain(`border-left:3px solid ${color}`);
      expect(chipHtml(ids[0], status, { live: true })).toContain(`var(--status-${status.replace('_', '-')})`);
    }
  });
});
