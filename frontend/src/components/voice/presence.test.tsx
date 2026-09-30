import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VoiceState } from "@/lib/voice/client";

const nav = vi.hoisted(() => ({ pathname: "/command" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/lib/scope", () => ({ useScope: () => ({ scope: "all" }), withScope: (h: string) => h }));
vi.mock("@/components/orb/OrbFallback", () => ({
  OrbFallback: ({ phase, size }: { phase: string; size: number }) => <div data-testid="orb-fallback" data-phase={phase} data-size={size} />,
}));

const api = vi.hoisted(() => ({
  state: null as unknown as VoiceState,
  interrupt: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@/lib/voice/VoiceSessionProvider", () => ({ useVoice: () => api }));

import { VoiceButton } from "./VoiceButton";
import { VoiceDock } from "./VoiceDock";

function baseState(over: Partial<VoiceState> = {}): VoiceState {
  return {
    status: "idle",
    phase: "idle",
    thinkingLabel: null,
    caption: null,
    lines: [],
    language: "auto",
    mode: "handsfree",
    muted: false,
    sttMode: null,
    ttsMode: null,
    metrics: { turns: 0, medianFirstAudioMs: null, lastFirstAudioMs: null },
    errorMessage: null,
    ...over,
  };
}

beforeEach(() => {
  nav.pathname = "/command";
  api.state = baseState();
  api.interrupt.mockClear();
  api.stop.mockClear();
});
afterEach(cleanup);

describe("VoiceButton", () => {
  it("is a mic link to /voice when idle", () => {
    render(<VoiceButton />);
    expect(screen.getByRole("link", { name: "Open Voice Control Room" })).toHaveAttribute("href", "/voice");
    expect(screen.queryByTestId("orb-fallback")).toBeNull();
  });

  it("shows a 28 px CSS orb and the phase while a call is live", () => {
    api.state = baseState({ status: "connected", phase: "speaking" });
    render(<VoiceButton />);
    const orb = screen.getByTestId("orb-fallback");
    expect(orb).toHaveAttribute("data-size", "28");
    expect(orb).toHaveAttribute("data-phase", "speaking");
    expect(screen.getByText("Speaking")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/voice");
  });

  it("is hidden on /voice", () => {
    nav.pathname = "/voice";
    render(<VoiceButton />);
    expect(screen.queryByTestId("voice-button")).toBeNull();
  });
});

describe("VoiceDock", () => {
  it("is not rendered without a live session", () => {
    render(<VoiceDock />);
    expect(screen.queryByTestId("voice-dock")).toBeNull();
  });

  it("is not rendered on /voice even when live", () => {
    nav.pathname = "/voice";
    api.state = baseState({ status: "connected", phase: "listening" });
    render(<VoiceDock />);
    expect(screen.queryByTestId("voice-dock")).toBeNull();
  });

  it("shows the caption and the Stop answer and End session controls", async () => {
    api.state = baseState({ status: "connected", phase: "speaking", caption: "Kota has two critical sites." });
    render(<VoiceDock />);
    expect(screen.getByTestId("dock-caption")).toHaveTextContent("Kota has two critical sites.");
    await userEvent.click(screen.getByRole("button", { name: "Stop answer" }));
    expect(api.interrupt).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(api.stop).toHaveBeenCalledTimes(1);
  });

  it("disables Stop answer when nothing is playing", () => {
    api.state = baseState({ status: "connected", phase: "listening" });
    render(<VoiceDock />);
    expect(screen.getByRole("button", { name: "Stop answer" })).toBeDisabled();
  });
});
