"use client";

import Link from "next/link";
import { ArrowRight, PackageCheck, Snowflake, Wand2 } from "lucide-react";
import { EmptyState } from "@/components/ds/EmptyState";
import { PriorityChip } from "@/components/ds/PriorityChip";
import { fmtKg } from "@/lib/format";
import type { ShipmentSummary } from "@/lib/api/types";
import { PanelCard } from "../lib/parts";

/** Reference image 1 "Shipment Queue": id, priority chip, small Load button, Auto Assign in the header. */
export function ShipmentQueue({
  queue,
  onLoad,
  onAutoAssign,
  busy,
  className,
}: {
  queue: ShipmentSummary[];
  onLoad: (id: string) => void;
  onAutoAssign: () => void;
  busy: boolean;
  className?: string;
}) {
  return (
    <PanelCard
      eyebrow="Shipment queue"
      title={`${queue.length} waiting`}
      actions={
        <button
          type="button"
          onClick={onAutoAssign}
          disabled={busy || queue.length === 0}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-2.5 text-[11px] font-medium text-text transition-colors hover:bg-surface-3 disabled:opacity-50"
        >
          <Wand2 size={12} aria-hidden />
          Auto assign
        </button>
      }
      footer={
        <span className="flex items-center justify-between">
          <span>Source: planner queue, live</span>
          <Link href="/supply/planning" className="inline-flex items-center gap-1 text-brand hover:underline">
            Load planning <ArrowRight size={11} aria-hidden />
          </Link>
        </span>
      }
      className={className}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {queue.length === 0 ? (
          <EmptyState icon={PackageCheck} title="Queue is clear" body="Every approved shipment has a vehicle." />
        ) : (
          <ul>
            {queue.map((s) => (
              <li key={s.id} className="flex items-center gap-2 border-b border-border px-3 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/supply/shipments/${s.id}`} className="num text-[12px] font-semibold text-text hover:text-brand">
                      {s.id}
                    </Link>
                    <PriorityChip priority={s.priority} size="sm" />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted">{s.destination.name}</p>
                  <p className="num mt-0.5 flex items-center gap-1.5 text-[10px] text-faint">
                    {fmtKg(s.weight_kg)}
                    <span aria-hidden>/</span>
                    {s.pallet_slots} {s.pallet_slots === 1 ? "pallet" : "pallets"}
                    {s.cold_chain && <Snowflake size={10} aria-label="Cold chain" className="text-cyan" />}
                  </p>
                  {s.blocked_reason && <p className="mt-0.5 truncate text-[10px] text-amber">Blocked: {s.blocked_reason}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => onLoad(s.id)}
                  disabled={busy || !!s.blocked_reason}
                  className="h-6 shrink-0 rounded-md bg-brand px-2.5 text-[11px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                  aria-label={`Load ${s.id}`}
                >
                  Load
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PanelCard>
  );
}
