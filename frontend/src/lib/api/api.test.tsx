import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchJson, resolveApiBase, scopeQuery } from "./base";
import { clearFixtureCache, filterByDistrict, fixtureNameFor, loadFixture } from "./fixtures";
import { useDrivers, useFacilities, useShipments } from "./hooks";
import { toEntityData } from "./entities";
import { buildEntityIndex } from "@/lib/entity-index";
import { setApiOffline, useApiHealth } from "@/lib/api-health";
import facilitiesFixture from "@/data/fixtures/facilities.json";
import districtsFixture from "@/data/fixtures/districts.json";
import type { Facility } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected a rejection");
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>{children}</SWRConfig>
);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearFixtureCache();
  setApiOffline(false);
});

describe("api base", () => {
  it("never dials localhost", () => {
    expect(resolveApiBase(undefined, "localhost")).toBe("http://127.0.0.1:8080");
    expect(resolveApiBase(undefined, "192.168.1.5")).toBe("http://192.168.1.5:8080");
    expect(resolveApiBase(undefined, null)).toBe("http://127.0.0.1:8080");
    expect(resolveApiBase("https://api.example.org/", "localhost")).toBe("https://api.example.org");
  });

  it("builds scope queries and skips all", () => {
    expect(scopeQuery("all")).toBe("");
    expect(scopeQuery("district_kota", { days: 30 })).toBe("?district_id=district_kota&days=30");
  });
});

describe("fetchJson", () => {
  it("returns parsed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: 1 })));
    await expect(fetchJson("/api/v1/x")).resolves.toEqual({ ok: 1 });
  });

  it("maps {detail, code} error bodies to ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "Shipment not found", code: "not_found" }, 404)));
    const err = await caught(fetchJson("/api/v1/x"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "not_found", detail: "Shipment not found" });
    expect(err.isNetwork).toBe(false);
  });

  it("falls back to a generic message for non-JSON and structured details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("boom", { status: 500 })));
    expect(await caught(fetchJson("/x"))).toMatchObject({ status: 500, code: "http_500", detail: "Request failed (500)" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ detail: [{ msg: "bad" }] }, 422)));
    const err = await caught(fetchJson("/x"));
    expect(err.status).toBe(422);
    expect(err.detail).toContain("bad");
  });

  it("maps a rejected fetch to a status 0 network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await caught(fetchJson("/x"));
    expect(err).toMatchObject({ status: 0, code: "network" });
    expect(err.isNetwork).toBe(true);
  });

  it("times out after the configured period", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );
    const pending = caught(fetchJson("/x"));
    await vi.advanceTimersByTimeAsync(5999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const err = await pending;
    expect(err).toMatchObject({ status: 0, code: "timeout" });
  });
});

describe("fixtures", () => {
  it("names fixtures after the path", () => {
    expect(fixtureNameFor("/api/v1/insights/state-summary?district_id=x")).toBe("insights__state-summary");
    expect(fixtureNameFor("/api/v1/logistics/shipments")).toBe("logistics__shipments");
  });

  it("returns the typed empty value for a missing fixture", async () => {
    expect(await loadFixture("does__not-exist", { items: [] as string[] })).toEqual({ items: [] });
  });

  it("filters rows by district id", () => {
    const rows = filterByDistrict({ facilities: facilitiesFixture.facilities as Facility[], n: 1 }, "district_kota");
    expect(rows.facilities).toHaveLength(8);
    expect(rows.n).toBe(1);
    expect(filterByDistrict([1, 2], "district_kota")).toEqual([1, 2]);
  });
});

describe("hooks offline fallback", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  });

  it("returns fixture data and offline: true when fetch rejects", async () => {
    const { result } = renderHook(() => useFacilities("all"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.offline).toBe(true);
    expect(result.current.data?.facilities).toHaveLength(40);
  });

  it("filters the all-scope fixture client side", async () => {
    const { result } = renderHook(() => useFacilities("district_kota"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.facilities).toHaveLength(8);
  });

  it("serves the exported shipments fixture when the backend is unreachable", async () => {
    const { result } = renderHook(() => useShipments(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.offline).toBe(true);
    expect(result.current.data?.items.length).toBeGreaterThan(0);
    expect(result.current.data?.total).toBeGreaterThan(0);
  });

  it("serves the exported drivers fixture when the backend is unreachable", async () => {
    const { result } = renderHook(() => useDrivers(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.offline).toBe(true);
    expect(result.current.data?.items.length).toBeGreaterThan(0);
  });

  it("feeds the offline banner store and clears it after a success", async () => {
    const health = renderHook(() => useApiHealth());
    const facilities = renderHook(() => useFacilities("all"), { wrapper });
    await waitFor(() => expect(facilities.result.current.offline).toBe(true));
    expect(health.result.current.offline).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ facilities: [] })));
    await act(async () => {
      await facilities.result.current.mutate();
    });
    expect(facilities.result.current.offline).toBe(false);
    expect(health.result.current.offline).toBe(false);
  });

  it("does not fall back on HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "nope", code: "not_found" }, 404)));
    const { result } = renderHook(() => useShipments(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.offline).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});

describe("entity index", () => {
  it("resolves every facility id in the fixtures to a name", () => {
    const data = toEntityData({
      districts: districtsFixture.districts,
      facilities: facilitiesFixture.facilities as Facility[],
    });
    const index = buildEntityIndex(data);
    expect(facilitiesFixture.facilities).toHaveLength(40);
    for (const f of facilitiesFixture.facilities) {
      expect(index.facilityName(f.id)).toBe(f.name);
      expect(index.facilityName(f.id)).not.toBe(f.id);
    }
    expect(index.districtName("district_kota")).toBe("Kota District");
    expect(data.districts.find((d) => d.id === "district_kota")?.shortName).toBe("Kota");
  });

  it("resolves shipment, vehicle, driver and warehouse sources", () => {
    const data = toEntityData({
      warehouses: [{ id: "wh_kota", name: "DDW Kota", district_id: "district_kota" } as never],
      vehicles: [{ id: "veh_1", registration: "RJ20 GA 1234" } as never],
      drivers: [{ id: "drv_1", name: "Ramesh Meena" } as never],
    });
    const index = buildEntityIndex(data);
    expect(index.warehouseName("wh_kota")).toBe("DDW Kota");
    expect(index.vehicleRegistration("veh_1")).toBe("RJ20 GA 1234");
    expect(index.driverName("drv_1")).toBe("Ramesh Meena");
    expect(index.driverName("missing")).toBe("missing");
  });
});
