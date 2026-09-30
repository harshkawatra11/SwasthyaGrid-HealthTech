"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card } from "@/components/ds/Card";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { KpiTile } from "@/components/ds/KpiTile";
import { StatusChip } from "@/components/ds/StatusChip";
import { useLogisticsKpis, useVolumeSeries } from "@/lib/api/hooks";
import type { ShipmentSummary } from "@/lib/api/types";
import { fmtDuration } from "@/lib/format";
import { useScope, withScope } from "@/lib/scope";
import { fmtRate } from "./helpers";
import { SourceLine } from "./SourceLine";

export function KpiBand() {
  const { scope } = useScope();
  const { data: k } = useLogisticsKpis(scope);
  const { data: series } = useVolumeSeries(scope, 90);
  const pts = useMemo(() => (series?.points ?? []).slice(-14), [series]);
  const delayed = k?.delayed_now ?? 0;
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6" data-testid="kpi-band">
      <KpiTile label="Delivered today" value={k?.delivered_today ?? "-"} sparkline={pts.map((p) => p.delivered)} hint="Proof of delivery confirmed" />
      <KpiTile label="In transit now" value={k?.in_transit_now ?? "-"} sparkline={pts.map((p) => p.shipments)} hint="Trucks on the road" href={withScope("/supply", scope)} />
      <KpiTile label="Delayed now" value={delayed} tone={delayed > 0 ? "warning" : "good"} hint="Incident or slip over 10 min" />
      <KpiTile label="On-time, 7 days" value={fmtRate(k?.on_time_rate_7d)} sparkline={pts.map((p) => p.on_time_rate * 100)} hint="Arrivals within plan + 10 min" />
      <KpiTile
        label="Avg transit, 7 days"
        value={k?.avg_transit_hours_7d != null ? fmtDuration(k.avg_transit_hours_7d * 60) : "-"}
        sparkline={pts.map((p) => p.avg_transit_hours)}
        hint="Departure to arrival"
      />
      <KpiTile label="Awaiting approval" value={k?.pending_approvals ?? "-"} tone={(k?.pending_approvals ?? 0) > 10 ? "warning" : "default"} hint="Recommended, not yet dispatched" href="/recommendations" />
    </div>
  );
}

function exceptionRows(items: readonly ShipmentSummary[]): ShipmentSummary[] {
  return items
    .filter((s) => s.status === "delayed" || (s.status === "approved" && s.blocked_reason) || s.delay_minutes >= 30)
    .filter((s) => s.status !== "delivered" && s.status !== "cancelled")
    .sort((a, b) => b.delay_minutes - a.delay_minutes)
    .slice(0, 8);
}

export function ExceptionsCard({ shipments }: { shipments: readonly ShipmentSummary[] }) {
  const { scope } = useScope();
  const rows = useMemo(() => exceptionRows(shipments), [shipments]);
  const maxDelay = Math.max(30, ...rows.map((r) => r.delay_minutes));
  const cols: Column<ShipmentSummary>[] = [
    {
      key: "id",
      header: "Shipment",
      accessor: (r) => r.id,
      cell: (r) => (
        <Link href={withScope(`/supply/shipments/${r.id}`, scope)} className="num text-brand hover:underline">
          {r.id}
        </Link>
      ),
    },
    { key: "status", header: "Status", accessor: (r) => r.status, cell: (r) => <StatusChip status={r.status} size="sm" /> },
    { key: "dest", header: "Destination", accessor: (r) => r.destination.name },
    {
      key: "delay",
      header: "Delay",
      accessor: (r) => r.delay_minutes,
      sortable: true,
      cell: (r) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (r.delay_minutes / maxDelay) * 100)}%`, background: "var(--status-delayed)" }} />
          </div>
          <span className="num text-muted">{fmtDuration(r.delay_minutes)}</span>
        </div>
      ),
    },
    { key: "why", header: "Reason", accessor: (r) => r.blocked_reason ?? "", cell: (r) => <span className="text-muted">{r.blocked_reason ?? (r.status === "delayed" ? "Incident on route" : "Behind plan")}</span> },
  ];
  return (
    <Card
      eyebrow="Exceptions"
      title={rows.length === 0 ? "No shipment is behind plan" : `${rows.length} shipments are behind plan or blocked`}
      footer={<SourceLine source="simulated shipment ledger; delay is projected arrival minus promised arrival" sub="Supply chain / Dispatch" />}
    >
      <div className="-m-4">
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} density="compact" maxHeight={240} initialSort={{ key: "delay", dir: "desc" }} empty={<p className="p-4 text-muted">All clear.</p>} />
      </div>
    </Card>
  );
}
