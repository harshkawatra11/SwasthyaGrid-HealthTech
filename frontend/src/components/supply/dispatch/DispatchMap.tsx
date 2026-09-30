"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Maximize2, Minimize2, Search } from "lucide-react";
import { BaseMapClient } from "@/components/map/client";
import type { MapFacility } from "@/components/map/FacilityLayer";
import type { MapWarehouse } from "@/components/map/WarehouseLayer";
import { useLivePositions } from "@/lib/live/LiveProvider";
import type { LogisticsKpis, ShipmentDetail, ShipmentSummary } from "@/lib/api/types";
import { anchoredChips, fmtRate, matchesQuery } from "./helpers";
import type { DispatchRoute } from "./DispatchLayers";
import { cn } from "@/lib/cn";

const DispatchLayers = dynamic(() => import("./DispatchLayers").then((m) => m.DispatchLayers), { ssr: false });

const MAP_HEIGHT = 340;

const overlayBtn =
  "flex h-9 w-9 items-center justify-center rounded-md border border-border bg-[color-mix(in_srgb,var(--surface-1)_88%,transparent)] text-text backdrop-blur-sm hover:bg-surface-3";

export function DispatchMap({
  shipments,
  kpis,
  warehouses,
  facilities,
  selectedId,
  onSelect,
  detail,
}: {
  shipments: readonly ShipmentSummary[];
  kpis: LogisticsKpis | undefined;
  warehouses: readonly MapWarehouse[];
  facilities: readonly MapFacility[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  detail: ShipmentDetail | null | undefined;
}) {
  const store = useLivePositions();
  const [query, setQuery] = useState("");
  const [showFacilities, setShowFacilities] = useState(false);
  const [height, setHeight] = useState(MAP_HEIGHT);
  const [fullscreen, setFullscreen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = () => {
      const on = document.fullscreenElement === shellRef.current;
      setFullscreen(on);
      setHeight(on ? window.innerHeight : MAP_HEIGHT);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shellRef.current?.requestFullscreen?.();
  }, []);

  const nodes = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number }>();
    warehouses.forEach((w) => m.set(w.id, w));
    facilities.forEach((f) => m.set(f.id, f));
    return m;
  }, [warehouses, facilities]);

  const live = useMemo(() => new Set(shipments.filter((s) => s.status === "in_transit" || s.status === "delayed").map((s) => s.id)), [shipments]);
  const anchored = useMemo(() => anchoredChips(shipments, nodes, live), [shipments, nodes, live]);

  const matchIds = useMemo<ReadonlySet<string> | null>(() => {
    if (!query.trim()) return null;
    return new Set(shipments.filter((s) => matchesQuery(s, query)).map((s) => s.id));
  }, [query, shipments]);

  const fitPoints = useMemo(
    () => [...warehouses.map((w) => [w.lat, w.lng] as [number, number]), ...facilities.map((f) => [f.lat, f.lng] as [number, number])],
    [warehouses, facilities],
  );

  const route = useMemo<DispatchRoute | null>(() => {
    if (!detail || detail.id !== selectedId || detail.path.length < 2) return null;
    return { path: detail.path, travelledIndex: detail.travelled_index, status: detail.status };
  }, [detail, selectedId]);

  return (
    <div ref={shellRef} className={cn("relative overflow-hidden rounded-lg border border-border bg-surface-1", fullscreen && "rounded-none")}>
      <style>{`.dispatch-map .leaflet-control-zoom{display:none}.dispatch-map .leaflet-control-attribution{background:color-mix(in srgb,var(--surface-1) 70%,transparent);color:var(--text-faint);font-size:10px}.dispatch-map .leaflet-control-attribution a{color:var(--text-muted)}`}</style>
      <div className="dispatch-map">
        <BaseMapClient height={height} fitPoints={fitPoints} scrollWheelZoom className="rounded-none border-0">
          <DispatchLayers
            store={store}
            anchored={anchored}
            selectedId={selectedId}
            onSelect={onSelect}
            matchIds={matchIds}
            facilities={facilities}
            warehouses={warehouses}
            showFacilities={showFacilities}
            route={route}
          />
        </BaseMapClient>
      </div>

      <div className="pointer-events-none absolute left-3 top-3 z-[1000] flex items-center gap-2">
        <label className="pointer-events-auto flex h-9 w-[260px] items-center gap-2 rounded-md border border-border bg-[color-mix(in_srgb,var(--surface-1)_88%,transparent)] px-3 text-[13px] text-muted backdrop-blur-sm focus-within:border-brand">
          <Search size={15} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const first = shipments.find((s) => matchesQuery(s, query));
                if (first) onSelect(first.id);
              }
            }}
            placeholder="Search"
            aria-label="Search shipments by id or destination"
            className="w-full bg-transparent text-text outline-none placeholder:text-muted"
          />
        </label>
        <button
          type="button"
          aria-label={showFacilities ? "Hide facilities" : "Show facilities"}
          aria-pressed={showFacilities}
          onClick={() => setShowFacilities((v) => !v)}
          className={cn(overlayBtn, "pointer-events-auto", showFacilities && "border-brand text-brand")}
        >
          {showFacilities ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>

      <button
        type="button"
        aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        onClick={toggleFullscreen}
        className={cn(overlayBtn, "absolute right-3 top-3 z-[1000]")}
      >
        {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>

      <dl
        data-testid="map-stats"
        className="num pointer-events-none absolute bottom-3 left-4 z-[1000] space-y-1 text-[13px] leading-[1.35] text-muted [text-shadow:0_1px_3px_var(--bg)]"
      >
        <div className="flex gap-2">
          <dt>Delivered Today:</dt>
          <dd className="font-semibold text-text">{kpis?.delivered_today ?? "-"}</dd>
        </div>
        <div className="flex gap-2">
          <dt>In Transit Today:</dt>
          <dd className="font-semibold text-text">{kpis?.in_transit_now ?? "-"}</dd>
        </div>
        <div className="flex gap-2">
          <dt>On-Time Rate Today (%):</dt>
          <dd className="font-semibold text-text">{fmtRate(kpis?.on_time_rate_today)}</dd>
        </div>
      </dl>
    </div>
  );
}
