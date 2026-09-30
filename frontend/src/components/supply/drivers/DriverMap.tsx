"use client";

import { useMemo } from "react";
import { Card } from "@/components/ds/Card";
import { BaseMapClient, LiveTruckLayerClient, WarehouseLayerClient } from "@/components/map/client";
import type { MapWarehouse } from "@/components/map/client";
import { useLivePositions } from "@/lib/live/LiveProvider";
import type { LatLng } from "@/lib/map/geo";
import type { WarehouseSummary } from "@/lib/api/types";
import { SourceFooter } from "../lib/parts";

const SEC = "Supply chain / Drivers";

/** Centre pane of the drivers page (reference image 3): a live map with depots and moving trucks. */
export function DriverMap({
  warehouses,
  selectedShipmentId,
  onSelectShipment,
  activeCount,
}: {
  warehouses: WarehouseSummary[];
  selectedShipmentId: string | null;
  onSelectShipment: (shipmentId: string) => void;
  activeCount: number;
}) {
  const store = useLivePositions();
  const mapWarehouses = useMemo<MapWarehouse[]>(
    () => warehouses.map((w) => ({ id: w.id, name: w.name, lat: w.lat, lng: w.lng, central: w.type === "central" })),
    [warehouses],
  );
  const fitPoints = useMemo<LatLng[]>(() => warehouses.map((w) => [w.lat, w.lng]), [warehouses]);

  return (
    <Card
      eyebrow="Live map"
      title={`${activeCount} ${activeCount === 1 ? "driver is" : "drivers are"} moving now`}
      live
      className="h-full"
      footer={<SourceFooter source="live position stream, simulator" section={SEC} />}
    >
      <BaseMapClient height={400} fitPoints={fitPoints} scrollWheelZoom>
        <WarehouseLayerClient warehouses={mapWarehouses} />
        <LiveTruckLayerClient store={store} selectedShipmentId={selectedShipmentId} onSelect={onSelectShipment} />
      </BaseMapClient>
    </Card>
  );
}
