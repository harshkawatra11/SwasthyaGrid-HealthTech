"use client";

import { useMemo, useState } from "react";
import { KpiTile } from "@/components/ds/KpiTile";
import { PageHeader } from "@/components/ds/PageHeader";
import { Skeleton } from "@/components/ds/Skeleton";
import { useDriver, useDrivers, useSchedule, useWarehouses } from "@/lib/api/hooks";
import { fmtPct } from "@/lib/format";
import { useScope } from "@/lib/scope";
import { simDayWindow } from "../lib/gantt";
import { DRIVER_HOURS_LIMIT, driversTitle } from "../lib/metrics";
import { FillColumn } from "../lib/parts";
import { ProvenanceFooter } from "../lib/ProvenanceFooter";
import { useSimNowMs } from "../lib/useSimNow";
import { DriverList } from "./DriverList";
import { DriverMap } from "./DriverMap";
import { DriverPanel } from "./DriverPanel";

export function DriversView() {
  const { scope } = useScope();
  const district = scope === "all" ? undefined : scope;
  const { data: dData, isLoading } = useDrivers({ district_id: district });
  const drivers = useMemo(() => dData?.items ?? [], [dData]);
  const { data: wData } = useWarehouses(scope);
  const warehouses = useMemo(() => wData?.items ?? [], [wData]);
  const { data: sched } = useSchedule(scope);
  const nowMs = useSimNowMs();
  const [picked, setPicked] = useState<string | null>(null);

  const defaultId = useMemo(
    () => drivers.find((d) => d.live_status === "driving")?.id ?? drivers[0]?.id ?? null,
    [drivers],
  );
  const selectedId = picked && drivers.some((d) => d.id === picked) ? picked : defaultId;
  const { data: detail } = useDriver(selectedId);
  const win = sched?.window ?? simDayWindow(new Date(nowMs ?? 0).toISOString());

  const driverByShipment = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) if (d.current_shipment_id) m.set(d.current_shipment_id, d.id);
    return m;
  }, [drivers]);

  const onRoad = drivers.filter((d) => d.live_status === "driving").length;
  const nearLimit = drivers.filter((d) => d.hours_today >= DRIVER_HOURS_LIMIT - 1).length;
  const avgOnTime = drivers.length
    ? drivers.reduce((a, d) => a + d.on_time_rate_30d, 0) / drivers.length
    : 0;
  const avgRating = drivers.length ? drivers.reduce((a, d) => a + d.rating, 0) / drivers.length : 0;

  if (isLoading && drivers.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Supply chain / Drivers" title="Drivers" />
        <div className="grid gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="mt-4 h-96" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Supply chain / Drivers"
        title={driversTitle(drivers)}
        description="Fleet and driver panel: every driver on shift, where they are, and hours against the daily limit."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Drivers" value={drivers.length} hint="On roster in scope" />
        <KpiTile label="On the road" value={onRoad} tone="good" hint="Driving right now" />
        <KpiTile label="Near hour limit" value={nearLimit} tone={nearLimit > 0 ? "warning" : "default"} hint={`Within 1 h of the ${DRIVER_HOURS_LIMIT} h limit`} />
        <KpiTile label="Avg on time, 30d" value={fmtPct(avgOnTime * 100, 1)} hint={`Avg rating ${avgRating.toFixed(1)}`} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <FillColumn minHeight={440}>
          <DriverList drivers={drivers} selectedId={selectedId} onSelect={setPicked} />
        </FillColumn>
        <FillColumn minHeight={440}>
          <DriverMap
            warehouses={warehouses}
            selectedShipmentId={detail?.current_shipment_id ?? null}
            onSelectShipment={(shipmentId) => {
              const id = driverByShipment.get(shipmentId);
              if (id) setPicked(id);
            }}
            activeCount={onRoad}
          />
        </FillColumn>
        <FillColumn minHeight={440}>
          {detail ? (
            <div className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)]">
              <DriverPanel driver={detail} windowStart={win.start} windowEnd={win.end} nowMs={nowMs} />
            </div>
          ) : (
            <Skeleton className="h-full" />
          )}
        </FillColumn>
      </div>

      <ProvenanceFooter />
    </>
  );
}
