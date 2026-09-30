"use client";

import Link from "next/link";
import { PackageCheck, Play, Snowflake } from "lucide-react";
import { EmptyState } from "@/components/ds/EmptyState";
import { PriorityChip } from "@/components/ds/PriorityChip";
import { StatusChip } from "@/components/ds/StatusChip";
import { fmtKg } from "@/lib/format";
import type { ShipmentSummary } from "@/lib/api/types";
import { PanelCard } from "../lib/parts";

/** Approved or recommended shipments waiting for a vehicle, with blocked reasons and the planner trigger. */
export function PlanningQueue({
  queue,
  busy,
  onRun,
}: {
  queue: ShipmentSummary[];
  busy: boolean;
  onRun: () => void;
}) {
  return (
    <PanelCard
      eyebrow="Load planning"
      title={`${queue.length} in queue`}
      actions={
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[11px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Play size={11} aria-hidden />
          {busy ? "Running" : "Run planner now"}
        </button>
      }
      footer={<span>Source: planner queue, live. Supply chain / Load planning</span>}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {queue.length === 0 ? (
          <EmptyState icon={PackageCheck} title="Nothing is waiting" body="Every approved shipment already has a vehicle and driver." />
        ) : (
          <ul>
            {queue.map((s) => (
              <li key={s.id} className="border-b border-border px-4 py-2.5 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/supply/shipments/${s.id}`} className="num text-[12px] font-semibold text-text hover:text-brand">
                    {s.id}
                  </Link>
                  <span className="flex items-center gap-1.5">
                    <PriorityChip priority={s.priority} size="sm" />
                    <StatusChip status={s.status} size="sm" />
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-muted">
                  {s.origin.name.replace(/^District Drug Warehouse, /, "").replace(/^State Central Drug Warehouse, /, "Central, ")} to{" "}
                  <span className="text-text">{s.destination.name}</span>
                </p>
                <p className="num mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                  {fmtKg(s.weight_kg)}
                  <span aria-hidden>/</span>
                  {s.pallet_slots} {s.pallet_slots === 1 ? "pallet" : "pallets"}
                  {s.cold_chain && (
                    <span className="inline-flex items-center gap-1 text-cyan">
                      <Snowflake size={11} aria-hidden /> Cold chain
                    </span>
                  )}
                </p>
                {s.blocked_reason && (
                  <p className="mt-1 rounded-sm bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] px-2 py-1 text-[11px] text-amber">
                    Blocked: {s.blocked_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PanelCard>
  );
}
