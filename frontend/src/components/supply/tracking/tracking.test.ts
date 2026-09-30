import { describe, expect, it } from "vitest";
import type { ShipmentEvent } from "@/lib/api/types";
import { canCancel, currentStepIndex, delayInfo, etaHeadline, nearestPathIndex, starText, stepperSteps, tempInBand } from "./helpers";

const ev = (type: string, at: string, detail = ""): ShipmentEvent => ({ shipment_id: "S", type, at, title: type, detail, actor: null });

describe("tracking helpers", () => {
  it("maps every live status to a stepper index", () => {
    expect(currentStepIndex("recommended")).toBe(0);
    expect(currentStepIndex("delayed")).toBe(3);
    expect(currentStepIndex("in_transit")).toBe(3);
    expect(currentStepIndex("arrived")).toBe(4);
    expect(currentStepIndex("cancelled")).toBe(-1);
  });

  it("derives stepper state from status and stamps times from events", () => {
    const steps = stepperSteps("in_transit", [ev("created", "2026-09-26T03:00:00Z"), ev("departed", "2026-09-26T04:00:00Z")]);
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "done", "current", "upcoming", "upcoming"]);
    expect(steps[3].at).toBe("2026-09-26T04:00:00Z");
    const delivered = stepperSteps("delivered", []);
    expect(delivered.every((s) => s.state === "done")).toBe(true);
  });

  it("marks steps after a cancellation as skipped", () => {
    const steps = stepperSteps("cancelled", [ev("created", "a"), ev("approved", "b")]);
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "skipped", "skipped", "skipped", "skipped"]);
  });

  it("writes the ETA headline for each phase", () => {
    const base = {
      eta: "2026-09-26T06:18:00Z",
      planned_start: "2026-09-26T05:00:00Z",
      blocked_reason: null,
      destination: { id: "d", name: "PHC Kota-4", kind: null },
      origin: { id: "o", name: "DDW Kota", kind: "warehouse" as const },
      pod: null,
    };
    expect(etaHeadline({ ...base, status: "in_transit" }, "2026-09-26T06:00:00Z")).toBe("Arriving in 18 min");
    expect(etaHeadline({ ...base, status: "arrived" }, null)).toBe("Awaiting confirmation at PHC Kota-4");
    expect(etaHeadline({ ...base, status: "loading" }, null)).toBe("Loading at DDW Kota");
    expect(etaHeadline({ ...base, status: "approved", blocked_reason: "No vehicle free" }, null)).toBe("No vehicle free");
    expect(
      etaHeadline({ ...base, status: "delivered", pod: { pod_id: "p", confirmed_at: "2026-09-26T08:52:00Z", confirmed_by: "x", received: [], condition: "ok" } }, null),
    ).toBe("Delivered 14:22");
  });

  it("builds the delay banner only when behind plan", () => {
    const events = [ev("incident_started", "2026-09-26T05:00:00Z", "Checkpost inspection (18 min)")];
    expect(delayInfo({ status: "delayed", delay_minutes: 18, events })?.reason).toContain("Checkpost");
    expect(delayInfo({ status: "in_transit", delay_minutes: 3, events })).toBeNull();
    expect(delayInfo({ status: "delivered", delay_minutes: 40, events })).toBeNull();
  });

  it("finds the nearest path point", () => {
    const path: Array<[number, number]> = [
      [25, 75],
      [25.1, 75.1],
      [25.2, 75.2],
    ];
    expect(nearestPathIndex(path, { lat: 25.11, lng: 75.09 })).toBe(1);
    expect(nearestPathIndex([], null)).toBe(0);
  });

  it("checks the 2 to 8 C band, stars and cancel permission", () => {
    expect(tempInBand(4.6)).toBe(true);
    expect(tempInBand(9.2)).toBe(false);
    expect(tempInBand(null)).toBe(false);
    expect(starText(4.4)).toBe("★★★★☆");
    expect(canCancel("in_transit", true)).toBe(true);
    expect(canCancel("arrived", true)).toBe(false);
    expect(canCancel("loading", false)).toBe(false);
  });
});
