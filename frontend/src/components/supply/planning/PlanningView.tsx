"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ds/Card";
import { KpiTile } from "@/components/ds/KpiTile";
import { Skeleton } from "@/components/ds/Skeleton";
import { useLogisticsKpis, useSchedule, useShipments, useVehicles } from "@/lib/api/hooks";
import { runPlanner } from "@/lib/api/mutations";
import { useEntityIndex } from "@/lib/entity-index";
import { fmtInt, fmtKg } from "@/lib/format";
import { useScope } from "@/lib/scope";
import { simDayWindow } from "../lib/gantt";
import { fleetKpis, planningQueue, planningTitle, queueTotals } from "../lib/metrics";
import { Callout, SourceFooter } from "../lib/parts";
import { ProvenanceFooter } from "../lib/ProvenanceFooter";
import { useSimNowMs } from "../lib/useSimNow";
import { FleetGantt } from "./FleetGantt";
import { PlanningQueue } from "./PlanningQueue";
import { FillColumn } from "../lib/parts";

const SEC = "Supply chain / Load planning";

export function PlanningView() {
  const { scope } = useScope();
  const district = scope === "all" ? undefined : scope;
  const idx = useEntityIndex();
  const { data: sched, isLoading } = useSchedule(scope);
  const { data: qd } = useShipments({ status: "recommended,approved", district_id: district, limit: 100, sort: "priority" });
  const { data: vd } = useVehicles({ district_id: district });
  const { data: kp } = useLogisticsKpis(scope);
  const nowMs = useSimNowMs();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const queue = useMemo(() => planningQueue(qd?.items ?? []), [qd]);
  const totals = useMemo(() => queueTotals(queue), [queue]);
  const fleet = useMemo(() => fleetKpis(vd?.items ?? []), [vd]);
  const alerts = fleet.serviceDue + (kp?.cold_chain_breaches_today ?? 0);

  const rows = useMemo(() => sched?.rows ?? [], [sched]);
  const vehicleId = picked ?? rows.find((r) => r.trips.length > 0)?.vehicle.id ?? rows[0]?.vehicle.id ?? null;
  const win = sched?.window ?? simDayWindow(new Date(nowMs ?? 0).toISOString());

  async function run() {
    setBusy(true);
    await runPlanner();
    setBusy(false);
  }

  const withTrips = rows.filter((r) => r.trips.length > 0).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">Supply chain / Load planning</p>
          <h1 className="text-[22px] font-semibold leading-tight text-text">{planningTitle(totals)}</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">Load Planning: what is queued, what is blocked and how the fleet is booked through the day.</p>
        </div>
        <div className="flex items-end gap-6" aria-label="Queue totals">
          <div>
            <p className="eyebrow">Weight</p>
            <p className="num text-[26px] font-semibold leading-tight text-text">{fmtKg(totals.weightKg)}</p>
          </div>
          <div>
            <p className="eyebrow">Pallets</p>
            <p className="num text-[26px] font-semibold leading-tight text-text">{fmtInt(totals.pallets)}</p>
          </div>
          <div>
            <p className="eyebrow">Alerts</p>
            <p className="mt-1">
              <span className="num inline-block rounded-full px-3 py-0.5 text-[20px] font-semibold" style={{ background: "var(--violet)", color: "var(--surface-1)" }}>
                {alerts}
              </span>
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Queued shipments" value={totals.count} hint="Approved or recommended, no vehicle" />
        <KpiTile label="Blocked" value={totals.blocked} tone={totals.blocked > 0 ? "warning" : "default"} hint="Planner cannot place them yet" />
        <KpiTile label="Cold chain queued" value={totals.cold} hint="Need a refrigerated vehicle" />
        <KpiTile label="Vehicles free" value={fleet.available} tone="good" hint={`${fleet.serviceDue} service due, ${kp?.cold_chain_breaches_today ?? 0} reefer breaches`} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(300px,1fr)_minmax(0,2.1fr)]">
        <FillColumn minHeight={560}>
          <PlanningQueue queue={queue} busy={busy} onRun={run} />
        </FillColumn>
        <Card
          eyebrow="Fleet Gantt"
          title={`${withTrips} of ${rows.length} vehicles have trips today`}
          live
          footer={<SourceFooter source="planner schedule, sim day 05:00 to 23:00 IST" section={SEC} />}
        >
          {isLoading && rows.length === 0 ? (
            <Skeleton className="h-96" />
          ) : (
            <FleetGantt
              rows={rows}
              windowStart={win.start}
              windowEnd={win.end}
              nowMs={nowMs}
              selectedVehicleId={vehicleId}
              onSelectVehicle={setPicked}
              depotName={idx.warehouseName}
              maxHeight={480}
            />
          )}
          <Callout className="mt-3" tone="violet">
            Read: click a bar to open the shipment. The red line is simulated time and moves once a second.
          </Callout>
        </Card>
      </div>

      <ProvenanceFooter />
    </>
  );
}
