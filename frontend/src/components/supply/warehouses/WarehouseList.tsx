"use client";

import { useMemo, useState } from "react";
import { Search, Snowflake } from "lucide-react";
import { Chip } from "@/components/ds/chip";
import { EmptyState } from "@/components/ds/EmptyState";
import { cn } from "@/lib/cn";
import type { WarehouseSummary } from "@/lib/api/types";
import { useEntityIndex } from "@/lib/entity-index";
import { PanelCard } from "../lib/parts";

/** Roster pane of the warehouses page: every depot, its district and today's flags. */
export function WarehouseList({
  warehouses,
  selectedId,
  onSelect,
}: {
  warehouses: WarehouseSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const idx = useEntityIndex();
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? warehouses.filter((w) => `${w.name} ${idx.districtName(w.district_id)}`.toLowerCase().includes(needle))
      : warehouses;
    return [...list].sort((a, b) => (b.type === "central" ? 1 : 0) - (a.type === "central" ? 1 : 0) || a.name.localeCompare(b.name));
  }, [warehouses, q, idx]);

  return (
    <PanelCard eyebrow="Warehouses" title={`${warehouses.length} depots`} footer={<span>Source: warehouse master and live stock</span>}>
      <div className="flex min-h-0 flex-1 flex-col">
        <label className="relative m-3 block shrink-0">
          <Search size={13} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or district"
            aria-label="Search warehouses"
            className="h-8 w-full rounded-md border border-border bg-surface-2 pl-8 pr-2 text-[12px] text-text placeholder:text-faint focus:border-brand focus:outline-none"
          />
        </label>
        <ul role="listbox" aria-label="Warehouses" className="min-h-0 flex-1 overflow-y-auto border-t border-border">
          {rows.length === 0 && (
            <li>
              <EmptyState icon={Search} title="No warehouse matches" />
            </li>
          )}
          {rows.map((w) => {
            const selected = w.id === selectedId;
            return (
              <li key={w.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => onSelect(w.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2",
                    selected && "bg-surface-2 shadow-[inset_2px_0_0_var(--brand)]",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold text-text">{w.name}</span>
                    {w.type === "central" && <Chip label="Central" color="var(--brand)" size="sm" />}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span className="truncate">{idx.districtName(w.district_id)}</span>
                    {w.cold_room && <Snowflake size={11} aria-label="Cold room" className="shrink-0 text-cyan" />}
                  </span>
                  <span className="num flex items-center gap-2 text-[10px] text-faint">
                    <span>{w.capacity_pallets} pallets, {w.docks} docks</span>
                    {w.low_cover_medicines > 0 && (
                      <span className="ml-auto shrink-0 text-amber">{w.low_cover_medicines} short</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </PanelCard>
  );
}
