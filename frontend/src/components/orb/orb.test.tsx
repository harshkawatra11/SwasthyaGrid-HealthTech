import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./OrbScene", () => ({ OrbScene: () => <div data-testid="glass-canvas" /> }));

import { OrbStage, resetOrbCapabilityCache } from "./OrbStage";
import { OrbFallback } from "./OrbFallback";
import { envelopeTarget, orbScales, phaseColors, stepEnvelope, colorLerpFactor } from "./orb-math";

function mockMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: reduced && query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
}

beforeEach(() => {
  resetOrbCapabilityCache();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OrbStage fallback", () => {
  it("renders the CSS orb under reduced motion and never mounts the canvas", () => {
    mockMatchMedia(true);
    // Even with WebGL2 available, reduced motion wins.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as unknown as RenderingContext);
    render(<OrbStage phase="listening" size={380} />);
    expect(screen.getByTestId("orb-fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("glass-canvas")).toBeNull();
    expect(screen.getByTestId("orb-stage")).toHaveAttribute("data-mode", "fallback");
  });

  it("renders the CSS orb when WebGL2 is unavailable", () => {
    mockMatchMedia(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<OrbStage phase="idle" />);
    expect(screen.getByTestId("orb-fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("glass-canvas")).toBeNull();
  });

  it("keeps the same stage size in both modes (no layout shift)", () => {
    mockMatchMedia(true);
    render(<OrbStage phase="idle" size={300} />);
    expect(screen.getByTestId("orb-stage")).toHaveStyle({ width: "300px", height: "300px" });
  });

  it("does not run the animation loop under reduced motion", () => {
    mockMatchMedia(true);
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(7);
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    render(<OrbFallback phase="speaking" size={28} />);
    // The first render has not read the media query yet; once it does, the loop is cancelled and not restarted.
    expect(cancel).toHaveBeenCalledWith(7);
    expect(screen.getByTestId("orb-fallback").style.transform).toBe("");
  });

  it("starts the animation loop when motion is allowed", () => {
    mockMatchMedia(false);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    render(<OrbFallback phase="speaking" size={28} />);
    expect(raf).toHaveBeenCalled();
  });

  it("switches to the glass canvas when capable and motion is allowed", () => {
    mockMatchMedia(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as unknown as RenderingContext);
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(8);
    render(<OrbStage phase="listening" />);
    expect(screen.getByTestId("orb-stage")).toHaveAttribute("data-mode", "glass");
  });
});

describe("orb math", () => {
  it("idle never moves, silence maps to zero, loud speech saturates at one", () => {
    expect(envelopeTarget(0.5, "idle")).toBe(0);
    expect(envelopeTarget(0.004, "listening")).toBe(0);
    expect(envelopeTarget(0.2, "speaking")).toBe(1);
    expect(envelopeTarget(0.064, "speaking")).toBeCloseTo(0.5, 5);
  });

  it("attacks faster than it releases", () => {
    const up = stepEnvelope(0, 1, 0.05);
    const down = 1 - stepEnvelope(1, 0, 0.05);
    expect(up).toBeGreaterThan(down);
  });

  it("scales follow the plan formulas", () => {
    expect(orbScales(1, "speaking", 0).group).toBeCloseTo(1.024, 5);
    expect(orbScales(0, "idle", 0).volume).toBeCloseTo(0.78, 5);
    expect(orbScales(1, "listening", 3).volume).toBeCloseTo(0.78 * 1.035, 5);
  });

  it("phase colours differ between listening and speaking, idle is dimmer", () => {
    const l = phaseColors("listening");
    const s = phaseColors("speaking");
    const i = phaseColors("idle");
    expect(l.top.getHex()).not.toBe(s.top.getHex());
    expect(l.bottom.getHex()).not.toBe(s.bottom.getHex());
    expect(i.top.r).toBeCloseTo(l.top.r * 0.6, 5);
    expect(colorLerpFactor(0.4)).toBeCloseTo(1 - Math.exp(-1), 5);
  });
});
