"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, ZoomControl, useMap } from "react-leaflet";
import L, { type LatLngBoundsExpression, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/cn";
import type { LatLng } from "@/lib/map/geo";
import { tileConfig } from "@/lib/map/tiles";
import { useTheme } from "@/lib/use-theme";

/** State-wide bounding box, used only until real points arrive (never a hard-coded centre). */
export const RAJASTHAN_BOUNDS: LatLngBoundsExpression = [
  [23.0, 69.5],
  [30.2, 78.3],
];

export const FIT_PADDING: [number, number] = [24, 24];

/** Fit a map to a set of points with 24px padding; no-op for an empty set. */
export function fitBoundsTo(map: LeafletMap, points: readonly LatLng[], padding: [number, number] = FIT_PADDING): void {
  if (points.length === 0) return;
  map.fitBounds(L.latLngBounds(points as LatLng[]), { padding, maxZoom: 13 });
}

function FitBounds({ points }: { points: readonly LatLng[] }) {
  const map = useMap();
  const signature = points.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join("|");
  useEffect(() => {
    fitBoundsTo(map, points);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature captures the points
  }, [map, signature]);
  return null;
}

export type BaseMapProps = {
  height?: number;
  /** Points to frame (all loaded facilities, for example). */
  fitPoints?: readonly LatLng[];
  scrollWheelZoom?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export function BaseMap({ height = 420, fitPoints = [], scrollWheelZoom = false, className, children }: BaseMapProps) {
  const theme = useTheme();
  const tiles = tileConfig(theme);
  const initialBounds: LatLngBoundsExpression =
    fitPoints.length > 0 ? L.latLngBounds(fitPoints as LatLng[]) : RAJASTHAN_BOUNDS;

  return (
    <div
      className={cn("overflow-hidden rounded-md border border-border", className)}
      style={{ height }}
      data-testid="base-map"
    >
      <MapContainer
        bounds={initialBounds}
        boundsOptions={{ padding: FIT_PADDING }}
        zoomControl={false}
        scrollWheelZoom={scrollWheelZoom}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          key={theme}
          url={tiles.url}
          attribution={tiles.attribution}
          subdomains={tiles.subdomains ?? "abc"}
          maxZoom={tiles.maxZoom}
        />
        <ZoomControl position="bottomright" />
        <FitBounds points={fitPoints} />
        {children}
      </MapContainer>
    </div>
  );
}
