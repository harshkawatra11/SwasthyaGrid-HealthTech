"use client";

import dynamic from "next/dynamic";
import type { BaseMapProps } from "./BaseMap";

/*
 * Leaflet touches `window` at import time, so every map module is loaded with ssr:false.
 * Import map components from here, never from the module files, in pages.
 */

const BaseMapDynamic = dynamic(() => import("./BaseMap").then((m) => m.BaseMap), { ssr: false });

/** Same box as the map (height prop), so the page does not shift when Leaflet loads. */
export function BaseMapClient(props: BaseMapProps) {
  const height = props.height ?? 420;
  return (
    <div className="relative overflow-hidden rounded-md" style={{ height }}>
      <div aria-hidden className="absolute inset-0 animate-pulse rounded-md border border-border bg-surface-2" />
      <div className="absolute inset-0">
        <BaseMapDynamic {...props} />
      </div>
    </div>
  );
}

export const ChoroplethLayerClient = dynamic(() => import("./ChoroplethLayer").then((m) => m.ChoroplethLayer), { ssr: false });
export const FacilityLayerClient = dynamic(() => import("./FacilityLayer").then((m) => m.FacilityLayer), { ssr: false });
export const WarehouseLayerClient = dynamic(() => import("./WarehouseLayer").then((m) => m.WarehouseLayer), { ssr: false });
export const LiveTruckLayerClient = dynamic(() => import("./LiveTruckLayer").then((m) => m.LiveTruckLayer), { ssr: false });
export const RouteLayerClient = dynamic(() => import("./RouteLayer").then((m) => m.RouteLayer), { ssr: false });

export type { BaseMapProps } from "./BaseMap";
export type { MapFacility } from "./FacilityLayer";
export type { MapWarehouse } from "./WarehouseLayer";
export type { RouteEndpoint } from "./RouteLayer";
