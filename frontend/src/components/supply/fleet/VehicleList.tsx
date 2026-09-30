"use client";

import { useMemo, useState } from "react";
import { Search, Snowflake, Wrench } from "lucide-react";
import { EmptyState } from "@/components/ds/EmptyState";
import { cn } from "@/lib/cn";
import type { VehicleSummary } from "@/lib/api/types";
import { useEntityIndex } from "@/lib/entity-index";
import { depotLabel, PanelCard, VehicleStatusChip } from "../lib/parts";

export function VehicleList({
  vehicles,
  selectedId,
  onSelect,
}: {
  vehicles: VehicleSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const idx = useEntityIndex();
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? vehicles.filter((v) => `${v.registration} ${v.label} ${idx.warehouseName(v.home_warehouse_id)}`.toLowerCase().includes(needle))
      : vehicles;
    return [...list].sort((a, b) => a.home_warehouse_id.localeCompare(b.home_warehouse_id) || a.registration.localeCompare(b.registration));
  }, [vehicles, q, idx]);

  return (
    <PanelCard
      eyebrow="Fleet"
      title={`${vehicles.length} vehicles`}
      footer={<span>Source: fleet master and live simulator</span>}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <label className="relative m-3 block shrink-0">
          <Search size={13} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search registration or depot"
            aria-label="Search vehicles"
            className="h-8 w-full rounded-md border border-border bg-surface-2 pl-8 pr-2 text-[12px] text-text placeholder:text-faint focus:border-brand focus:outline-none"
          />
        </label>
        <ul role="listbox" aria-label="Vehicles" className="min-h-0 flex-1 overflow-y-auto border-t border-border">
          {rows.length === 0 && (
            <li>
              <EmptyState icon={Search} title="No vehicle matches" />
            </li>
          )}
          {rows.map((v) => {
            const selected = v.id === selectedId;
            return (
              <li key={v.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => onSelect(v.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2",
                    selected && "bg-surface-2 shadow-[inset_2px_0_0_var(--brand)]",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="num text-[12px] font-semibold text-text">{v.registration}</span>
                    <VehicleStatusChip status={v.live_status} />
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span className="truncate">{v.label}</span>
                    {v.cold_chain && <Snowflake size={11} aria-label="Cold chain" className="shrink-0 text-cyan" />}
                    {v.service_due && <Wrench size={11} aria-label="Service due" className="shrink-0 text-amber" />}
                  </span>
                  <span className="flex items-center gap-2 text-[10px] text-faint">
                    <span className="truncate">{depotLabel(idx.warehouseName(v.home_warehouse_id))}</span>
                    <span className="ml-auto h-1 w-14 shrink-0 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, v.utilisation_7d * 100)}%`, backgroundColor: "var(--series-1)" }} />
                    </span>
                    <span className="num w-8 shrink-0 text-right">{Math.round(v.utilisation_7d * 100)}%</span>
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
