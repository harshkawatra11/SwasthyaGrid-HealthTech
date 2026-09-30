"use client";

import { CircleMarker, Tooltip } from "react-leaflet";
import { RISK_LABEL, riskVar, type RiskLevel } from "@/lib/domain";

export type MapFacility = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  risk: RiskLevel;
  worstMedicine?: string;
};

export function facilityRadius(risk: RiskLevel): number {
  return risk === "critical" ? 9 : 6;
}

export function FacilityLayer({
  facilities,
  selectedId,
  onSelect,
}: {
  facilities: readonly MapFacility[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <>
      {facilities.map((f) => {
        const color = riskVar(f.risk);
        const selected = f.id === selectedId;
        return (
          <CircleMarker
            key={f.id}
            center={[f.lat, f.lng]}
            radius={facilityRadius(f.risk)}
            eventHandlers={{ click: () => onSelect?.(f.id) }}
            pathOptions={{
              color: selected ? "var(--text)" : color,
              fillColor: color,
              fillOpacity: 0.85,
              weight: selected ? 3 : 1.5,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <div className="text-[12px] leading-snug">
                <p className="font-semibold">{f.name}</p>
                <p>{RISK_LABEL[f.risk]}</p>
                {f.worstMedicine && <p>Lowest cover: {f.worstMedicine}</p>}
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
