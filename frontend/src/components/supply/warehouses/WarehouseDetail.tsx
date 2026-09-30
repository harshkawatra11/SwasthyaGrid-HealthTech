"use client";

import Link from "next/link";
import { Snowflake, Warehouse as WarehouseIcon } from "lucide-react";
import { Card } from "@/components/ds/Card";
import { Chip } from "@/components/ds/chip";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Meter } from "@/components/ds/Meter";
import { StatBlock } from "@/components/ds/StatBlock";
import { StatusChip } from "@/components/ds/StatusChip";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { ShipmentSummary, WarehouseDetail as WarehouseDetailType } from "@/lib/api/types";
import { useEntityIndex } from "@/lib/entity-index";
import { coverTone, type StockRow } from "../lib/metrics";
import { Callout, SourceFooter } from "../lib/parts";

const SEC = "Supply chain / Warehouses";
const COVER_COLOR = { critical: "var(--red)", stress: "var(--amber)", healthy: "var(--green)", monitor: "var(--text-muted)" } as const;

export function warehouseDetailTitle(w: WarehouseDetailType): string {
  const short = w.stock.filter((s) => s.days_of_cover !== null && s.days_of_cover < 7).length;
  if (short === 0) return `${w.name.split(",")[0]} has every medicine over 7 days of cover`;
  return `${w.name.split(",")[0]} has ${short} ${short === 1 ? "medicine" : "medicines"} under 7 days of cover`;
}

/** Detail pane of the warehouses page: capacity facts, stock cover table and outbound shipments. */
export function WarehouseDetail({ warehouse }: { warehouse: WarehouseDetailType }) {
  const idx = useEntityIndex();
  const cols: Column<StockRow>[] = [
    { key: "medicine", header: "Medicine", accessor: (r) => r.medicine_name, cell: (r) => <span className="text-text">{r.medicine_name}</span> },
    { key: "units", header: "Units", accessor: (r) => r.units, align: "right", mono: true, sortable: true },
    { key: "reserved", header: "Reserved", accessor: (r) => r.reserved, align: "right", mono: true },
    {
      key: "cover",
      header: "Days of cover",
      accessor: (r) => r.days_of_cover ?? -1,
      sortable: true,
      cell: (r) => (
        <div className="flex w-32 items-center gap-2">
          <Meter value={r.days_of_cover ?? 0} max={21} tone={coverTone(r.days_of_cover)} showValue={false} />
          <span className="num shrink-0 text-[11px]" style={{ color: COVER_COLOR[coverTone(r.days_of_cover)] }}>
            {r.days_of_cover === null ? "n/a" : `${r.days_of_cover.toFixed(1)}d`}
          </span>
        </div>
      ),
    },
    {
      key: "expiry",
      header: "Expiry",
      accessor: (r) => r.expiry_date ?? "",
      cell: (r) => (
        <span className={r.expiring_soon ? "text-amber" : "text-muted"}>
          {r.expiry_date ?? "-"}
          {r.expiring_soon && " (soon)"}
        </span>
      ),
    },
  ];

  const outCols: Column<ShipmentSummary>[] = [
    {
      key: "id",
      header: "Shipment",
      accessor: (r) => r.id,
      cell: (r) => (
        <Link href={`/supply/shipments/${r.id}`} className="num text-text hover:text-brand">
          {r.id}
        </Link>
      ),
    },
    { key: "dest", header: "Destination", accessor: (r) => r.destination.name, cell: (r) => <span className="text-muted">{r.destination.name}</span> },
    { key: "status", header: "Status", accessor: (r) => r.status, cell: (r) => <StatusChip status={r.status} size="sm" /> },
    { key: "at", header: "Planned", accessor: (r) => r.planned_start ?? "", align: "right", mono: true, cell: (r) => (r.planned_start ? fmtDateTime(r.planned_start) : "-") },
  ];

  return (
    <div className="space-y-4">
      <Card
        eyebrow="Depot"
        title={warehouse.name}
        actions={warehouse.type === "central" ? <Chip label="Central" color="var(--brand)" size="sm" /> : undefined}
        footer={<SourceFooter source="warehouse master" section={SEC} />}
      >
        <div className="flex items-start gap-3">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
            <WarehouseIcon size={18} aria-hidden />
          </span>
          <StatBlock
            columns={4}
            items={[
              { label: "District", value: idx.districtName(warehouse.district_id) },
              { label: "Capacity", value: `${fmtInt(warehouse.capacity_pallets)} pallets`, mono: true },
              { label: "Docks", value: warehouse.docks, mono: true },
              { label: "Cold room", value: warehouse.cold_room ? "Yes" : "No" },
            ]}
          />
        </div>
      </Card>

      <Card
        eyebrow="Stock cover"
        title={warehouseDetailTitle(warehouse)}
        actions={warehouse.cold_room ? <Snowflake size={14} aria-label="Cold storage on site" className="text-cyan" /> : undefined}
        footer={<SourceFooter source="stock ledger, live reservations" section={SEC} />}
      >
        <div className="overflow-hidden rounded-md border border-border">
          <DataTable
            columns={cols}
            rows={warehouse.stock}
            rowKey={(r) => r.medicine_name}
            density="compact"
            initialSort={{ key: "cover", dir: "asc" }}
            maxHeight={280}
            empty={<p className="p-3 text-[12px] text-muted">No stock recorded.</p>}
          />
        </div>
        <Callout className="mt-3" tone={warehouse.low_cover_medicines > 0 ? "amber" : "brand"}>
          Read: sorted by lowest cover first. Rows under 3 days are critical, under 7 are stress.
        </Callout>
      </Card>

      <Card eyebrow="Outbound today" title={`${warehouse.outbound.length} shipments leaving this depot`} footer={<SourceFooter source="planner assignments" section={SEC} />}>
        <div className="overflow-hidden rounded-md border border-border">
          <DataTable
            columns={outCols}
            rows={warehouse.outbound}
            rowKey={(r) => r.id}
            density="compact"
            stickyHeader={false}
            maxHeight={220}
            empty={<p className="p-3 text-[12px] text-muted">No shipments left this depot today.</p>}
          />
        </div>
      </Card>
    </div>
  );
}
