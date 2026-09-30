"use client";

import { RouteLayerClient } from "@/components/map/client";
import { useShipment } from "@/lib/api/hooks";

/** One shipment's route, fetched on demand only while the routes layer is on. */
function Route({ id }: { id: string }) {
  const { data } = useShipment(id);
  if (!data || data.path.length < 2) return null;
  const origin = data.stops.find((s) => s.purpose === "pickup");
  const destination = data.stops.find((s) => s.purpose === "dropoff");
  return (
    <RouteLayerClient
      path={data.path}
      travelledIndex={data.travelled_index}
      status={data.status}
      origin={origin ? { lat: origin.lat, lng: origin.lng, label: origin.name } : undefined}
      destination={destination ? { lat: destination.lat, lng: destination.lng, label: destination.name } : undefined}
    />
  );
}

/** Draws routes for a bounded set of shipment ids (see `routeCandidates`). */
export function ActiveRoutes({ ids }: { ids: readonly string[] }) {
  return (
    <>
      {ids.map((id) => (
        <Route key={id} id={id} />
      ))}
    </>
  );
}
