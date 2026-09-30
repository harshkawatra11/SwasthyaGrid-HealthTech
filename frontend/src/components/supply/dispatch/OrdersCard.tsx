"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Snowflake } from "lucide-react";
import { EmptyState } from "@/components/ds/EmptyState";
import { Select } from "@/components/ds/Select";
import { StatusChip } from "@/components/ds/StatusChip";
import { cn } from "@/lib/cn";
import { withScope } from "@/lib/scope";
import { useScope } from "@/lib/scope";
import { fmtDateTime, fmtKg } from "@/lib/format";
import type { ShipmentSummary } from "@/lib/api/types";
import { ORDER_PERIOD_LABEL, filterOrders, sortOrders, type OrderPeriod } from "./helpers";
import { SourceLine } from "./SourceLine";

/** Route block from the reference: filled marker on top, dashed line, diamond at the bottom. */
function OrderRoute({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex gap-3">
      <div aria-hidden className="flex w-3 shrink-0 flex-col items-center pt-1">
        <span className="h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-text-muted" style={{ borderTopColor: "var(--text-muted)" }} />
        <span className="my-1 w-px flex-1 border-l border-dashed border-border-strong" />
        <span className="h-2 w-2 rotate-45 bg-text-muted" style={{ background: "var(--text-muted)" }} />
      </div>
      <div className="min-w-0 flex-1 text-[12px]">
        <p className="mb-1.5 text-[11px] text-faint">Shipment Route</p>
        <p className="mb-3 leading-snug text-text">{from}</p>
        <p className="leading-snug text-text">{to}</p>
      </div>
    </div>
  );
}

function OrderRow({
  s,
  selected,
  onSelect,
  href,
}: {
  s: ShipmentSummary;
  selected: boolean;
  onSelect: (id: string) => void;
  href: string;
}) {
  return (
    <li
      className={cn(
        "border-b border-border px-4 py-3.5 transition-colors last:border-b-0",
        selected ? "bg-surface-2 shadow-[inset_2px_0_0_var(--brand)]" : "hover:bg-surface-2/60",
      )}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSelect(s.id)}
            aria-pressed={selected}
            aria-label={`Select ${s.id} on the map`}
            className="num text-[13px] font-medium text-text hover:text-brand"
          >
            {s.id}
          </button>
          <StatusChip status={s.status} size="sm" live />
          {s.cold_chain && (
            <span title="Cold chain" className="inline-flex text-cyan">
              <Snowflake size={13} aria-label="Cold chain" />
            </span>
          )}
        </div>
        <Link href={href} prefetch={false} aria-label={`Open tracking for ${s.id}`} className="rounded-sm p-1 text-muted hover:bg-surface-3 hover:text-text">
          <ArrowUpRight size={14} />
        </Link>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <OrderRoute from={s.origin.name} to={s.destination.name} />
        <dl className="min-w-[92px] text-right text-[12px]">
          <dt className="text-[11px] text-faint">Est. delivery</dt>
          <dd className="num mb-3 text-text">{s.eta ? fmtDateTime(s.eta) : "Pending"}</dd>
          <dt className="text-[11px] text-faint">Total weight</dt>
          <dd className="num text-text">{fmtKg(s.weight_kg)}</dd>
        </dl>
      </div>
    </li>
  );
}

export function OrdersCard({
  shipments,
  total,
  simNow,
  selectedId,
  onSelect,
}: {
  shipments: readonly ShipmentSummary[];
  total: number;
  simNow: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { scope } = useScope();
  const [period, setPeriod] = useState<OrderPeriod>("all");
  const rows = useMemo(() => sortOrders(filterOrders([...shipments], period, simNow)), [shipments, period, simNow]);

  return (
    <section className="flex h-full flex-col rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)]">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="eyebrow">Orders</p>
          <h3 className="num text-[13px] font-semibold text-text">Total: {total}</h3>
        </div>
        <Select
          ariaLabel="Orders period"
          value={period}
          onValueChange={(v) => setPeriod(v as OrderPeriod)}
          options={(Object.keys(ORDER_PERIOD_LABEL) as OrderPeriod[]).map((p) => ({ value: p, label: ORDER_PERIOD_LABEL[p] }))}
        />
      </header>
      {rows.length === 0 ? (
        <div className="flex-1 p-4">
          <EmptyState icon={ArrowUpRight} title="No orders in this window" body="Widen the period to see earlier shipments." />
        </div>
      ) : (
        <ul data-testid="orders-list" className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((s) => (
            <OrderRow
              key={s.id}
              s={s}
              selected={s.id === selectedId}
              onSelect={onSelect}
              href={withScope(`/supply/shipments/${s.id}`, scope)}
            />
          ))}
        </ul>
      )}
      <footer className="border-t border-border px-4 py-2 text-[11px] text-faint">
        <SourceLine source="simulated shipment ledger" sub="Supply chain / Dispatch" />
      </footer>
    </section>
  );
}
