"use client";

import { useMemo } from "react";
import { Snowflake, Truck } from "lucide-react";
import { Card } from "@/components/ds/Card";
import { Chip } from "@/components/ds/chip";
import { fmtInt } from "@/lib/format";
import type { WarehouseSummary } from "@/lib/api/types";
import { Callout, depotLabel, SourceFooter } from "../lib/parts";

const SEC = "Supply chain / Warehouses";

/** Hero of the warehouses page: every depot's pallet capacity, docks, cold storage and cover flag, one bar per row. */
export function WarehouseCapacityBoard({ warehouses, onSelect }: { warehouses: WarehouseSummary[]; onSelect: (id: string) => void }) {
  const maxCapacity = Math.max(1, ...warehouses.map((w) => w.capacity_pallets));
  const rows = useMemo(() => [...warehouses].sort((a, b) => b.capacity_pallets - a.capacity_pallets), [warehouses]);
  const shortCount = warehouses.filter((w) => w.low_cover_medicines > 0).length;

  return (
    <Card
      eyebrow="Capacity board"
      title={`${fmtInt(warehouses.reduce((a, w) => a + w.capacity_pallets, 0))} pallet slots across ${warehouses.length} depots`}
      footer={<SourceFooter source="warehouse master, live stock and reservations" section={SEC} />}
    >
      <ul className="space-y-2.5">
        {rows.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => onSelect(w.id)}
              className="flex w-full items-center gap-3 rounded-sm px-1 py-1 text-left transition-colors hover:bg-surface-2"
            >
              <span className="w-40 shrink-0 truncate text-[12px] text-text">{depotLabel(w.name)}</span>
              <span className="h-3 flex-1 overflow-hidden rounded-sm bg-surface-3" aria-hidden>
                <span
                  className="block h-full rounded-sm"
                  style={{ width: `${(w.capacity_pallets / maxCapacity) * 100}%`, background: w.type === "central" ? "var(--brand)" : "var(--series-1)" }}
                />
              </span>
              <span className="num w-20 shrink-0 text-right text-[11px] text-muted">{fmtInt(w.capacity_pallets)} pallets</span>
              <span className="num flex w-10 shrink-0 items-center gap-1 text-[11px] text-faint">{w.docks} dk</span>
              <span className="w-6 shrink-0">{w.cold_room && <Snowflake size={12} aria-label="Cold room" className="text-cyan" />}</span>
              <span className="num flex w-12 shrink-0 items-center justify-end gap-1 text-[11px] text-faint">
                <Truck size={11} aria-hidden />
                {w.outbound_today}
              </span>
              <span className="w-24 shrink-0 text-right">
                {w.low_cover_medicines > 0 ? (
                  <Chip label={`${w.low_cover_medicines} short`} color="var(--amber)" size="sm" />
                ) : (
                  <Chip label="Covered" color="var(--green)" size="sm" />
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Callout className="mt-3" tone={shortCount > 0 ? "amber" : "brand"}>
        {shortCount > 0
          ? `${shortCount} of ${warehouses.length} depots have at least one medicine under 7 days of cover. Click a row for its stock table.`
          : "Every depot has every medicine over 7 days of cover. Click a row for its stock table."}
      </Callout>
    </Card>
  );
}
