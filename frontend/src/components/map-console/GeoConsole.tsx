"use client";

import { useMemo, useState } from "react";
import {
  BaseMapClient,
  ChoroplethLayerClient,
  FacilityLayerClient,
  LiveTruckLayerClient,
  WarehouseLayerClient,
  type MapFacility,
  type MapWarehouse,
} from "@/components/map/client";
import { Callout, Moneyshot, RISK_INDEX_SCALE } from "@/components/districts/kit";
import { PageHeader } from "@/components/ds/PageHeader";
import { useFacilities, useLogisticsKpis, useShipments, useStateSummary, useWarehouses } from "@/lib/api/hooks";
import { useEntityIndex } from "@/lib/entity-index";
import { useLivePositions } from "@/lib/live/LiveProvider";
import { ActiveRoutes } from "./ActiveRoutes";
import { defaultLayerState, districtActionTitle, networkHeadline, routeCandidates, worstDistrict, type LayerKey, type Selection } from "./console";
import { LayerPanel } from "./LayerPanel";
import { SelectionDrawer } from "./SelectionDrawer";

const EMPTY_DISTRICTS: never[] = [];
const EMPTY_FACILITIES: never[] = [];
const EMPTY_WAREHOUSES: never[] = [];
const EMPTY_SHIPMENTS: never[] = [];

/** GIS console: full-height map, layer panel, legend and a selection drawer. Plan 9.6. */
export function GeoConsole() {
  const index = useEntityIndex();
  const summary = useStateSummary("all");
  const facilities = useFacilities("all");
  const warehouses = useWarehouses("all");
  const kpis = useLogisticsKpis("all");
  const ships = useShipments({ limit: 80 });
  const positions = useLivePositions();

  const [layers, setLayers] = useState(defaultLayerState);
  const [selection, setSelection] = useState<Selection | null>(null);

  function toggle(key: LayerKey) {
    setLayers((s) => ({ ...s, [key]: !s[key] }));
  }

  function select(kind: Selection["kind"], id: string) {
    setSelection({ kind, id });
  }

  const districtRows = summary.data?.districts ?? EMPTY_DISTRICTS;
  const facilityRows = facilities.data?.facilities ?? EMPTY_FACILITIES;
  const warehouseRows = warehouses.data?.items ?? EMPTY_WAREHOUSES;
  const shipmentRows = ships.data?.items ?? EMPTY_SHIPMENTS;

  const mapFacilities: MapFacility[] = useMemo(
    () => facilityRows.map((f) => ({ id: f.id, name: f.name, lat: f.lat, lng: f.lng, risk: f.risk_level })),
    [facilityRows],
  );
  const mapWarehouses: MapWarehouse[] = useMemo(
    () => warehouseRows.map((w) => ({ id: w.id, name: w.name, lat: w.lat, lng: w.lng, central: w.type === "central" })),
    [warehouseRows],
  );
  const fitPoints = useMemo<Array<[number, number]>>(
    () => [...mapFacilities.map((f) => [f.lat, f.lng] as [number, number]), ...mapWarehouses.map((w) => [w.lat, w.lng] as [number, number])],
    [mapFacilities, mapWarehouses],
  );
  const choroplethValues = useMemo(() => Object.fromEntries(districtRows.map((d) => [d.district_id, d.risk_index])), [districtRows]);
  const routeIds = useMemo(() => routeCandidates(shipmentRows, layers.delayedOnly), [shipmentRows, layers.delayedOnly]);

  const worst = worstDistrict(districtRows);
  const delayed = kpis.data?.delayed_now ?? 0;
  const inTransit = kpis.data?.in_transit_now ?? 0;

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Geo intelligence / Live network"
        title={worst ? districtActionTitle(worst, districtRows) : "Loading the live state map"}
        description="One state, every facility, warehouse and truck. Click a district, a marker or a truck to open its file."
        actions={
          <Moneyshot value={delayed} unit={delayed === 1 ? "truck" : "trucks"} label="delayed right now, tracked live on this map" href="/supply" tone={delayed > 0 ? "critical" : "brand"} />
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-1 px-3 py-2">
        <Callout tone={delayed > 0 ? "critical" : "default"}>{networkHeadline(inTransit, delayed)}</Callout>
        <span className="num text-[12px] text-muted">
          <span className="text-text">{facilityRows.length}</span> facilities, <span className="text-text">{warehouseRows.length}</span> warehouses in view
        </span>
        {ships.offline && <span className="text-[11px] text-faint">Offline: showing seeded fixtures</span>}
      </div>

      <div className="flex items-start gap-4">
        <LayerPanel state={layers} onToggle={toggle} districts={index.districts} onJump={(id) => select("district", id)} />

        <div className="min-w-0 flex-1">
          <BaseMapClient height={600} fitPoints={fitPoints} scrollWheelZoom>
            {layers.choropleth && (
              <ChoroplethLayerClient
                values={choroplethValues}
                scale={RISK_INDEX_SCALE}
                selectedId={selection?.kind === "district" ? selection.id : null}
                onSelect={(id) => select("district", id)}
                describe={(id) => `Risk index ${choroplethValues[id] ?? "n/a"}`}
              />
            )}
            {layers.warehouses && <WarehouseLayerClient warehouses={mapWarehouses} />}
            {layers.facilities && (
              <FacilityLayerClient facilities={mapFacilities} selectedId={selection?.kind === "facility" ? selection.id : null} onSelect={(id) => select("facility", id)} />
            )}
            {layers.trucks && (
              <LiveTruckLayerClient
                store={positions}
                delayedOnly={layers.delayedOnly}
                selectedShipmentId={selection?.kind === "shipment" ? selection.id : null}
                onSelect={(id) => select("shipment", id)}
              />
            )}
            {layers.routes && <ActiveRoutes ids={routeIds} />}
          </BaseMapClient>
        </div>

        {selection && (
          <SelectionDrawer
            selection={selection}
            districts={districtRows}
            facility={selection.kind === "facility" ? (facilityRows.find((f) => f.id === selection.id) ?? null) : null}
            shipment={selection.kind === "shipment" ? (shipmentRows.find((s) => s.id === selection.id) ?? null) : null}
            onClose={() => setSelection(null)}
          />
        )}
      </div>
    </div>
  );
}
