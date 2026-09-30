"use client";

import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import { riskColor, riskLabel } from "@/data/district";
import type { FacilityView } from "@/lib/facility-view";
import "leaflet/dist/leaflet.css";

export function DistrictMap({
  facilities,
  height = 420,
  onSelect,
}: {
  facilities: FacilityView[];
  height?: number;
  onSelect?: (facility: FacilityView) => void;
}) {
  const n = facilities.length;
  const center: [number, number] = n
    ? [facilities.reduce((a, f) => a + f.lat, 0) / n, facilities.reduce((a, f) => a + f.lng, 0) / n]
    : [26.88, 75.8];
  // A single district fits at zoom 10; the whole state needs a wider view.
  const zoom = new Set(facilities.map((f) => f.districtId)).size > 1 ? 7 : 10;

  return (
    <div className="border border-hairline overflow-hidden" style={{ height }}>
      <MapContainer
        key={`${center[0].toFixed(2)}-${center[1].toFixed(2)}-${zoom}`}
        center={center}
        zoom={zoom}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {facilities.map((f) => (
          <CircleMarker
            key={f.id}
            center={[f.lat, f.lng]}
            radius={10}
            eventHandlers={onSelect ? { click: () => onSelect(f) } : undefined}
            pathOptions={{
              color: riskColor[f.riskLevel],
              fillColor: riskColor[f.riskLevel],
              fillOpacity: 0.85,
              weight: 2,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <div className="font-sans text-xs">
                <p className="font-semibold">{f.name}</p>
                <p>{f.type} · {riskLabel[f.riskLevel]}</p>
                {f.performance && <p>Score: {f.performance.overall}</p>}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
