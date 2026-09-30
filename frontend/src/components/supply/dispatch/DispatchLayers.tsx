"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { Minus, Plus } from "lucide-react";
import { FacilityLayer, type MapFacility } from "@/components/map/FacilityLayer";
import { RouteLayer } from "@/components/map/RouteLayer";
import { WarehouseLayer, type MapWarehouse } from "@/components/map/WarehouseLayer";
import type { PositionsStore } from "@/lib/live/positions-store";
import type { ShipmentStatus } from "@/lib/domain";
import type { LatLng } from "@/lib/map/geo";
import { ChipLayer, locateShipment } from "./ChipLayer";
import type { ChipSpec } from "./helpers";

export type DispatchRoute = {
  path: LatLng[];
  travelledIndex: number;
  status: ShipmentStatus;
};

export type DispatchLayersProps = {
  store: PositionsStore;
  anchored: readonly ChipSpec[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  matchIds: ReadonlySet<string> | null;
  facilities: readonly MapFacility[];
  warehouses: readonly MapWarehouse[];
  showFacilities: boolean;
  route: DispatchRoute | null;
};

/** Zoom stack in the reference style, plus resize handling for the fullscreen toggle. */
function MapControls() {
  const map = useMap();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current);
      L.DomEvent.disableScrollPropagation(ref.current);
    }
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);

  const btn =
    "flex h-9 w-9 items-center justify-center rounded-md border border-border bg-[color-mix(in_srgb,var(--surface-1)_88%,transparent)] text-text backdrop-blur-sm hover:bg-surface-3";
  return (
    <div ref={ref} className="absolute bottom-3 right-3 z-[1000] flex flex-col gap-2">
      <button type="button" aria-label="Zoom in" className={btn} onClick={() => map.zoomIn()}>
        <Plus size={16} />
      </button>
      <button type="button" aria-label="Zoom out" className={btn} onClick={() => map.zoomOut()}>
        <Minus size={16} />
      </button>
    </div>
  );
}

/** Flies to the selected shipment (live position first, then its parked chip). */
function FocusSelected({ store, anchored, selectedId }: { store: PositionsStore; anchored: readonly ChipSpec[]; selectedId: string | null }) {
  const map = useMap();
  const anchoredRef = useRef(anchored);
  useEffect(() => {
    anchoredRef.current = anchored;
  }, [anchored]);
  useEffect(() => {
    if (!selectedId) return;
    const p = locateShipment(store, anchoredRef.current, selectedId);
    if (p) map.flyTo(p, Math.max(map.getZoom(), 8), { duration: 0.8 });
  }, [map, store, selectedId]);
  return null;
}

export function DispatchLayers({
  store,
  anchored,
  selectedId,
  onSelect,
  matchIds,
  facilities,
  warehouses,
  showFacilities,
  route,
}: DispatchLayersProps) {
  return (
    <>
      <WarehouseLayer warehouses={warehouses} />
      {showFacilities && <FacilityLayer facilities={facilities} />}
      {route && <RouteLayer path={route.path} travelledIndex={route.travelledIndex} status={route.status} />}
      <ChipLayer store={store} anchored={anchored} selectedId={selectedId} onSelect={onSelect} matchIds={matchIds} />
      <FocusSelected store={store} anchored={anchored} selectedId={selectedId} />
      <MapControls />
    </>
  );
}
