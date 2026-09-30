"use client";

import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";

export type MapWarehouse = { id: string; name: string; lat: number; lng: number; central?: boolean };

const GLYPH =
  '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 8.35V20a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8.35A1 1 0 0 1 2.65 7.4l9-3.6a1 1 0 0 1 .7 0l9 3.6a1 1 0 0 1 .65.95Z"/><path d="M6 18h12M6 14h12"/></svg>';

export function warehouseIcon(central: boolean): L.DivIcon {
  const size = central ? 30 : 22;
  const glyph = GLYPH.replace(/\{s\}/g, String(central ? 18 : 13));
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:var(--surface-2);border:1px solid ${
      central ? "var(--brand)" : "var(--border-strong)"
    };color:${central ? "var(--brand)" : "var(--text)"};box-shadow:var(--shadow-overlay)">${glyph}</div>`,
  });
}

export function WarehouseLayer({ warehouses }: { warehouses: readonly MapWarehouse[] }) {
  return (
    <>
      {warehouses.map((w) => (
        <Marker key={w.id} position={[w.lat, w.lng]} icon={warehouseIcon(!!w.central)}>
          <Tooltip direction="top" offset={[0, -12]}>
            <span className="text-[12px] font-semibold">{w.name}</span>
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
