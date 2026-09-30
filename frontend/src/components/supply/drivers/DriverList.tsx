"use client";

import { useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import { Avatar } from "@/components/ds/Avatar";
import { EmptyState } from "@/components/ds/EmptyState";
import { cn } from "@/lib/cn";
import type { DriverSummary } from "@/lib/api/types";
import { useEntityIndex } from "@/lib/entity-index";
import { DRIVER_HOURS_LIMIT } from "../lib/metrics";
import { depotLabel, DriverStatusChip, PanelCard } from "../lib/parts";

/** Roster pane of the drivers page (reference image 3, left list). */
export function DriverList({
  drivers,
  selectedId,
  onSelect,
}: {
  drivers: DriverSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const idx = useEntityIndex();
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? drivers.filter((d) => `${d.name} ${idx.warehouseName(d.home_warehouse_id)}`.toLowerCase().includes(needle))
      : drivers;
    return [...list].sort((a, b) => a.home_warehouse_id.localeCompare(b.home_warehouse_id) || a.name.localeCompare(b.name));
  }, [drivers, q, idx]);

  return (
    <PanelCard eyebrow="Drivers" title={`${drivers.length} on roster`} footer={<span>Source: driver roster and live simulator</span>}>
      <div className="flex min-h-0 flex-1 flex-col">
        <label className="relative m-3 block shrink-0">
          <Search size={13} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or depot"
            aria-label="Search drivers"
            className="h-8 w-full rounded-md border border-border bg-surface-2 pl-8 pr-2 text-[12px] text-text placeholder:text-faint focus:border-brand focus:outline-none"
          />
        </label>
        <ul role="listbox" aria-label="Drivers" className="min-h-0 flex-1 overflow-y-auto border-t border-border">
          {rows.length === 0 && (
            <li>
              <EmptyState icon={Search} title="No driver matches" />
            </li>
          )}
          {rows.map((d) => {
            const selected = d.id === selectedId;
            const near = d.hours_today >= DRIVER_HOURS_LIMIT - 1 && d.live_status === "driving";
            return (
              <li key={d.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => onSelect(d.id)}
                  className={cn(
                    "flex w-full items-start gap-2.5 border-b border-border px-3 py-1.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2",
                    selected && "bg-surface-2 shadow-[inset_2px_0_0_var(--brand)]",
                  )}
                >
                  <Avatar name={d.name} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-semibold text-text">{d.name}</span>
                      <DriverStatusChip status={d.live_status} />
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                      <Star size={10} aria-hidden className="fill-amber text-amber" />
                      <span className="num">{d.rating.toFixed(1)}</span>
                      <span className="truncate">{depotLabel(idx.warehouseName(d.home_warehouse_id))}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[10px] text-faint">
                      <span className="truncate">{d.current_shipment_id ?? "Unassigned"}</span>
                      <span className={cn("num ml-auto", near && "font-semibold text-amber")}>
                        {d.hours_today.toFixed(1)}/{DRIVER_HOURS_LIMIT} h
                      </span>
                    </span>
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
