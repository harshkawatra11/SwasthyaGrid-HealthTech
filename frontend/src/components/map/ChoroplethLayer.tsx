"use client";

import { useEffect, useState } from "react";
import { GeoJSON } from "react-leaflet";
import type { Feature, FeatureCollection } from "geojson";
import type { Layer, PathOptions } from "leaflet";
import { useEntityIndex } from "@/lib/entity-index";
import { heatColor, type HeatScale } from "@/lib/heat";

export const GEO_URL = "/geo/rajasthan-5.geojson";

let cache: Promise<FeatureCollection> | null = null;
function loadGeo(): Promise<FeatureCollection> {
  cache ??= fetch(GEO_URL).then((r) => {
    if (!r.ok) throw new Error(`geo ${r.status}`);
    return r.json() as Promise<FeatureCollection>;
  });
  cache.catch(() => {
    cache = null;
  });
  return cache;
}

export type ChoroplethLayerProps = {
  /** district_id to value; null or missing renders the empty colour. */
  values: Record<string, number | null | undefined>;
  scale: HeatScale;
  selectedId?: string | null;
  onSelect?: (districtId: string) => void;
  /** Extra tooltip line, for example a formatted value. */
  describe?: (districtId: string) => string | undefined;
  fillOpacity?: number;
};

export function ChoroplethLayer({ values, scale, selectedId, onSelect, describe, fillOpacity = 0.55 }: ChoroplethLayerProps) {
  const [data, setData] = useState<FeatureCollection | null>(null);
  const index = useEntityIndex();

  useEffect(() => {
    let alive = true;
    loadGeo()
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;

  const style = (f?: Feature): PathOptions => {
    const id = String(f?.properties?.district_id);
    const selected = id === selectedId;
    return {
      color: selected ? "var(--brand)" : "var(--border-strong)",
      weight: selected ? 2.5 : 1.25,
      fillColor: heatColor(values[id] ?? null, scale),
      fillOpacity,
    };
  };

  const onEachFeature = (f: Feature, layer: Layer) => {
    const id = String(f.properties?.district_id);
    const shape = String(f.properties?.shapeName ?? "");
    const extra = describe?.(id);
    const html =
      `<strong>${escapeHtml(index.districtName(id))}</strong>` +
      (extra ? `<br/>${escapeHtml(extra)}` : "") +
      `<br/><span style="opacity:.7">Boundary: ${escapeHtml(shape)} district</span>`;
    layer.bindTooltip(html, { sticky: true });
    layer.on("click", () => onSelect?.(id));
  };

  // GeoJSON does not restyle on prop changes, so remount when inputs change.
  const key = `${selectedId ?? ""}|${JSON.stringify(values)}|${scale.thresholds.join(",")}`;
  return <GeoJSON key={key} data={data} style={style} onEachFeature={onEachFeature} />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
