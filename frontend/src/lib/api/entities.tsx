"use client";

import { useMemo } from "react";
import { EntityIndexProvider, STATIC_DATA, type EntityData } from "@/lib/entity-index";
import type { RiskLevel } from "@/lib/domain";
import { useDistricts, useFacilities, useDrivers, useShipments, useStateSummary, useVehicles, useWarehouses } from "./hooks";
import type {
  District,
  DriverSummary,
  Facility,
  RiskCounts,
  ShipmentSummary,
  VehicleSummary,
  WarehouseSummary,
} from "./types";

function worstRisk(c: RiskCounts | undefined): RiskLevel | undefined {
  if (!c) return undefined;
  for (const level of ["critical", "stress", "monitor"] as const) if (c[level] > 0) return level;
  return "healthy";
}

export function shortDistrictName(name: string): string {
  return name.replace(/ District$/, "");
}

export type EntitySources = {
  districts?: District[];
  districtRisk?: Record<string, RiskCounts>;
  facilities?: Facility[];
  warehouses?: WarehouseSummary[];
  vehicles?: VehicleSummary[];
  drivers?: DriverSummary[];
  shipments?: ShipmentSummary[];
};

/** Pure: build entity data from API rows. Empty sources fall back to the static seed. */
export function toEntityData(src: EntitySources): EntityData {
  const districts = src.districts?.length
    ? src.districts.map((d) => ({
        id: d.id,
        name: d.name,
        shortName: shortDistrictName(d.name),
        risk: worstRisk(src.districtRisk?.[d.id]),
      }))
    : STATIC_DATA.districts;
  const facilities = src.facilities?.length
    ? src.facilities.map((f) => ({
        id: f.id,
        name: f.name,
        type: (f.type === "CHC" ? "CHC" : "PHC") as "PHC" | "CHC",
        districtId: f.district_id,
        riskLevel: f.risk_level,
      }))
    : STATIC_DATA.facilities;
  return {
    districts,
    facilities,
    warehouses: (src.warehouses ?? []).map((w) => ({ id: w.id, name: w.name, districtId: w.district_id })),
    vehicles: (src.vehicles ?? []).map((v) => ({ id: v.id, registration: v.registration })),
    drivers: (src.drivers ?? []).map((d) => ({ id: d.id, name: d.name })),
    shipments: (src.shipments ?? []).map((s) => ({ id: s.id, destinationName: s.destination.name, status: s.status })),
  };
}

const ACTIVE = "approved,loading,in_transit,delayed,arrived";

/** Feeds `useEntityIndex()` from the SWR hooks (scope `all`, fixtures when offline). */
export function ApiEntityIndexProvider({ children }: { children: React.ReactNode }) {
  const districts = useDistricts().data?.districts;
  const summary = useStateSummary("all").data;
  const facilities = useFacilities("all").data?.facilities;
  const warehouses = useWarehouses("all").data?.items;
  const vehicles = useVehicles().data?.items;
  const drivers = useDrivers().data?.items;
  const shipments = useShipments({ status: ACTIVE, limit: 100 }).data?.items;

  const data = useMemo(() => {
    const districtRisk: Record<string, RiskCounts> = {};
    for (const d of summary?.districts ?? []) districtRisk[d.district_id] = d.risk_counts;
    return toEntityData({ districts, districtRisk, facilities, warehouses, vehicles, drivers, shipments });
  }, [districts, summary, facilities, warehouses, vehicles, drivers, shipments]);

  return <EntityIndexProvider data={data}>{children}</EntityIndexProvider>;
}
