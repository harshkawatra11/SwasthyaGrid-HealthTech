import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, sortByColumn, type Column } from "./DataTable";
import { RiskChip, riskLabel } from "./RiskChip";
import { StatusChip, statusLabel } from "./StatusChip";
import { PriorityChip } from "./PriorityChip";
import { Avatar } from "./Avatar";
import { Meter, meterAutoColor } from "./Meter";
import { deltaIsGood } from "./KpiTile";
import { clearToasts, getToasts, toast, dismissToast, MAX_TOASTS, TOAST_MS } from "./toast-store";
import type { RiskLevel, ShipmentStatus } from "@/lib/domain";

afterEach(cleanup);

type Row = { id: string; name: string; units: number };
const rows: Row[] = [
  { id: "a", name: "Beta", units: 100 },
  { id: "b", name: "alpha", units: 9 },
  { id: "c", name: "Gamma", units: 10 },
];
const columns: Column<Row>[] = [
  { key: "name", header: "Name", accessor: (r) => r.name, sortable: true },
  { key: "units", header: "Units", accessor: (r) => r.units, sortable: true, align: "right" },
];

function bodyOrder(): string[] {
  const body = screen.getAllByRole("row").slice(1);
  return body.map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
}

describe("DataTable", () => {
  it("sortByColumn sorts numerically and by locale", () => {
    expect(sortByColumn(rows, columns, { key: "units", dir: "asc" }).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortByColumn(rows, columns, { key: "name", dir: "asc" }).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortByColumn(rows, columns, null)).toBe(rows);
  });

  it("honours initialSort and toggles direction on header click", async () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} initialSort={{ key: "units", dir: "desc" }} />);
    expect(bodyOrder()).toEqual(["Beta", "Gamma", "alpha"]);
    await userEvent.click(screen.getByRole("button", { name: /units/i }));
    expect(bodyOrder()).toEqual(["alpha", "Gamma", "Beta"]);
    await userEvent.click(screen.getByRole("button", { name: /name/i }));
    expect(bodyOrder()).toEqual(["alpha", "Beta", "Gamma"]);
  });

  it("activates focusable rows with Enter", async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    const first = screen.getAllByRole("row")[1];
    first.focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("renders the empty slot", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty={<p>Nothing here</p>} />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});

describe("chips", () => {
  it("RiskChip label mapping", () => {
    const expected: Record<RiskLevel, string> = { healthy: "Healthy", monitor: "Monitor", stress: "Stress", critical: "Critical" };
    for (const [level, label] of Object.entries(expected) as [RiskLevel, string][]) {
      expect(riskLabel(level)).toBe(label);
    }
    render(<RiskChip level="critical" />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("StatusChip label mapping", () => {
    const expected: Record<ShipmentStatus, string> = {
      recommended: "Recommended",
      approved: "Approved",
      loading: "Loading",
      in_transit: "In transit",
      delayed: "Delayed",
      arrived: "Arrived",
      delivered: "Delivered",
      cancelled: "Cancelled",
    };
    for (const [s, label] of Object.entries(expected) as [ShipmentStatus, string][]) {
      expect(statusLabel(s)).toBe(label);
    }
    render(<StatusChip status="in_transit" live />);
    expect(screen.getByText("In transit")).toBeInTheDocument();
  });

  it("PriorityChip renders its label", () => {
    render(<PriorityChip priority="high" />);
    expect(screen.getByText("High")).toBeInTheDocument();
  });
});

describe("Avatar", () => {
  it("renders initials with a deterministic series colour", () => {
    const { unmount } = render(<Avatar name="Meera Singh" size={48} />);
    const el = screen.getByRole("img", { name: "Meera Singh" });
    expect(el.textContent).toBe("MS");
    const color = (el as HTMLElement).style.color;
    unmount();
    render(<Avatar name="Meera Singh" size={24} />);
    expect((screen.getByRole("img", { name: "Meera Singh" }) as HTMLElement).style.color).toBe(color);
  });
});

describe("Meter and KpiTile helpers", () => {
  it("auto colour thresholds", () => {
    expect(meterAutoColor(69.9)).toBe("var(--risk-healthy)");
    expect(meterAutoColor(70)).toBe("var(--risk-monitor)");
    expect(meterAutoColor(90)).toBe("var(--risk-monitor)");
    expect(meterAutoColor(90.1)).toBe("var(--risk-critical)");
  });
  it("Meter exposes aria values", () => {
    render(<Meter value={45} max={60} label="Load" />);
    const m = screen.getByRole("meter", { name: "Load" });
    expect(m).toHaveAttribute("aria-valuenow", "45");
    expect(screen.getByText("75%")).toBeInTheDocument();
  });
  it("delta is good when direction equals good", () => {
    expect(deltaIsGood({ value: 3, direction: "down", good: "down" })).toBe(true);
    expect(deltaIsGood({ value: 3, direction: "up", good: "down" })).toBe(false);
  });
});

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
  });
  afterEach(() => {
    clearToasts();
    vi.useRealTimers();
  });

  it("keeps at most three, dropping the oldest", () => {
    for (let i = 0; i < 5; i++) toast({ title: `t${i}`, tone: "info" });
    const items = getToasts();
    expect(items).toHaveLength(MAX_TOASTS);
    expect(items.map((t) => t.title)).toEqual(["t2", "t3", "t4"]);
  });

  it("auto-dismisses after 5s and supports manual dismiss", () => {
    const id = toast({ title: "a", tone: "success" });
    toast({ title: "b", tone: "warning", href: "/x" });
    dismissToast(id);
    expect(getToasts().map((t) => t.title)).toEqual(["b"]);
    vi.advanceTimersByTime(TOAST_MS + 1);
    expect(getToasts()).toHaveLength(0);
  });
});
