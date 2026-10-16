import { describe, expect, it, vi } from "vitest";

describe("demo visit routing", () => {
  it("shares an id for REST and SSE, but resets for a fresh document module", async () => {
    const { withDemoVisit } = await import("./base");
    const rest = new URL(withDemoVisit("https://api.example/api/v1/logistics/clock"));
    const stream = new URL(withDemoVisit("https://api.example/api/v1/logistics/stream?district_id=kota"));
    expect(rest.searchParams.get("demo_session")).toBeTruthy();
    expect(stream.searchParams.get("demo_session")).toBe(rest.searchParams.get("demo_session"));
    expect(stream.searchParams.get("district_id")).toBe("kota");
    vi.resetModules();
    const fresh = await import("./base");
    expect(new URL(fresh.withDemoVisit(rest.toString())).searchParams.get("demo_session"))
      .not.toBe(rest.searchParams.get("demo_session"));
  });
});
