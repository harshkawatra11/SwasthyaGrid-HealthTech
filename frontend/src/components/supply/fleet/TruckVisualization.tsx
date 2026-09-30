"use client";

import { useState } from "react";
import { Boxes, Fuel, Gauge, Route, Thermometer, Weight } from "lucide-react";
import { Card } from "@/components/ds/Card";
import { fmtInt, fmtKg } from "@/lib/format";
import type { VehicleDetail } from "@/lib/api/types";
import { CargoLegend, TruckCargoView } from "../TruckCargoView";
import { cargoCounts, medicineColor, medicineInitials, normaliseSlots } from "../lib/cargo";
import { MetricTile, MiniDonut, SourceFooter } from "../lib/parts";

export function truckVisualizationTitle(v: VehicleDetail): string {
  const c = v.cargo.used_slots;
  const total = v.pallet_slots;
  if (v.live_status === "maintenance") return `${v.registration} is in maintenance with an empty bay`;
  if (c === 0) return `${v.registration} is empty, ${total} pallet slots free`;
  const loaded = v.cargo.slots.filter((x) => x.state === "loaded").length;
  if (loaded === 0) return `${v.registration} has ${fmtKg(v.cargo.used_kg)} reserved in ${c} of ${total} pallet slots`;
  return `${v.registration} carries ${fmtKg(v.cargo.used_kg)} in ${c} of ${total} pallet slots`;
}

function Inner({ vehicle }: { vehicle: VehicleDetail }) {
  const [sel, setSel] = useState<number | null>(null);
  const slots = normaliseSlots(vehicle.cargo.slots, vehicle.pallet_slots);
  const counts = cargoCounts(slots);
  const meds = [...new Set(slots.map((s) => s.medicine_name).filter((m): m is string => !!m))];
  const picked = sel !== null ? slots[sel] : null;
  const temp = vehicle.position?.temp_c;
  const progress = vehicle.position ? Math.round(vehicle.position.progress * 100) : null;
  const utilPct = vehicle.utilisation_7d * 100;

  return (
    <>
      <div className="px-4 pt-3">
        <TruckCargoView
          vehicleClass={vehicle.class}
          slots={slots}
          coldChain={vehicle.cold_chain}
          selectedIndex={sel}
          onSelectSlot={(i) => setSel((cur) => (cur === i ? null : i))}
        />
      </div>
      <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 pb-3 text-[11px] text-muted">
        {meds.length === 0 && <span className="text-faint">No cargo loaded. Select a cell for slot detail.</span>}
        {meds.map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: medicineColor(m) }} />
            <span className="num font-semibold text-text">{medicineInitials(m)}</span>
            {m.replace(/ \(.*\)/, "") !== medicineInitials(m) && m.replace(/ \(.*\)/, "")}
          </span>
        ))}
        {picked && (
          <span className="ml-auto rounded-sm bg-surface-3 px-2 py-0.5 text-text">
            Slot {sel! + 1}: {picked.state}
            {picked.medicine_name ? `, ${picked.medicine_name}` : ""}
            {picked.weight_kg ? `, ${fmtKg(picked.weight_kg)}` : ""}
            {picked.cold_chain ? ", cold chain" : ""}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
        <MetricTile icon={<Weight size={14} />} label="Weight used" value={fmtKg(vehicle.cargo.used_kg)} sub={`of ${fmtInt(vehicle.capacity_kg)} kg`} />
        <MetricTile icon={<Boxes size={14} />} label="Pallets" value={`${counts.loaded + counts.reserved} / ${vehicle.pallet_slots}`} sub={`${counts.reserved} reserved`} />
        <MetricTile
          icon={<Thermometer size={14} />}
          label="Temperature"
          value={typeof temp === "number" ? `${temp.toFixed(1)} C` : vehicle.cold_chain ? "2 to 8 C" : "Ambient"}
          sub={vehicle.cold_chain ? "Reefer, band 2 to 8 C" : "No cold chain"}
        />
        <MetricTile icon={<Route size={14} />} label="Route progress" value={progress === null ? "Idle" : `${progress}%`} sub={vehicle.position ? `${Math.round(vehicle.position.speed_kmh)} km/h` : "Not on a trip"} />
        <MetricTile icon={<Fuel size={14} />} label="Fuel" value={`${vehicle.fuel_pct}%`} sub={vehicle.fuel_pct < 40 ? "Refuel soon" : "Adequate"} />
        <MetricTile
          icon={<Gauge size={14} />}
          label="Util. 7 days"
          value={`${utilPct.toFixed(1)}%`}
          sub={`${vehicle.trips_7d} trips`}
          aside={<MiniDonut pct={Math.max(utilPct, 0.5)} color="var(--series-1)" size={30} />}
        />
      </div>
    </>
  );
}

export function TruckVisualization({ vehicle }: { vehicle: VehicleDetail | undefined }) {
  return (
    <Card
      footer={<SourceFooter source="fleet simulator, pallet slots assigned in line order" section="Supply chain / Fleet" />}
    >
      <div className="-m-4">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="eyebrow">Truck visualization</p>
            <h2 className="mt-0.5 text-[15px] font-semibold leading-snug text-text">
              {vehicle ? truckVisualizationTitle(vehicle) : "Loading vehicle"}
            </h2>
            {vehicle && <p className="mt-0.5 text-[11px] text-muted">{vehicle.label}, {fmtInt(vehicle.capacity_kg)} kg capacity, {vehicle.pallet_slots} pallet slots</p>}
          </div>
          <CargoLegend className="pt-1" />
        </div>
        {vehicle ? <Inner key={vehicle.id} vehicle={vehicle} /> : <div className="h-72 animate-pulse bg-surface-2" />}
      </div>
    </Card>
  );
}
