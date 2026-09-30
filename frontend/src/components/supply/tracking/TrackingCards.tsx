"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Snowflake } from "lucide-react";
import { Card } from "@/components/ds/Card";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Avatar } from "@/components/ds/Avatar";
import { Meter } from "@/components/ds/Meter";
import { Sparkline } from "@/components/ds/Sparkline";
import { StatBlock } from "@/components/ds/StatBlock";
import { EmptyState } from "@/components/ds/EmptyState";
import { PriorityChip } from "@/components/ds/PriorityChip";
import { cn } from "@/lib/cn";
import { fmtDateTime, fmtInt, fmtKg } from "@/lib/format";
import { fmtDuration } from "@/lib/format";
import type { DriverDetail, ShipmentDetail, ShipmentEvent, VehicleSummary } from "@/lib/api/types";
import { SourceLine } from "../dispatch/SourceLine";
import { TEMP_BAND, cargoRows, starText, tempInBand, type CargoRow, type DelayInfo } from "./helpers";

const SUB = "Supply chain / Tracking";

export function DelayBanner({ info }: { info: DelayInfo }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-orange/40 bg-[color-mix(in_srgb,var(--orange)_12%,transparent)] px-3 py-2.5 text-[13px]">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange" aria-hidden />
      <div>
        <p className="font-medium text-text">
          Delay: <span className="num">{fmtDuration(info.minutes)}</span> behind plan
        </p>
        <p className="text-[12px] text-muted">{info.reason}</p>
      </div>
    </div>
  );
}

export function DriverCard({ shipment, driver }: { shipment: ShipmentDetail; driver: DriverDetail | null | undefined }) {
  const name = driver?.name ?? shipment.driver?.name;
  return (
    <Card eyebrow="Driver" title={name ?? "Not assigned yet"} footer={<SourceLine source="simulated driver roster" sub={SUB} />}>
      {!name ? (
        <p className="text-[13px] text-muted">A driver is assigned when the planner finds a free crew and vehicle.</p>
      ) : (
        <div className="flex gap-3">
          <Avatar name={name} size={48} />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-amber" aria-label={driver ? `Rating ${driver.rating}` : undefined}>
              {driver ? (
                <>
                  <span aria-hidden>{starText(driver.rating)}</span> <span className="num text-muted">{driver.rating.toFixed(1)}</span>
                </>
              ) : null}
            </p>
            {driver && (
              <StatBlock
                columns={2}
                items={[
                  { label: "Experience", value: `${driver.years_experience} yrs`, mono: true },
                  { label: "Phone", value: driver.phone_masked, mono: true },
                  { label: "Languages", value: driver.languages.join(", ") },
                  { label: "Hours today", value: `${driver.hours_today.toFixed(1)} h`, mono: true },
                ]}
              />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function TempGauge({ t }: { t: number }) {
  const min = 0;
  const max = 12;
  const pos = Math.min(100, Math.max(0, ((t - min) / (max - min)) * 100));
  const ok = tempInBand(t);
  return (
    <div>
      <div className="relative h-2 rounded-full bg-surface-3" role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={t} aria-label="Cargo temperature">
        <div
          className="absolute inset-y-0 rounded-full bg-[color-mix(in_srgb,var(--green)_30%,transparent)]"
          style={{ left: `${(TEMP_BAND.min / max) * 100}%`, width: `${((TEMP_BAND.max - TEMP_BAND.min) / max) * 100}%` }}
        />
        <div
          className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-bg"
          style={{ left: `${pos}%`, background: ok ? "var(--green)" : "var(--red)" }}
        />
      </div>
      <div className="num mt-1 flex justify-between text-[10px] text-faint">
        <span>0 C</span>
        <span>
          band {TEMP_BAND.min} to {TEMP_BAND.max} C
        </span>
        <span>12 C</span>
      </div>
    </div>
  );
}

export function VehicleCard({ shipment, vehicle }: { shipment: ShipmentDetail; vehicle: VehicleSummary | null | undefined }) {
  const reg = shipment.vehicle?.registration;
  const temps = shipment.temperature;
  const current = shipment.position?.temp_c ?? temps.at(-1)?.temp_c ?? null;
  const ok = tempInBand(current);
  return (
    <Card
      eyebrow="Vehicle"
      title={reg ? `${reg}${vehicle ? `, ${vehicle.label}` : ""}` : "Not assigned yet"}
      footer={<SourceLine source="simulated fleet and reefer telemetry" sub={SUB} />}
    >
      {!reg ? (
        <p className="text-[13px] text-muted">{shipment.blocked_reason ?? "Waiting for the planner."}</p>
      ) : (
        <div className="space-y-3">
          {vehicle && (
            <>
              <Meter label={`Weight ${fmtKg(shipment.weight_kg)} of ${fmtKg(vehicle.capacity_kg)}`} value={shipment.weight_kg} max={vehicle.capacity_kg} />
              <Meter label={`Pallets ${shipment.pallet_slots} of ${vehicle.pallet_slots}`} value={shipment.pallet_slots} max={vehicle.pallet_slots} />
            </>
          )}
          {shipment.cold_chain && current !== null ? (
            <div data-testid="reefer" className="rounded-md border border-border bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                  <Snowflake size={13} className="text-cyan" aria-hidden /> Reefer temperature
                </span>
                <span className={cn("num text-[16px] font-semibold", ok ? "text-green" : "text-red")}>
                  {current.toFixed(1)} C <span className="text-[11px] font-normal">{ok ? "in band" : "out of band"}</span>
                </span>
              </div>
              <TempGauge t={current} />
              {temps.length > 1 && (
                <div className="mt-2 flex items-center gap-2 text-[11px] text-faint">
                  <Sparkline data={temps.map((x) => x.temp_c)} color={ok ? "var(--green)" : "var(--red)"} width={160} height={28} />
                  <span>last 60 sim minutes</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-muted">{shipment.cold_chain ? "Reefer telemetry starts when the truck leaves the depot." : "Ambient load, no cold chain."}</p>
          )}
        </div>
      )}
    </Card>
  );
}

export function CargoCard({ shipment }: { shipment: ShipmentDetail }) {
  const rows = cargoRows(shipment);
  const cols: Column<CargoRow>[] = [
    { key: "name", header: "Medicine", accessor: (r) => r.name },
    { key: "units", header: "Units", accessor: (r) => r.units, align: "right", mono: true, cell: (r) => fmtInt(r.units) },
    { key: "cartons", header: "Cartons", accessor: (r) => r.cartons, align: "right", mono: true },
    { key: "weight", header: "Weight", accessor: (r) => r.weight, align: "right", mono: true, cell: (r) => fmtKg(r.weight) },
    {
      key: "cold",
      header: "Cold chain",
      accessor: (r) => r.cold,
      align: "center",
      cell: (r) => (r.cold ? <span className="inline-flex items-center gap-1 text-cyan"><Snowflake size={12} aria-hidden /> Yes</span> : <span className="text-faint">No</span>),
    },
  ];
  return (
    <Card
      eyebrow="Cargo manifest"
      title={`${rows.length} ${rows.length === 1 ? "line" : "lines"}, ${fmtKg(shipment.weight_kg)}, ${shipment.pallet_slots} ${shipment.pallet_slots === 1 ? "pallet" : "pallets"}`}
      footer={<SourceLine source="simulated dispatch order" sub={SUB} />}
    >
      <div className="-m-4">
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.name} density="compact" />
      </div>
    </Card>
  );
}

const EVENT_DOT: Record<string, string> = {
  incident_started: "var(--orange)",
  cold_chain_breach: "var(--red)",
  cancelled: "var(--status-cancelled)",
  arrived: "var(--status-arrived)",
  pod_confirmed: "var(--status-delivered)",
};

export function EventLog({ events }: { events: readonly ShipmentEvent[] }) {
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card
      eyebrow="Event log"
      title={sorted.length ? `${sorted.length} events, latest: ${sorted[0].title}` : "No events yet"}
      live
      footer={<SourceLine source="events derived from the trip timeline" sub={SUB} />}
    >
      <ol data-testid="event-log" className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
        {sorted.map((e, i) => (
          <li key={`${e.type}-${e.at}-${i}`} className="relative flex gap-3">
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: EVENT_DOT[e.type] ?? "var(--brand)" }} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-text">{e.title}</p>
              {e.detail && <p className="text-[12px] text-muted">{e.detail}</p>}
            </div>
            <span className="num shrink-0 text-[11px] text-muted">{fmtDateTime(e.at)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function PodCard({ shipment }: { shipment: ShipmentDetail }) {
  const pod = shipment.pod;
  return (
    <Card
      eyebrow="Proof of delivery"
      title={pod ? `Confirmed by ${pod.confirmed_by}` : shipment.status === "cancelled" ? "Not applicable, shipment cancelled" : "Pending confirmation"}
      footer={<SourceLine source="facility confirmation in the CRM portal" sub={SUB} />}
    >
      {!pod ? (
        <p className="text-[13px] text-muted">
          {shipment.status === "cancelled"
            ? "No delivery will be made."
            : `Waiting for ${shipment.destination.name} to confirm receipt in the facility portal.`}
        </p>
      ) : (
        <div className="space-y-3 text-[13px]">
          <p className="flex items-center gap-2 text-green">
            <CheckCircle2 size={15} aria-hidden /> Received {fmtDateTime(pod.confirmed_at)} IST, condition {pod.condition}
          </p>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted">
                <th className="pb-1 font-medium">Medicine</th>
                <th className="pb-1 text-right font-medium">Shipped</th>
                <th className="pb-1 text-right font-medium">Received</th>
              </tr>
            </thead>
            <tbody>
              {shipment.lines.map((l) => {
                const got = pod.received.find((r) => r.medicine_name === l.medicine_name)?.units ?? 0;
                return (
                  <tr key={l.medicine_name} className="border-t border-border">
                    <td className="py-1.5">{l.medicine_name}</td>
                    <td className="num py-1.5 text-right">{fmtInt(l.units)}</td>
                    <td className={cn("num py-1.5 text-right", got < l.units ? "text-orange" : "text-text")}>{fmtInt(got)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pod.note && <p className="text-muted">Note: {pod.note}</p>}
        </div>
      )}
    </Card>
  );
}

export function OriginCard({ shipment }: { shipment: ShipmentDetail }) {
  const r = shipment.recommendation;
  return (
    <Card
      eyebrow="Recommendation origin"
      title={r ? r.subject : shipment.kind === "routine" || shipment.kind === "restock" ? "Scheduled background traffic" : "Created manually"}
      footer={<SourceLine source="recommendation engine v2" sub={SUB} />}
    >
      {!r ? (
        <EmptyState icon={CheckCircle2} title="No recommendation behind this shipment" body="Routine and restock runs are planned by the depot schedule." />
      ) : (
        <div className="space-y-2 text-[13px]">
          <div className="flex items-center gap-2">
            <PriorityChip priority={r.priority} size="sm" />
            <span className="num text-muted">confidence {Math.round(r.confidence * 100)}%</span>
          </div>
          <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted">
            {r.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <Link href="/recommendations" className="inline-block text-[12px] text-brand hover:underline">
            Open in Recommendations
          </Link>
        </div>
      )}
    </Card>
  );
}

