"use client";

import { useRouter } from "next/navigation";
import {
  BaseMapClient,
  ChoroplethLayerClient,
  FacilityLayerClient,
  LiveTruckLayerClient,
  WarehouseLayerClient,
  type MapFacility,
  type MapWarehouse,
} from "@/components/map/client";
import { useLivePositions } from "@/lib/live/LiveProvider";
import type { HeatScale } from "@/lib/heat";

const SCALE: HeatScale = { thresholds: [15, 25, 35, 50], higherIsWorse: true };

/** District map: boundary shaded by risk index, facilities, district warehouse and live trucks. */
export function DistrictMap({
  districtId,
  riskIndex,
  facilities,
  warehouses,
  height,
}: {
  districtId: string;
  riskIndex: number;
  facilities: MapFacility[];
  warehouses: MapWarehouse[];
  height: number;
}) {
  const router = useRouter();
  const store = useLivePositions();
  const points: Array<[number, number]> = [...facilities.map((f) => [f.lat, f.lng] as [number, number]), ...warehouses.map((w) => [w.lat, w.lng] as [number, number])];
  return (
    <BaseMapClient height={height} fitPoints={points} scrollWheelZoom={false}>
      <ChoroplethLayerClient values={{ [districtId]: riskIndex }} scale={SCALE} selectedId={districtId} fillOpacity={0.18} />
      <FacilityLayerClient facilities={facilities} onSelect={(id) => router.push(`/facilities/${id}`)} />
      <WarehouseLayerClient warehouses={warehouses} />
      <LiveTruckLayerClient store={store} />
    </BaseMapClient>
  );
}
