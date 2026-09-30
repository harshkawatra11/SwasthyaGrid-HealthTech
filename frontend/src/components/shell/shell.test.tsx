import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const nav = vi.hoisted(() => ({
  pathname: "/supply/shipments/SHP-1",
  search: "",
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
}));

import { ScopeProvider, resolveScope, useScope, withScope } from "@/lib/scope";
import { searchPalette } from "@/lib/palette-search";
import { buildEntityIndex, STATIC_DATA } from "@/lib/entity-index";
import { EntityIndexProvider } from "@/lib/entity-index";
import { breadcrumbsFor, findActiveHref, navItems } from "./nav-items";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";

beforeEach(() => {
  nav.pathname = "/supply/shipments/SHP-1";
  nav.search = "";
  nav.replace.mockClear();
  nav.push.mockClear();
  localStorage.clear();
});

function scopeWrapper({ children }: { children: ReactNode }) {
  return <ScopeProvider>{children}</ScopeProvider>;
}

describe("scope", () => {
  it("resolves param over stored value and rejects unknown ids", () => {
    expect(resolveScope("district_kota", "district_alwar")).toBe("district_kota");
    expect(resolveScope(null, "district_alwar")).toBe("district_alwar");
    expect(resolveScope("nonsense", null)).toBe("all");
  });

  it("withScope sets and removes the d param, keeping other params", () => {
    expect(withScope("/inventory", "district_kota")).toBe("/inventory?d=district_kota");
    expect(withScope("/inventory?d=district_kota&x=1", "all")).toBe("/inventory?x=1");
  });

  it("reads the d param", () => {
    nav.search = "d=district_kota";
    const { result } = renderHook(() => useScope(), { wrapper: scopeWrapper });
    expect(result.current.scope).toBe("district_kota");
  });

  it("writes the d param and localStorage on change", () => {
    nav.pathname = "/inventory";
    nav.search = "x=1";
    const { result } = renderHook(() => useScope(), { wrapper: scopeWrapper });
    act(() => result.current.setScope("district_alwar"));
    expect(nav.replace).toHaveBeenCalledWith("/inventory?x=1&d=district_alwar");
    expect(localStorage.getItem("sg-scope")).toBe("district_alwar");
  });

  it("restores the stored scope into the URL on a fresh visit", () => {
    nav.pathname = "/beds";
    localStorage.setItem("sg-scope", "district_udaipur");
    const { result } = renderHook(() => useScope(), { wrapper: scopeWrapper });
    expect(result.current.scope).toBe("district_udaipur");
    expect(nav.replace).toHaveBeenCalledWith("/beds?d=district_udaipur");
  });
});

describe("sidebar active state", () => {
  it("uses the longest prefix so nested supply routes highlight the right item", () => {
    expect(findActiveHref("/supply/shipments/SHP-1")).toBe("/supply");
    expect(findActiveHref("/supply")).toBe("/supply");
    expect(findActiveHref("/supply/fleet")).toBe("/supply/fleet");
    expect(findActiveHref("/districts/district_kota")).toBe("/districts");
    expect(findActiveHref("/facilities/phc_18")).toBe("/facilities");
    expect(findActiveHref("/suppliers")).toBeNull();
  });

  it("marks exactly one link aria-current for a shipment detail route", () => {
    render(
      <ScopeProvider>
        <Sidebar />
      </ScopeProvider>,
    );
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Dispatch");
  });

  it("lists every sidebar route of the plan", () => {
    expect(navItems.map((n) => n.href)).toEqual([
      "/command", "/voice", "/recommendations", "/districts", "/facilities", "/map",
      "/supply", "/supply/fleet", "/supply/drivers", "/supply/planning", "/supply/warehouses",
      "/inventory", "/footfall", "/beds", "/doctors", "/diagnostics", "/analytics",
    ]);
  });

  it("builds breadcrumbs for a drill-down route", () => {
    expect(breadcrumbsFor("/districts/district_kota", () => "Kota District").map((c) => c.label)).toEqual([
      "Districts", "District Comparison", "Kota District",
    ]);
  });
});

describe("command palette", () => {
  const index = buildEntityIndex({
    ...STATIC_DATA,
    shipments: [{ id: "SHP-1042", destinationName: "PHC Kota-4", status: "in_transit" }],
  });

  it("filters facilities by name and caps each group", () => {
    const r = searchPalette(index, "nindar");
    expect(r.map((e) => e.label)).toEqual(["PHC Nindar"]);
    const shipments = searchPalette(index, "kota-4").filter((e) => e.group === "Shipments");
    expect(shipments).toHaveLength(1);
    const many = buildEntityIndex({
      ...STATIC_DATA,
      facilities: Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, name: `PHC Test-${i}`, type: "PHC" as const, districtId: "district_kota" })),
    });
    expect(searchPalette(many, "test").filter((e) => e.group === "Facilities")).toHaveLength(8);
  });

  it("renders results in the dialog, filters as you type and navigates on Enter", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <EntityIndexProvider>
        <ScopeProvider>
          <CommandPalette open onClose={onClose} />
        </ScopeProvider>
      </EntityIndexProvider>,
    );
    await user.type(screen.getByRole("combobox"), "phagi");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("PHC Phagi");
    await user.keyboard("{Enter}");
    expect(nav.push).toHaveBeenCalledWith("/facilities/phc_27");
    expect(onClose).toHaveBeenCalled();
  });
});
