import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VoiceSessionProvider, useVoice } from "./VoiceSessionProvider";

vi.mock("@/lib/scope", () => ({ useScope: () => ({ scope: "district_kota", setScope: () => undefined }) }));

function Probe() {
  const { state } = useVoice();
  return (
    <p data-testid="probe">
      {state.status}:{state.phase}
    </p>
  );
}

describe("VoiceSessionProvider", () => {
  it("exposes an idle session to descendants", () => {
    render(
      <VoiceSessionProvider>
        <Probe />
      </VoiceSessionProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("idle:idle");
  });

  it("throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/VoiceSessionProvider/);
    spy.mockRestore();
  });
});
