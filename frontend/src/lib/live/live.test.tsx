import { act, render, renderHook } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPositionsStore } from "./positions-store";
import { LiveStoreProvider, streamUrl, useLiveEvents, useLivePositions, useLiveState } from "./LiveProvider";
import { BACKOFF_MS, isRiskImprovement, LiveStream, STALE_MS, type EventSourceLike } from "./stream";
import type { VehiclePosition } from "@/lib/api/types";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.(new Event("open"));
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
  emit(type: string, data: unknown) {
    for (const l of this.listeners.get(type) ?? []) l({ data: JSON.stringify(data) } as MessageEvent);
  }
}

const last = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];

function setup() {
  const positions = createPositionsStore();
  const toast = vi.fn();
  const invalidate = vi.fn();
  const onKpis = vi.fn();
  const stream = new LiveStream({
    url: "http://127.0.0.1:8080/api/v1/logistics/stream",
    positions,
    invalidate,
    toast,
    onKpis,
    createSource: (u) => new FakeEventSource(u),
  });
  return { positions, toast, invalidate, onKpis, stream };
}

const position = (id: string): VehiclePosition => ({
  shipment_id: id,
  vehicle_id: "veh_1",
  lat: 25.2,
  lng: 75.8,
  bearing: 90,
  speed_kmh: 40,
  progress: 0.4,
  status: "in_transit",
  eta: null,
  temp_c: null,
});

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("stream url", () => {
  it("adds the district scope and never uses localhost", () => {
    expect(streamUrl("http://127.0.0.1:8080", "all")).toBe("http://127.0.0.1:8080/api/v1/logistics/stream");
    expect(streamUrl("http://127.0.0.1:8080", "district_kota")).toBe("http://127.0.0.1:8080/api/v1/logistics/stream?district_id=district_kota");
  });
});

describe("LiveStream reconnect", () => {
  it("backs off 1, 2, 5, 10, 10 seconds and resets after a successful open", () => {
    const { stream } = setup();
    stream.start();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(stream.getState()).toBe("offline");

    let expected = 1;
    for (const delay of [...BACKOFF_MS, 10000]) {
      last().fail();
      vi.advanceTimersByTime(delay - 1);
      expect(FakeEventSource.instances).toHaveLength(expected);
      vi.advanceTimersByTime(1);
      expected += 1;
      expect(FakeEventSource.instances).toHaveLength(expected);
    }
    expect(BACKOFF_MS).toEqual([1000, 2000, 5000, 10000]);

    last().open();
    expect(stream.getState()).toBe("live");
    last().fail();
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(expected + 1);
    stream.stop();
    expect(last().closed).toBe(true);
  });

  it("goes stale after silence and live again on a frame", () => {
    const { stream } = setup();
    stream.start();
    last().open();
    expect(stream.getState()).toBe("live");
    vi.advanceTimersByTime(STALE_MS);
    expect(stream.getState()).toBe("stale");
    last().emit("tick", { sim_now: "2026-09-26T09:00:00Z", positions: [] });
    expect(stream.getState()).toBe("live");
    stream.stop();
    expect(stream.getState()).toBe("offline");
  });
});

describe("LiveStream events", () => {
  it("toasts a risk improvement and invalidates the affected keys", () => {
    const { stream, toast, invalidate } = setup();
    stream.start();
    last().open();
    last().emit("risk", {
      facility_id: "kota_phc_4",
      facility_name: "PHC Kota-4",
      district_id: "district_kota",
      from: "critical",
      to: "healthy",
      reason: "ARV delivered",
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: "PHC Kota-4 improved from Critical to Healthy: ARV delivered",
      tone: "success",
    });
    expect(invalidate.mock.calls[0][0]).toEqual(expect.arrayContaining(["/facilities", "/insights", "/alerts", "/recommendations"]));
    expect(stream.getEvents()).toHaveLength(1);

    last().emit("risk", { facility_id: "x", facility_name: "PHC X", district_id: "d", from: "healthy", to: "stress", reason: "" });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(isRiskImprovement("stress", "monitor")).toBe(true);
    expect(isRiskImprovement("monitor", "monitor")).toBe(false);
  });

  it("toasts a critical message on cold chain breach and invalidates shipment keys", () => {
    const { stream, toast, invalidate } = setup();
    stream.start();
    last().open();
    last().emit("shipment", {
      event: { shipment_id: "SHP-200123", type: "cold_chain_breach", at: "2026-09-26T09:10:00Z", title: "Reefer above 8 C", detail: "", actor: null },
      status: "in_transit",
      district_id: "district_kota",
      facility_id: "kota_phc_4",
    });
    expect(toast.mock.calls[0][0]).toMatchObject({ tone: "critical", title: "Cold chain breach" });
    expect(invalidate.mock.calls[0][0]).toEqual(expect.arrayContaining(["/logistics/shipments", "/facilities/kota_phc_4/profile"]));

    last().emit("shipment", {
      event: { shipment_id: "SHP-200123", type: "departed", at: "x", title: "Departed", detail: "", actor: null },
      status: "in_transit",
      district_id: "district_kota",
      facility_id: "kota_phc_4",
    });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("invalidates on recommendations and stores kpis", () => {
    const { stream, invalidate, onKpis } = setup();
    stream.start();
    last().open();
    last().emit("recommendations", { added: ["rec_1"], expired: [], changed: [] });
    expect(invalidate.mock.calls[0][0]).toContain("/recommendations");
    last().emit("kpis", { delayed_now: 2 });
    expect(onKpis).toHaveBeenCalledWith({ delayed_now: 2 });
  });

  it("keeps only the last 50 events", () => {
    const { stream } = setup();
    stream.start();
    last().open();
    for (let i = 0; i < 60; i++) last().emit("recommendations", { added: [`rec_${i}`], expired: [], changed: [] });
    expect(stream.getEvents()).toHaveLength(50);
  });
});

describe("positions store and hooks", () => {
  it("notifies subscribers on every tick without re-rendering React", () => {
    const { stream, positions } = setup();
    let renders = 0;
    const seen: number[] = [];
    function Probe() {
      renders += 1;
      const store = useLivePositions();
      // Subscribe without touching React state.
      useEffect(() => store.subscribe((s) => seen.push(s.items.length)), [store]);
      return null;
    }
    render(
      <LiveStoreProvider stream={stream} positions={positions}>
        <Probe />
      </LiveStoreProvider>,
    );
    stream.start();
    last().open();
    const rendersBefore = renders;
    act(() => {
      last().emit("tick", { sim_now: "2026-09-26T09:00:00Z", positions: [position("a")] });
      last().emit("tick", { sim_now: "2026-09-26T09:00:01Z", positions: [position("a"), position("b")] });
      last().emit("tick", { sim_now: "2026-09-26T09:00:02Z", positions: [] });
    });
    expect(seen).toEqual([1, 2, 0]);
    expect(renders).toBe(rendersBefore);
  });

  it("useLiveState and useLiveEvents follow the stream", () => {
    const { stream, positions } = setup();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveStoreProvider stream={stream} positions={positions}>
        {children}
      </LiveStoreProvider>
    );
    const state = renderHook(() => useLiveState(), { wrapper });
    const kota = renderHook(() => useLiveEvents({ district_id: "district_kota" }), { wrapper });
    expect(state.result.current).toBe("offline");
    act(() => {
      stream.start();
      last().open();
    });
    expect(state.result.current).toBe("live");
    act(() => {
      last().emit("risk", { facility_id: "a", facility_name: "A", district_id: "district_kota", from: "stress", to: "monitor", reason: "" });
      last().emit("risk", { facility_id: "b", facility_name: "B", district_id: "district_alwar", from: "stress", to: "monitor", reason: "" });
    });
    expect(kota.result.current).toHaveLength(1);
    expect(kota.result.current[0].kind).toBe("risk");
  });
});
