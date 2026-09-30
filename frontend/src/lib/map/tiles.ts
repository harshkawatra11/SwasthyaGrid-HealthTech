import type { Theme } from "@/lib/theme";

export type TileProvider = "carto" | "esri";

export type TileConfig = { url: string; attribution: string; subdomains?: string; maxZoom: number };

/**
 * Esri is the default: unauthenticated CARTO basemap tiles render an "API KEY REQUIRED" watermark
 * (observed in the C7 browser check). Set NEXT_PUBLIC_MAP_TILES=carto to opt back in with a valid key.
 */
export function tileProvider(value: string | undefined = process.env.NEXT_PUBLIC_MAP_TILES): TileProvider {
  return value === "carto" ? "carto" : "esri";
}

const CARTO_ATTRIBUTION = "&copy; OpenStreetMap contributors &copy; CARTO";
const ESRI_ATTRIBUTION = "Tiles &copy; Esri";

export function tileConfig(theme: Theme, provider: TileProvider = tileProvider()): TileConfig {
  if (provider === "esri") {
    const set = theme === "dark" ? "World_Dark_Gray_Base" : "World_Light_Gray_Base";
    return {
      url: `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/${set}/MapServer/tile/{z}/{y}/{x}`,
      attribution: ESRI_ATTRIBUTION,
      maxZoom: 16,
    };
  }
  return {
    url: `https://{s}.basemaps.cartocdn.com/${theme === "dark" ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`,
    attribution: CARTO_ATTRIBUTION,
    subdomains: "abcd",
    maxZoom: 19,
  };
}
