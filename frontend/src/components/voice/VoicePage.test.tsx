import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VoiceState } from "@/lib/voice/client";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/voice",
}));
vi.mock("@/components/shell/ScopeSwitcher", () => ({ ScopeSwitcher: () => <div data-testid="scope" /> }));
vi.mock("@/lib/scope", () => ({ useScope: () => ({ scope: "all" }), withScope: (h: string) => h }));
vi.mock("@/components/orb/OrbStage", () => ({
  OrbStage: ({ phase }: { phase: string }) => <div data-testid="orb" data-phase={phase} />,
}));

const api = vi.hoisted(() => ({
  state: null as unknown as VoiceState,
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  interrupt: vi.fn(),
  sendTyped: vi.fn(() => true),
  setMuted: vi.fn(),
  pttDown: vi.fn(),
  pttUp: vi.fn(),
  setLanguage: vi.fn(),
  setMode: vi.fn(),
  setScope: vi.fn(),
}));
vi.mock("@/lib/voice/VoiceSessionProvider", () => ({ useVoice: () => api }));

import { VoicePage } from "./VoicePage";

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
  api.state = baseState();
  nav.search = "";
  for (const k of ["start", "stop", "interrupt", "sendTyped", "setMuted", "pttDown", "pttUp", "setLanguage", "setMode"] as const) {
    api[k].mockClear();
  }
  nav.replace.mockClear();
});
afterEach(cleanup);

describe("VoicePage", () => {
  it("renders header, stage, conversation, metrics and the footer note", () => {
    render(<VoicePage />);
    expect(screen.getByRole("heading", { name: "Voice Control Room" })).toBeInTheDocument();
    expect(screen.getByTestId("orb")).toHaveAttribute("data-phase", "idle");
    expect(screen.getByRole("log", { name: "Conversation transcript" })).toBeInTheDocument();
    expect(screen.getByTestId("metrics-strip")).toHaveTextContent("Median first audio");
    expect(screen.getByText(/only from live SwasthyaGrid data/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Suggested prompts" }).querySelectorAll("button")).toHaveLength(6);
  });

  it("the mic button starts a session inside the click", async () => {
    render(<VoicePage />);
    await userEvent.click(screen.getByRole("button", { name: "Start voice session" }));
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it("shows the connecting state with a disabled mic", () => {
    api.state = baseState({ status: "connecting" });
    render(<VoicePage />);
    expect(screen.getByRole("button", { name: "Connecting" })).toBeDisabled();
  });

  it("failed shows the error and the mic retries", async () => {
    api.state = baseState({ status: "failed", errorMessage: "Could not reach the voice service" });
    render(<VoicePage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach");
    await userEvent.click(screen.getByRole("button", { name: "Retry voice session" }));
    expect(api.start).toHaveBeenCalled();
  });

  it("Esc interrupts", () => {
    api.state = baseState({ status: "connected", phase: "speaking" });
    render(<VoicePage />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(api.interrupt).toHaveBeenCalledTimes(1);
  });

  it("M toggles mute but not while typing", () => {
    api.state = baseState({ status: "connected", phase: "listening" });
    render(<VoicePage />);
    fireEvent.keyDown(window, { key: "m" });
    expect(api.setMuted).toHaveBeenCalledWith(true);
    api.setMuted.mockClear();
    const input = screen.getByLabelText("Type a question");
    fireEvent.keyDown(input, { key: "m" });
    expect(api.setMuted).not.toHaveBeenCalled();
  });

  it("Space is push to talk in ptt mode and ignored in an input", () => {
    api.state = baseState({ status: "connected", mode: "ptt", phase: "listening" });
    render(<VoicePage />);
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(api.pttDown).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(window, { code: "Space", key: " " });
    expect(api.pttUp).toHaveBeenCalledTimes(1);
    const input = screen.getByLabelText("Type a question");
    fireEvent.keyDown(input, { code: "Space", key: " " });
    expect(api.pttDown).toHaveBeenCalledTimes(1);
  });

  it("holding the mic button in ptt mode sends down and up", () => {
    api.state = baseState({ status: "connected", mode: "ptt", phase: "listening" });
    render(<VoicePage />);
    const mic = screen.getByRole("button", { name: "Hold to talk" });
    fireEvent.pointerDown(mic);
    expect(api.pttDown).toHaveBeenCalled();
    fireEvent.pointerUp(mic);
    expect(api.pttUp).toHaveBeenCalled();
  });

  it("Stop answer is enabled only while busy and interrupts", async () => {
    api.state = baseState({ status: "connected", phase: "listening" });
    const { rerender } = render(<VoicePage />);
    expect(screen.getByRole("button", { name: "Stop answer" })).toBeDisabled();
    api.state = baseState({ status: "connected", phase: "speaking" });
    rerender(<VoicePage />);
    await userEvent.click(screen.getByRole("button", { name: "Stop answer" }));
    expect(api.interrupt).toHaveBeenCalled();
  });

  it("End session stops, Mute toggles", async () => {
    api.state = baseState({ status: "connected", phase: "listening" });
    render(<VoicePage />);
    await userEvent.click(screen.getByRole("button", { name: "Mute microphone" }));
    expect(api.setMuted).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(api.stop).toHaveBeenCalled();
  });

  it("a suggested prompt is sent as typed text when connected", async () => {
    api.state = baseState({ status: "connected", phase: "listening" });
    render(<VoicePage />);
    await userEvent.click(screen.getByRole("button", { name: "Which district needs attention first?" }));
    expect(api.sendTyped).toHaveBeenCalledWith("Which district needs attention first?");
    expect(api.start).not.toHaveBeenCalled();
  });

  it("a suggested prompt starts a session first when idle and sends once connected", async () => {
    const { rerender } = render(<VoicePage />);
    await userEvent.click(screen.getByRole("button", { name: "कोटा में अभी क्या हाल है?" }));
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.sendTyped).not.toHaveBeenCalled();
    api.state = baseState({ status: "connected", phase: "listening" });
    rerender(<VoicePage />);
    expect(api.sendTyped).toHaveBeenCalledWith("कोटा में अभी क्या हाल है?");
  });

  it("typed input sends and clears", async () => {
    api.state = baseState({ status: "connected", phase: "listening" });
    render(<VoicePage />);
    const input = screen.getByLabelText("Type a question");
    await userEvent.type(input, "How is Kota?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(api.sendTyped).toHaveBeenCalledWith("How is Kota?");
    expect(input).toHaveValue("");
  });

  it("renders the conversation with trace chips and fact cards", () => {
    api.state = baseState({
      status: "connected",
      lines: [
        {
          id: "1", speaker: "officer", text: "How is Kota?", partial: false, toolCalls: [], cards: [], trace: [],
          turnId: null, clientTurnId: "c1", streaming: false, interrupted: false,
        },
        {
          id: "2", speaker: "assistant", text: "Kota has two critical sites.", partial: false, toolCalls: ["get_district_briefing"],
          cards: [{ type: "fleet", counts: { idle: 2 } }],
          trace: [{ name: "get_district_briefing", label: "Checking Kota district data", ok: true }],
          turnId: "t1", clientTurnId: null, streaming: false, interrupted: false,
        },
      ],
    });
    render(<VoicePage />);
    expect(screen.getByText("Checking Kota district data")).toBeInTheDocument();
    expect(screen.getByTestId("fact-card")).toBeInTheDocument();
    expect(screen.getByText("How is Kota?")).toBeInTheDocument();
  });

  it("shows the live caption and the thinking label", () => {
    api.state = baseState({ status: "connected", phase: "thinking", thinkingLabel: "Checking Kota district data", caption: "Kota has" });
    render(<VoicePage />);
    expect(screen.getByText("Checking Kota district data", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByTestId("live-caption")).toHaveTextContent("Kota has");
  });

  it("sends ?ask= once and removes the parameter", () => {
    nav.search = "ask=How%20is%20Kota%3F";
    api.state = baseState({ status: "connected", phase: "listening" });
    render(<VoicePage />);
    expect(api.sendTyped).toHaveBeenCalledWith("How is Kota?");
    expect(nav.replace).toHaveBeenCalledWith("/voice");
  });
});
