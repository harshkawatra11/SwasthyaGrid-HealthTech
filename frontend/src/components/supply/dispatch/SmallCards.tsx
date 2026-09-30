"use client";

import { useMemo } from "react";
import { Card } from "@/components/ds/Card";
import { Skeleton } from "@/components/ds/Skeleton";
import { STATUS_LABEL, statusVar } from "@/lib/domain";
import { useScope } from "@/lib/scope";
import { useLogisticsKpis, useStatusBreakdown, useVehicles } from "@/lib/api/hooks";
import { fmtDateTime } from "@/lib/format";
import { TruckSilhouette } from "../TruckSilhouette";
import { statusSegments, statusTitle } from "./helpers";
import { SourceLine } from "./SourceLine";

/** Stacked bar of today's status counts, one proportional segment per status, 2px gaps. */
export function StatusOverviewCard() {
  const { scope } = useScope();
  const { data, isLoading } = useStatusBreakdown(scope);
  const segs = useMemo(() => statusSegments(data?.counts), [data]);
  const total = segs.reduce((a, s) => a + s.count, 0);

  return (
    <Card
      eyebrow="Status overview"
      title={statusTitle(data?.counts)}
      actions={<span className="rounded-md border border-border px-2 py-1 text-[11px] text-muted">{data?.date ? fmtDateTime(`${data.date}T05:00:00Z`).split(",")[0] : "Today"}</span>}
      footer={<SourceLine source="simulated shipment ledger, sim day" sub="Supply chain / Dispatch" />}
    >
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div>
          <div
            role="img"
            aria-label={segs.map((s) => `${STATUS_LABEL[s.status]} ${s.count}`).join(", ") || "No shipments"}
            className="flex h-8 w-full gap-[2px] overflow-hidden rounded-md"
            data-testid="status-bar"
          >
            {segs.map((s) => (
              <div
                key={s.status}
                title={`${STATUS_LABEL[s.status]}: ${s.count} (${s.pct.toFixed(0)}%)`}
                style={{ width: `${s.pct}%`, background: statusVar(s.status), minWidth: 6 }}
                className="first:rounded-l-md last:rounded-r-md"
              />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] text-muted sm:grid-cols-3">
            {segs.map((s) => (
              <li key={s.status} className="flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusVar(s.status) }} />
                <span className="text-text">{STATUS_LABEL[s.status]}</span>
                <span className="num ml-auto text-muted">{s.count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-faint">{total} shipments today</p>
        </div>
      )}
    </Card>
  );
}

/** Big number with the truck illustration cropped at the right edge (reference "Vehicles in Transit"). */
export function VehiclesInTransitCard() {
  const { scope } = useScope();
  const { data: kpis } = useLogisticsKpis(scope);
  const { data: fleet } = useVehicles(scope === "all" ? {} : { district_id: scope });
  const total = fleet?.items.length ?? 0;
  const delayed = kpis?.delayed_now ?? 0;
  const inTransit = kpis?.vehicles_in_transit ?? kpis?.in_transit_now;

  return (
    <Card
      eyebrow="Vehicles in transit"
      title={total ? `${inTransit ?? 0} of ${total} vehicles are on the road` : "Vehicles on the road"}
      footer={<SourceLine source="live fleet state" sub="Supply chain / Dispatch" />}
      className="overflow-hidden"
    >
      <div className="relative min-h-[112px]">
        <div className="relative z-[1]">
          <span className={`num text-[12px] font-medium ${delayed > 0 ? "text-orange" : "text-green"}`}>
            {delayed > 0 ? `+${delayed} delayed` : "0 delayed"}
          </span>
          <div data-testid="vehicles-in-transit" className="num text-[48px] font-semibold leading-none text-text">
            {inTransit ?? "-"}
          </div>
          <p className="mt-2 text-[12px] text-muted">{kpis?.vehicles_available ?? 0} available at depots</p>
        </div>
        <div className="pointer-events-none absolute -right-10 bottom-[-6px] w-[200px] opacity-95">
          <TruckSilhouette accent="var(--status-in-transit)" />
        </div>
      </div>
    </Card>
  );
}
