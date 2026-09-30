"use client";

import { LiveTruckLayer } from "@/components/map/LiveTruckLayer";
import { RouteLayer, type RouteEndpoint } from "@/components/map/RouteLayer";
import type { ShipmentStatus } from "@/lib/domain";
import type { PositionsStore } from "@/lib/live/positions-store";
import type { LatLng } from "@/lib/map/geo";

/** Leaflet children of the tracking hero map: travelled path solid, remaining dashed, one moving truck. */
export function TrackLayers({
  store,
  path,
  travelledIndex,
  status,
  origin,
  destination,
}: {
  store: PositionsStore;
  path: LatLng[];
  travelledIndex: number;
  status: ShipmentStatus;
  origin?: RouteEndpoint;
  destination?: RouteEndpoint;
}) {
  return (
    <>
      <RouteLayer path={path} travelledIndex={travelledIndex} status={status} origin={origin} destination={destination} />
      <LiveTruckLayer store={store} />
    </>
  );
}
