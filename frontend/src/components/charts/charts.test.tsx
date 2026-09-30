import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChartTooltip } from "./ChartTooltip";
import { FunnelBars, funnelShare } from "./FunnelBars";
import { ChartLegend, seriesColor } from "./common";

afterEach(cleanup);

describe("ChartTooltip", () => {
  it("renders nothing when inactive or empty", () => {
    const { container } = render(<ChartTooltip active={false} payload={[{ name: "A", value: 1 }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders label, names and en-IN grouped values with a unit", () => {
    render(<ChartTooltip active label="12 Sep" unit="kg" payload={[{ name: "Shipments", value: 123456, color: "var(--series-1)" }]} />);
    expect(screen.getByText("12 Sep")).toBeInTheDocument();
    expect(screen.getByText("Shipments")).toBeInTheDocument();
    expect(screen.getByText(/1,23,456/)).toBeInTheDocument();
    expect(screen.getByText("kg")).toBeInTheDocument();
  });
});

describe("chart helpers", () => {
  it("funnelShare is relative to the first stage", () => {
    expect(funnelShare(78, 120)).toBe(65);
    expect(funnelShare(5, 0)).toBe(0);
  });
  it("renders every funnel stage with count and share", () => {
    render(<FunnelBars stages={[{ label: "A", value: 200 }, { label: "B", value: 50 }]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("25%")).toBeInTheDocument();
  });
  it("series colours are tokens in fixed order and wrap", () => {
    expect(seriesColor(0)).toBe("var(--series-1)");
    expect(seriesColor(6)).toBe("var(--series-1)");
  });
  it("legend is hidden for a single series", () => {
    const { container } = render(<ChartLegend items={[{ label: "A", color: "var(--series-1)" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
