import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { FactCard, formatEta, shipmentSteps } from "./FactCard";
import type { FactCard as Card } from "@/lib/voice/protocol";

afterEach(cleanup);

function hrefs(): string[] {
  return screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
}

describe("FactCard", () => {
  it("district_summary shows risk chips and links critical facilities", () => {
    const card: Card = {
      type: "district_summary",
      district_id: "district_kota",
      name: "Kota",
      risk_counts: { critical: 2, healthy: 5 },
      risk_index: 61.4,
      critical: [{ id: "phc_kota_4", name: "PHC Kota-4" }],
    };
    render(<FactCard card={card} />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(hrefs()).toEqual(["/districts/district_kota", "/facilities/phc_kota_4"]);
  });

  it("facility renders a medicine table and links to the facility", () => {
    render(
      <FactCard
        card={{
          type: "facility",
          facility_id: "phc_kota_4",
          name: "PHC Kota-4",
          district_name: "Kota",
          risk: "critical",
          medicines: [{ name: "ARV", days: 1.5, risk: "critical" }],
          beds_next_week: 88,
        }}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByText("ARV")).toBeInTheDocument();
    expect(within(table).getByText("1.5")).toBeInTheDocument();
    expect(hrefs()).toEqual(["/facilities/phc_kota_4"]);
    expect(screen.getByText("88%")).toBeInTheDocument();
  });

  it("shortages renders one row per shortage with facility links", () => {
    render(
      <FactCard
        card={{
          type: "shortages",
          rows: [
            { facility_id: "a", facility: "PHC A", district: "Kota", medicine: "ORS", days: 2 },
            { facility_id: "b", facility: "PHC B", district: "Alwar", medicine: "ORS", days: null },
          ],
        }}
      />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(hrefs()).toEqual(["/facilities/a", "/facilities/b"]);
  });

  it("ranking renders bars scaled to the largest value", () => {
    const { container } = render(
      <FactCard
        card={{
          type: "ranking",
          metric: "risk_index",
          unit: "pts",
          rows: [
            { district_id: "district_kota", name: "Kota", value: 80 },
            { district_id: "district_alwar", name: "Alwar", value: 40 },
          ],
        }}
      />,
    );
    const bars = container.querySelectorAll<HTMLElement>(".bg-brand");
    expect(bars[0].style.width).toBe("100%");
    expect(bars[1].style.width).toBe("50%");
    expect(hrefs()).toEqual(["/districts/district_kota", "/districts/district_alwar"]);
  });

  it("shipments render a status chip and a tracking link per row", () => {
    render(
      <FactCard
        card={{
          type: "shipments",
          rows: [
            { id: "SHP-1", status: "in_transit", destination: "PHC Kota-4", eta: 45 },
            { id: "SHP-2", status: "weird", destination: "CHC East" },
          ],
        }}
      />,
    );
    expect(screen.getByText("In transit")).toBeInTheDocument();
    expect(screen.getByText("in 45m")).toBeInTheDocument();
    expect(screen.getByText("weird")).toBeInTheDocument();
    expect(hrefs()).toEqual(["/supply/shipments/SHP-1", "/supply/shipments/SHP-2"]);
  });

  it("shipment renders a stepper, ETA and details", () => {
    render(
      <FactCard
        card={{ type: "shipment", id: "SHP-9", status: "delayed", eta: 90, progress: 42.4, driver: "Ramesh", vehicle: "RJ-14", temp_c: 4.2 }}
      />,
    );
    expect(screen.getByText("Delayed")).toBeInTheDocument();
    expect(screen.getByText("in 1h 30m")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("Ramesh")).toBeInTheDocument();
    expect(screen.getByText("4.2 C")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("In transit");
  });

  it("fleet renders counts and queued", () => {
    render(<FactCard card={{ type: "fleet", counts: { in_transit: 3, idle: 5 }, queued: 2 }} />);
    expect(screen.getByText("in transit")).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("formats ETAs", () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(0)).toBe("Arriving now");
    expect(formatEta("soon")).toBe("soon");
  });
  it("maps shipment status to steps", () => {
    expect(shipmentSteps("delivered").every((s) => s.state === "done")).toBe(true);
    expect(shipmentSteps("arrived").map((s) => s.state)).toEqual(["done", "done", "current", "upcoming"]);
    expect(shipmentSteps("approved").every((s) => s.state === "upcoming")).toBe(true);
  });
});
