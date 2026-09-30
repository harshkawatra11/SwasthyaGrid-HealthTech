"use client";

import Link from "next/link";
import { Award, Languages, Phone, Star } from "lucide-react";
import { Avatar } from "@/components/ds/Avatar";
import { Chip } from "@/components/ds/chip";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Meter } from "@/components/ds/Meter";
import { StatBlock } from "@/components/ds/StatBlock";
import { StatusChip } from "@/components/ds/StatusChip";
import { fmtClock, fmtDateTime, fmtPct } from "@/lib/format";
import type { DriverDetail, ShipmentSummary } from "@/lib/api/types";
import { useEntityIndex } from "@/lib/entity-index";
import { MiniGantt } from "../lib/MiniGantt";
import { DRIVER_HOURS_LIMIT, daysToExpiry, licenceTone } from "../lib/metrics";
import { DriverStatusChip, depotLabel } from "../lib/parts";

const LICENCE_COLOR = { good: "var(--green)", warning: "var(--amber)", critical: "var(--red)" } as const;

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Rating ${rating.toFixed(1)} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={12} aria-hidden className={i <= Math.round(rating) ? "fill-amber text-amber" : "text-faint"} />
      ))}
      <span className="num ml-1 text-[12px] font-semibold text-text">{rating.toFixed(1)}</span>
    </span>
  );
}

export function driverPanelTitle(d: DriverDetail): string {
  const h = d.hours_today;
  if (d.live_status === "off_shift") return `${d.name} is off shift after ${h.toFixed(1)} h today`;
  if (h >= DRIVER_HOURS_LIMIT - 1) return `${d.name} has ${(DRIVER_HOURS_LIMIT - h).toFixed(1)} h left before the ${DRIVER_HOURS_LIMIT} h limit`;
  return `${d.name} has driven ${h.toFixed(1)} of ${DRIVER_HOURS_LIMIT} h today`;
}

/** Detail pane of the drivers page (reference image 3, right panel). */
export function DriverPanel({
  driver,
  windowStart,
  windowEnd,
  nowMs,
}: {
  driver: DriverDetail;
  windowStart: string;
  windowEnd: string;
  nowMs: number | null;
}) {
  const idx = useEntityIndex();
  const days = nowMs === null ? null : daysToExpiry(driver.license_expiry, nowMs);
  const tone = days === null ? "good" : licenceTone(days);
  const cols: Column<ShipmentSummary>[] = [
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
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="flex items-start gap-3 border-b border-border p-4">
        <Avatar name={driver.name} size={64} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-text">{driver.name}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <Stars rating={driver.rating} />
            <DriverStatusChip status={driver.live_status} />
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {driver.years_experience} years experience, {depotLabel(idx.warehouseName(driver.home_warehouse_id))} depot
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1"><Languages size={11} aria-hidden />{driver.languages.join(", ")}</span>
            <span className="num inline-flex items-center gap-1"><Phone size={11} aria-hidden />{driver.phone_masked}</span>
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <p className="text-[13px] font-semibold leading-snug text-text">{driverPanelTitle(driver)}</p>

        <section aria-label="Licence" className="rounded-md border border-border bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow inline-flex items-center gap-1.5"><Award size={12} aria-hidden />Licence</p>
            <Chip
              label={days === null ? "Expiry" : days < 0 ? "Expired" : days <= 60 ? `Expires in ${days} d` : "Valid"}
              color={LICENCE_COLOR[tone]}
              size="sm"
            />
          </div>
          <StatBlock
            columns={2}
            items={[
              { label: "Number", value: driver.license_masked, mono: true },
              { label: "Expiry", value: driver.license_expiry, mono: true },
            ]}
          />
        </section>

        <section aria-label="Hours today">
          <Meter
            value={driver.hours_today}
            max={DRIVER_HOURS_LIMIT}
            label={`Hours today, ${driver.hours_today.toFixed(1)} of ${DRIVER_HOURS_LIMIT} h, shift ${driver.shift}`}
          />
        </section>

        <StatBlock
          columns={3}
          items={[
            { label: "Deliveries 30d", value: driver.deliveries_30d, mono: true },
            { label: "On time 30d", value: fmtPct(driver.on_time_rate_30d * 100), mono: true },
            { label: "Assignment", value: driver.current_shipment_id ?? "None", mono: true },
          ]}
        />

        <section aria-label="Today's schedule">
          <p className="eyebrow mb-1.5">Today&apos;s schedule</p>
          <MiniGantt trips={driver.schedule} windowStart={windowStart} windowEnd={windowEnd} nowMs={nowMs} />
          {driver.schedule.length > 0 && (
            <p className="mt-1 truncate text-[11px] text-muted">
              {driver.schedule[0].shipment_id}, {driver.schedule[0].label}
              {driver.schedule[0].segments[0] ? `, from ${fmtClock(driver.schedule[0].segments[0].start)}` : ""}
            </p>
          )}
        </section>

        <section aria-label="Recent shipments">
          <p className="eyebrow mb-1.5">Recent shipments</p>
          <div className="overflow-hidden rounded-md border border-border">
            <DataTable
              columns={cols}
              rows={driver.recent.slice(0, 10)}
              rowKey={(r) => r.id}
              density="compact"
              stickyHeader={false}
              empty={<p className="p-3 text-[12px] text-muted">No shipments in the last 30 days.</p>}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
