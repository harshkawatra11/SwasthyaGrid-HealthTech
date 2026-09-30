"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ds/Card";
import { KpiTile } from "@/components/ds/KpiTile";
import { PageHeader } from "@/components/ds/PageHeader";
import { Skeleton } from "@/components/ds/Skeleton";
import { runPlanner } from "@/lib/api/mutations";
import { useSchedule, useShipment, useShipments, useVehicle, useVehicles } from "@/lib/api/hooks";
import { useEntityIndex } from "@/lib/entity-index";
import { fmtInt, fmtPct } from "@/lib/format";
import { useScope } from "@/lib/scope";
import { ProvenanceFooter } from "../lib/ProvenanceFooter";
import { depotUtilisation, fleetKpis, fleetTitle, kmToService, planningQueue } from "../lib/metrics";
import { simDayWindow } from "../lib/gantt";
import { Callout, depotLabel, FillColumn, SourceFooter, VehicleStatusChip, vehicleStatusColor } from "../lib/parts";
import { useSimNowMs } from "../lib/useSimNow";
import { DriverCam } from "./DriverCam";
import { ShipmentQueue } from "./ShipmentQueue";
import { TruckVisualization } from "./TruckVisualization";
import { VehicleFacts } from "./VehicleFacts";
import { VehicleList } from "./VehicleList";
import type { VehicleLiveStatus } from "@/lib/api/types";

const SEC = "Supply chain / Fleet";
const STATUS_ORDER: VehicleLiveStatus[] = ["available", "scheduled", "loading", "in_transit", "delayed", "returning", "maintenance"];

export function FleetView() {
  const { scope } = useScope();
  const district = scope === "all" ? undefined : scope;
  const idx = useEntityIndex();
  const { data: vdata, isLoading } = useVehicles({ district_id: district });
  const vehicles = useMemo(() => vdata?.items ?? [], [vdata]);
  const { data: queueData } = useShipments({ status: "recommended,approved", district_id: district, limit: 100, sort: "priority" });
  const { data: sched } = useSchedule(scope);
  const nowMs = useSimNowMs();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kpis = useMemo(() => fleetKpis(vehicles), [vehicles]);
  const queue = useMemo(() => planningQueue(queueData?.items ?? []), [queueData]);
  const depots = useMemo(() => depotUtilisation(vehicles), [vehicles]);

  const defaultId = useMemo(
    () => (vehicles.find((v) => v.current_shipment_id)?.id ?? vehicles[0]?.id ?? null),
    [vehicles],
  );
  const selectedId = picked && vehicles.some((v) => v.id === picked) ? picked : defaultId;
  const { data: detail } = useVehicle(selectedId);
  const { data: activeShipment } = useShipment(detail?.current_shipment_id ?? null);
  const win = sched?.window ?? (nowMs !== null ? simDayWindow(new Date(nowMs).toISOString()) : simDayWindow(new Date().toISOString()));

  async function plan() {
    setBusy(true);
    await runPlanner();
    setBusy(false);
  }

  const statusCounts = STATUS_ORDER.map((s) => ({ s, n: vehicles.filter((v) => v.live_status === s).length })).filter((x) => x.n > 0);
  const dueList = vehicles.filter((v) => v.service_due).sort((a, b) => b.km_since_service - a.km_since_service);
  const topDepot = depots[0];

  if (isLoading && vehicles.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Supply chain / Fleet" title="Fleet" />
        <div className="grid gap-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="mt-4 h-96" />
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Supply chain / Fleet" title={fleetTitle(kpis)} description="Trucks Management: every vehicle, what it carries and when it is next free." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Vehicles" value={kpis.total} hint="Fleet in scope" />
        <KpiTile label="In use" value={kpis.inUse} hint="Loading, moving or returning" />
        <KpiTile label="Available" value={kpis.available} tone="good" hint="Ready to dispatch" />
        <KpiTile label="Maintenance" value={kpis.maintenance} tone={kpis.maintenance > 0 ? "warning" : "default"} hint="Out of service" />
        <KpiTile label="Service due" value={kpis.serviceDue} tone={kpis.serviceDue > 0 ? "warning" : "default"} hint="Past 15,000 km" />
        <KpiTile label="Avg utilisation" value={fmtPct(kpis.avgUtilisation, 1)} hint="Share of 7 days on trips" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_270px]">
        <FillColumn><VehicleList vehicles={vehicles} selectedId={selectedId} onSelect={setPicked} /></FillColumn>
        <div className="min-w-0 space-y-4">
          <TruckVisualization vehicle={detail ?? undefined} />
          {detail && (
            <DriverCam
              driverName={activeShipment?.driver?.name ?? null}
              moving={detail.live_status === "in_transit" || detail.live_status === "delayed"}
            />
          )}
          {detail && <VehicleFacts vehicle={detail} windowStart={win.start} windowEnd={win.end} nowMs={nowMs} />}
        </div>
        <FillColumn className="lg:col-span-2 xl:col-span-1">
          <ShipmentQueue queue={queue} busy={busy} onAutoAssign={plan} onLoad={() => void plan()} />
        </FillColumn>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card eyebrow="Depot utilisation" title={topDepot ? `Busiest: ${depotLabel(idx.warehouseName(topDepot.depotId))}, ${fmtPct(topDepot.utilisationPct, 1)}` : "No depots"} footer={<SourceFooter source="7 day trips over 18 h day, simulator" section={SEC} />}>
          <ul className="space-y-2.5">
            {depots.map((d) => (
              <li key={d.depotId}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="truncate text-text">{depotLabel(idx.warehouseName(d.depotId))}</span>
                  <span className="num shrink-0 text-muted">
                    {d.inUse}/{d.vehicles} in use, {fmtPct(d.utilisationPct, 1)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, (d.utilisationPct / Math.max(0.1, topDepot?.utilisationPct ?? 1)) * 100)}%`, background: "var(--series-1)" }} />
                </div>
              </li>
            ))}
          </ul>
          <Callout className="mt-3">Fleet average is {fmtPct(kpis.avgUtilisation, 1)} of the day on trips. Bars are relative to the busiest depot.</Callout>
        </Card>

        <Card eyebrow="Status mix" title={`${kpis.inUse} of ${kpis.total} vehicles are working now`} footer={<SourceFooter source="live vehicle status" section={SEC} />}>
          <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-sm" role="img" aria-label="Vehicle status mix">
            {statusCounts.map(({ s, n }) => (
              <span key={s} title={`${s.replace("_", " ")}: ${n}`} style={{ width: `${(n / Math.max(1, kpis.total)) * 100}%`, background: vehicleStatusColor(s) }} />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
            {statusCounts.map(({ s, n }) => (
              <li key={s} className="flex items-center justify-between gap-2">
                <VehicleStatusChip status={s} />
                <span className="num text-text">{n}</span>
              </li>
            ))}
          </ul>
          <Callout className="mt-3" tone="amber">{kpis.available} vehicles are idle while {queue.length} shipments wait, run the planner to match them.</Callout>
        </Card>

        <Card eyebrow="Service watchlist" title={dueList.length > 0 ? `${dueList.length} vehicles overdue` : "None overdue"} footer={<SourceFooter source="odometer since last service" section={SEC} />}>
          <ul className="max-h-52 space-y-1.5 overflow-y-auto">
            {dueList.slice(0, 8).map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => setPicked(v.id)} className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-surface-2">
                  <span className="num font-semibold text-text">{v.registration}</span>
                  <span className="truncate text-muted">{v.label}</span>
                  <span className="num shrink-0 text-amber">{fmtInt(Math.round(-kmToService(v.km_since_service)))} km over</span>
                </button>
              </li>
            ))}
            {dueList.length === 0 && <li className="text-[12px] text-muted">All vehicles are within interval.</li>}
          </ul>
        </Card>
      </div>

      <ProvenanceFooter />
    </>
  );
}
