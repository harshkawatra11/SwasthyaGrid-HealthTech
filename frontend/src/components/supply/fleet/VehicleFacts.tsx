"use client";

import Link from "next/link";
import { Wrench } from "lucide-react";
import { Card } from "@/components/ds/Card";
import { Meter } from "@/components/ds/Meter";
import { StatBlock } from "@/components/ds/StatBlock";
import { StatusChip } from "@/components/ds/StatusChip";
import { useShipment } from "@/lib/api/hooks";
import { fmtClock, fmtInt, fmtKg, fmtKm, fmtRelative } from "@/lib/format";
import type { VehicleDetail } from "@/lib/api/types";
import { MiniGantt } from "../lib/MiniGantt";
import { kmToService } from "../lib/metrics";
import { SourceFooter } from "../lib/parts";

const SEC = "Supply chain / Fleet";

export function VehicleFacts({
  vehicle,
  windowStart,
  windowEnd,
  nowMs,
}: {
  vehicle: VehicleDetail;
  windowStart: string;
  windowEnd: string;
  nowMs: number | null;
}) {
  const { data: ship } = useShipment(vehicle.current_shipment_id);
  const left = kmToService(vehicle.km_since_service);
  const usedSlots = vehicle.cargo.used_slots;
  const nowIso = nowMs === null ? null : new Date(nowMs).toISOString();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card eyebrow="Capacity" title="Load against limits" footer={<SourceFooter source="vehicle master" section={SEC} />}>
        <div className="space-y-3">
          <Meter value={vehicle.cargo.used_kg} max={vehicle.capacity_kg} label={`Weight, ${fmtKg(vehicle.cargo.used_kg)} of ${fmtInt(vehicle.capacity_kg)} kg`} />
          <Meter value={usedSlots} max={vehicle.pallet_slots} label={`Pallets, ${usedSlots} of ${vehicle.pallet_slots}`} />
          <Meter value={vehicle.fuel_pct} max={100} tone={vehicle.fuel_pct < 40 ? "stress" : "healthy"} label="Fuel" />
        </div>
      </Card>

      <Card eyebrow="Assignment" title={ship ? "Current shipment" : "No active shipment"} footer={<SourceFooter source="planner assignments" section={SEC} />}>
        {ship ? (
          <div className="space-y-2 text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/supply/shipments/${ship.id}`} className="num text-[13px] font-semibold text-text hover:text-brand">
                {ship.id}
              </Link>
              <StatusChip status={ship.status} size="sm" live />
            </div>
            <p className="text-muted">
              {ship.origin.name.replace(/^District Drug Warehouse, /, "DDW ")} to <span className="text-text">{ship.destination.name}</span>
            </p>
            <StatBlock
              items={[
                { label: "ETA (IST)", value: ship.eta ? fmtClock(ship.eta) : "Not set", mono: true },
                { label: "Arrives", value: ship.eta && nowIso ? fmtRelative(ship.eta, nowIso) : "Not set", mono: true },
                { label: "Driver", value: ship.driver?.name ?? "Unassigned" },
                { label: "Progress", value: `${Math.round(ship.progress * 100)}%`, mono: true },
                { label: "Cargo", value: ship.lines_summary },
              ]}
            />
          </div>
        ) : (
          <p className="text-[12px] text-muted">
            {vehicle.live_status === "maintenance" ? "Vehicle is out of service." : "Vehicle is idle at its depot and can take the next load."}
          </p>
        )}
      </Card>

      <Card eyebrow="Today" title={`${vehicle.schedule.length} ${vehicle.schedule.length === 1 ? "trip" : "trips"} scheduled`} footer={<SourceFooter source="planner schedule, IST" section={SEC} />}>
        <MiniGantt trips={vehicle.schedule} windowStart={windowStart} windowEnd={windowEnd} nowMs={nowMs} />
        <p className="mt-2 flex flex-wrap gap-x-3 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: "var(--cyan)" }} />Load</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: "var(--status-in-transit)" }} />Drive</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: "var(--violet)" }} />Dwell</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-red" />Now</span>
        </p>
      </Card>

      <Card
        eyebrow="Service"
        title={vehicle.service_due ? "Overdue for service" : `${fmtInt(Math.round(left))} km to next service`}
        actions={vehicle.service_due ? <Wrench size={14} aria-label="Service due" className="text-amber" /> : undefined}
        footer={<SourceFooter source="odometer, 15,000 km interval" section={SEC} />}
      >
        <div className="space-y-3">
          <Meter
            value={vehicle.km_since_service}
            max={15000}
            label={`${fmtInt(Math.round(vehicle.km_since_service))} of 15,000 km since service`}
            tone={vehicle.service_due ? "critical" : "auto"}
          />
          <StatBlock
            items={[
              { label: "Odometer", value: fmtKm(vehicle.odometer_km), mono: true },
              { label: "Trips, 7 days", value: vehicle.trips_7d, mono: true },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
