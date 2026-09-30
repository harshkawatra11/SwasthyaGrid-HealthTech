import { describe, expect, it } from "vitest";
import { cargoColumns, cargoCounts, cargoLayout, medicineColor, medicineInitials, normaliseSlots } from "./cargo";
import { ganttScale, hourTicks, segmentBar, segmentColor, simDayWindow } from "./gantt";
import {
  coverTone,
  daysToExpiry,
  depotUtilisation,
  driversTitle,
  fleetKpis,
  fleetTitle,
  licenceTone,
  planningQueue,
  planningTitle,
  queueTotals,
} from "./metrics";
import type { DriverSummary, ShipmentSummary, VehicleSummary } from "@/lib/api/types";

const inner = { x: 100, y: 20, w: 300, h: 100 };

describe("cargo layout", () => {
  it("uses two rows and ceil(slots/2) columns", () => {
    expect(cargoColumns(12)).toBe(6);
    expect(cargoColumns(6)).toBe(3);
    expect(cargoColumns(3)).toBe(2);
    expect(cargoColumns(2)).toBe(1);
    expect(cargoColumns(0)).toBe(1);
  });

  it("fills column by column from the cab end and stays inside the bay", () => {
    const cells = cargoLayout(6, inner, 4);
    expect(cells).toHaveLength(6);
    expect(cells[0]).toMatchObject({ col: 0, row: 0 });
    expect(cells[1]).toMatchObject({ col: 0, row: 1 });
    expect(cells[2]).toMatchObject({ col: 1, row: 0 });
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(inner.x - 1e-9);
      expect(c.x + c.w).toBeLessThanOrEqual(inner.x + inner.w + 1e-9);
      expect(c.y + c.h).toBeLessThanOrEqual(inner.y + inner.h + 1e-9);
    }
  });

  it("does not overlap cells", () => {
    const cells = cargoLayout(12, inner, 4);
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i];
        const b = cells[j];
        const overlap =
          a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
        expect(overlap).toBe(false);
      }
  });

  it("odd counts leave one cell in the last column and cap cell width while centring", () => {
    const cells = cargoLayout(3, inner, 4, 50);
    expect(cells[2]).toMatchObject({ col: 1, row: 0 });
    expect(cells[0].w).toBe(50);
    const left = cells[0].x - inner.x;
    const right = inner.x + inner.w - (cells[2].x + cells[2].w);
    expect(left).toBeCloseTo(right, 6);
  });

  it("colours are fixed per medicine and initials are short", () => {
    expect(medicineColor("Paracetamol")).toBe("var(--series-1)");
    expect(medicineColor("Anti-Rabies Vaccine (ARV)")).toBe("var(--series-4)");
    expect(medicineColor("Tetanus Toxoid (TT)")).toBe("var(--text-muted)");
    expect(medicineInitials("Anti-Rabies Vaccine (ARV)")).toBe("ARV");
    expect(medicineInitials("Zinc Sulphate Tablets")).toBe("ZST");
  });

  it("counts states and pads slots", () => {
    const slots = normaliseSlots([{ index: 0, state: "loaded", cold_chain: true }], 4);
    expect(slots).toHaveLength(4);
    expect(cargoCounts(slots)).toEqual({ loaded: 1, reserved: 0, empty: 3, cold: 1, total: 4 });
  });
});

describe("ganttScale", () => {
  const start = "2026-09-25T23:30:00Z"; // 05:00 IST
  const end = "2026-09-26T17:30:00Z"; // 23:00 IST
  it("maps the window edges to 0 and width", () => {
    const s = ganttScale(start, end, 900);
    expect(s.x(new Date(start).getTime())).toBe(0);
    expect(s.x(new Date(end).getTime())).toBe(900);
    expect(s.x(new Date("2026-09-26T08:30:00Z").getTime())).toBeCloseTo(450, 6);
  });
  it("inverts and clamps fractions", () => {
    const s = ganttScale(start, end, 900);
    expect(new Date(s.invert(450)).toISOString()).toBe("2026-09-26T08:30:00.000Z");
    expect(s.fraction(0)).toBe(0);
    expect(s.fraction(Date.now() * 2)).toBe(1);
  });
  it("clips segments to the window", () => {
    const s = ganttScale(start, end, 900);
    expect(segmentBar(s, "2026-09-25T20:00:00Z", "2026-09-25T22:00:00Z")).toBeNull();
    const b = segmentBar(s, "2026-09-25T22:00:00Z", "2026-09-26T00:30:00Z")!;
    expect(b.x).toBe(0);
    expect(b.w).toBeCloseTo(50, 6);
    expect(segmentBar(s, "2026-09-26T08:00:00Z", "2026-09-26T08:00:10Z")!.w).toBe(2);
  });
  it("makes 19 IST hour ticks from 05:00 to 23:00", () => {
    const t = hourTicks(start, end);
    expect(t).toHaveLength(19);
    expect(t[0].label).toBe("05:00");
    expect(t[18].label).toBe("23:00");
  });
  it("colours segments by kind", () => {
    expect(segmentColor("load", "in_transit")).toBe("var(--cyan)");
    expect(segmentColor("dwell", "in_transit")).toBe("var(--violet)");
    expect(segmentColor("incident", "in_transit")).toBe("var(--orange)");
    expect(segmentColor("drive", "in_transit")).toBe("var(--status-in-transit)");
  });
  it("derives the sim day window in IST", () => {
    expect(simDayWindow("2026-09-26T10:00:00Z")).toEqual({
      start: "2026-09-25T23:30:00.000Z",
      end: "2026-09-26T17:30:00.000Z",
    });
  });
});

function veh(p: Partial<VehicleSummary>): VehicleSummary {
  return {
    id: "v",
    registration: "RJ 1",
    class: "van",
    label: "Light van",
    capacity_kg: 750,
    pallet_slots: 2,
    cold_chain: false,
    home_warehouse_id: "w1",
    district_id: "d",
    live_status: "available",
    current_shipment_id: null,
    utilisation_7d: 0.1,
    km_since_service: 100,
    service_due: false,
    fuel_pct: 50,
    ...p,
  };
}

describe("fleet metrics and titles", () => {
  const vs = [
    veh({ id: "a" }),
    veh({ id: "b", live_status: "in_transit", utilisation_7d: 0.5 }),
    veh({ id: "c", live_status: "maintenance", service_due: true, home_warehouse_id: "w2" }),
  ];
  it("counts", () => {
    const k = fleetKpis(vs);
    expect(k).toMatchObject({ total: 3, inUse: 1, available: 1, maintenance: 1, serviceDue: 1 });
    expect(k.avgUtilisation).toBeCloseTo(23.33, 1);
    expect(fleetTitle(k)).toBe("1 of 3 vehicles are ready to dispatch, 1 in maintenance and 1 past their service interval");
  });
  it("ranks depots by utilisation", () => {
    const d = depotUtilisation(vs);
    expect(d[0].depotId).toBe("w1");
    expect(d[0].vehicles).toBe(2);
  });
  it("driver title and licence tone", () => {
    const d = { live_status: "driving", hours_today: 8.5 } as DriverSummary;
    expect(driversTitle([d, { ...d, live_status: "available", hours_today: 2 }])).toBe(
      "1 of 2 drivers are on the road, 1 within an hour of the 9 h limit",
    );
    const now = new Date("2026-09-26T00:00:00Z").getTime();
    expect(daysToExpiry("2026-10-26", now)).toBe(30);
    expect(licenceTone(30)).toBe("warning");
    expect(licenceTone(61)).toBe("good");
    expect(licenceTone(-1)).toBe("critical");
  });
});

describe("planning queue", () => {
  const sh = (id: string, p: Partial<ShipmentSummary>) =>
    ({
      id,
      status: "approved",
      priority: "normal",
      weight_kg: 10,
      pallet_slots: 1,
      cold_chain: false,
      created_at: "2026-09-26T00:00:00Z",
      vehicle: null,
      blocked_reason: null,
      ...p,
    }) as ShipmentSummary;
  it("filters, sorts by priority and totals", () => {
    const q = planningQueue([
      sh("N", {}),
      sh("C", { priority: "critical", blocked_reason: "No reefer free", cold_chain: true }),
      sh("X", { status: "in_transit" }),
      sh("V", { vehicle: { id: "v", registration: "r", class: "van" } }),
    ]);
    expect(q.map((s) => s.id)).toEqual(["C", "N"]);
    const t = queueTotals(q);
    expect(t).toEqual({ count: 2, weightKg: 20, pallets: 2, blocked: 1, cold: 1 });
    expect(planningTitle(t)).toBe("2 shipments are waiting for a vehicle (2 pallets), 1 blocked");
  });
  it("cover tones", () => {
    expect(coverTone(2)).toBe("critical");
    expect(coverTone(5)).toBe("stress");
    expect(coverTone(20)).toBe("healthy");
    expect(coverTone(null)).toBe("monitor");
  });
});
