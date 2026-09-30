"use client";

import { CircleMarker, Polyline, Tooltip } from "react-leaflet";
import { statusVar, type ShipmentStatus } from "@/lib/domain";
import { splitRoute, type LatLng } from "@/lib/map/geo";

export type RouteEndpoint = { lat: number; lng: number; label: string };

export function RouteLayer({
  path,
  travelledIndex,
  status,
  origin,
  destination,
}: {
  path: readonly LatLng[];
  /** Index of the last point already travelled (index 0 to travelled_index is solid). */
  travelledIndex: number;
  status: ShipmentStatus;
  origin?: RouteEndpoint;
  destination?: RouteEndpoint;
}) {
  if (path.length < 2) return null;
  const { travelled, remaining } = splitRoute(path as LatLng[], travelledIndex);
  const color = statusVar(status);
  return (
    <>
      {remaining.length > 1 && (
        <Polyline positions={remaining} pathOptions={{ color: "var(--text-faint)", weight: 2, dashArray: "6 6", opacity: 0.9 }} />
      )}
      {travelled.length > 1 && <Polyline positions={travelled} pathOptions={{ color, weight: 4, opacity: 0.95 }} />}
      {origin && (
        <CircleMarker center={[origin.lat, origin.lng]} radius={6} pathOptions={{ color: "var(--bg)", weight: 2, fillColor: color, fillOpacity: 1 }}>
          <Tooltip direction="top">{`From ${origin.label}`}</Tooltip>
        </CircleMarker>
      )}
      {destination && (
        <CircleMarker center={[destination.lat, destination.lng]} radius={7} pathOptions={{ color, weight: 3, fillColor: "var(--bg)", fillOpacity: 1 }}>
          <Tooltip direction="top">{`To ${destination.label}`}</Tooltip>
        </CircleMarker>
      )}
    </>
  );
}
