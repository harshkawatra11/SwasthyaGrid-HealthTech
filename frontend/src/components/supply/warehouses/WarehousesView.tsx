"use client";

import { useMemo, useState } from "react";
import { KpiTile } from "@/components/ds/KpiTile";
import { PageHeader } from "@/components/ds/PageHeader";
import { Skeleton } from "@/components/ds/Skeleton";
import { useWarehouse, useWarehouses } from "@/lib/api/hooks";
import { fmtInt } from "@/lib/format";
import { useEntityIndex } from "@/lib/entity-index";
import { useScope } from "@/lib/scope";
import { warehousesTitle } from "../lib/metrics";
import { FillColumn } from "../lib/parts";
import { ProvenanceFooter } from "../lib/ProvenanceFooter";
import { WarehouseCapacityBoard } from "./WarehouseCapacityBoard";
import { WarehouseDetail } from "./WarehouseDetail";
import { WarehouseList } from "./WarehouseList";

export function WarehousesView() {
  const { scope } = useScope();
  const idx = useEntityIndex();
  const { data, isLoading } = useWarehouses(scope);
  const warehouses = useMemo(() => data?.items ?? [], [data]);
  const [picked, setPicked] = useState<string | null>(null);

  const defaultId = useMemo(
    () => warehouses.find((w) => w.low_cover_medicines > 0)?.id ?? warehouses[0]?.id ?? null,
    [warehouses],
  );
  const selectedId = picked && warehouses.some((w) => w.id === picked) ? picked : defaultId;
  const { data: detail } = useWarehouse(selectedId);

  const totalCapacity = warehouses.reduce((a, w) => a + w.capacity_pallets, 0);
  const shortCount = warehouses.filter((w) => w.low_cover_medicines > 0).length;
  const coldCount = warehouses.filter((w) => w.cold_room).length;
  const outboundToday = warehouses.reduce((a, w) => a + w.outbound_today, 0);

  if (isLoading && warehouses.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Supply chain / Warehouses" title="Warehouses" />
        <div className="grid gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="mt-4 h-64" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Supply chain / Warehouses"
        title={warehousesTitle(warehouses, idx.warehouseName)}
        description="Every depot's capacity, cold storage and how many medicines are running short of cover."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Depots" value={warehouses.length} hint="In scope" />
        <KpiTile label="Pallet slots" value={fmtInt(totalCapacity)} hint="Combined capacity" />
        <KpiTile label="Cold storage" value={coldCount} hint="Depots with a cold room" />
        <KpiTile label="Short of cover" value={shortCount} tone={shortCount > 0 ? "warning" : "good"} hint={`${outboundToday} shipments leaving depots today`} />
      </div>

      <div className="mt-4">
        <WarehouseCapacityBoard warehouses={warehouses} onSelect={setPicked} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <FillColumn minHeight={640}>
          <WarehouseList warehouses={warehouses} selectedId={selectedId} onSelect={setPicked} />
        </FillColumn>
        <div className="min-w-0">
          {detail ? <WarehouseDetail warehouse={detail} /> : <Skeleton className="h-96" />}
        </div>
      </div>

      <ProvenanceFooter />
    </>
  );
}
