"use client";

import { createContext, useContext, useMemo } from "react";
import { facilities as mockFacilities } from "@/data/district";
import type { RiskLevel } from "@/lib/domain";
import type { ShipmentStatus } from "@/lib/domain";

export type DistrictEntity = { id: string; name: string; shortName: string; risk?: RiskLevel };
export type FacilityEntity = { id: string; name: string; type: "PHC" | "CHC"; districtId: string; riskLevel?: RiskLevel };
export type ShipmentEntity = { id: string; destinationName: string; status: ShipmentStatus };
export type VehicleEntity = { id: string; registration: string };
export type DriverEntity = { id: string; name: string };
export type WarehouseEntity = { id: string; name: string; districtId: string };

export type EntityData = {
  districts: DistrictEntity[];
  facilities: FacilityEntity[];
  shipments: ShipmentEntity[];
  vehicles: VehicleEntity[];
  drivers: DriverEntity[];
  warehouses: WarehouseEntity[];
};

export type EntityIndex = EntityData & {
  districtName: (id: string) => string;
  facilityName: (id: string) => string;
  warehouseName: (id: string) => string;
  driverName: (id: string) => string;
  /** Vehicle registration for an id (vehicles are the one entity shown by code). */
  vehicleRegistration: (id: string) => string;
};

export const STATIC_DISTRICTS: DistrictEntity[] = [
  { id: "district_jaipur_rural", name: "Jaipur Rural District", shortName: "Jaipur Rural" },
  { id: "district_alwar", name: "Alwar District", shortName: "Alwar" },
  { id: "district_bikaner", name: "Bikaner District", shortName: "Bikaner" },
  { id: "district_udaipur", name: "Udaipur District", shortName: "Udaipur" },
  { id: "district_kota", name: "Kota District", shortName: "Kota" },
];

/** Static seed used before the data layer answers: the 8 legacy facilities plus the five districts. */
export const STATIC_DATA: EntityData = {
  districts: STATIC_DISTRICTS,
  facilities: mockFacilities.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    districtId: "district_jaipur_rural",
    riskLevel: f.riskLevel,
  })),
  shipments: [],
  vehicles: [],
  drivers: [],
  warehouses: [],
};

export function buildEntityIndex(data: EntityData): EntityIndex {
  const districtMap = new Map(data.districts.map((d) => [d.id, d.name]));
  const facilityMap = new Map(data.facilities.map((f) => [f.id, f.name]));
  const warehouseMap = new Map(data.warehouses.map((w) => [w.id, w.name]));
  const driverMap = new Map(data.drivers.map((d) => [d.id, d.name]));
  const vehicleMap = new Map(data.vehicles.map((v) => [v.id, v.registration]));
  return {
    ...data,
    districtName: (id) => districtMap.get(id) ?? id,
    facilityName: (id) => facilityMap.get(id) ?? id,
    warehouseName: (id) => warehouseMap.get(id) ?? id,
    driverName: (id) => driverMap.get(id) ?? id,
    vehicleRegistration: (id) => vehicleMap.get(id) ?? id,
  };
}

const DEFAULT_INDEX = buildEntityIndex(STATIC_DATA);
const EntityIndexContext = createContext<EntityIndex>(DEFAULT_INDEX);

/** `ApiEntityIndexProvider` (lib/api/entities.tsx) passes live data; without `data` the static list is used. */
export function EntityIndexProvider({ data, children }: { data?: EntityData; children: React.ReactNode }) {
  const value = useMemo(() => (data ? buildEntityIndex(data) : DEFAULT_INDEX), [data]);
  return <EntityIndexContext.Provider value={value}>{children}</EntityIndexContext.Provider>;
}

export function useEntityIndex(): EntityIndex {
  return useContext(EntityIndexContext);
}
