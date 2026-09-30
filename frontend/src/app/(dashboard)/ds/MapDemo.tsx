"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ds/Card";
import {
  BaseMapClient,
  ChoroplethLayerClient,
  FacilityLayerClient,
  LiveTruckLayerClient,
  RouteLayerClient,
  WarehouseLayerClient,
  type MapFacility,
  type MapWarehouse,
} from "@/components/map/client";
import { createPositionsStore, type LivePosition } from "@/lib/live/positions-store";
import { bearing, lerpLatLng, type LatLng } from "@/lib/map/geo";
import type { HeatScale } from "@/lib/heat";

const SCALE: HeatScale = { thresholds: [20, 40, 60, 80], higherIsWorse: true };

const DISTRICT_VALUES: Record<string, number> = {
  district_jaipur_rural: 55,
  district_alwar: 35,
  district_bikaner: 78,
  district_udaipur: 22,
  district_kota: 88,
};

const FACILITIES: MapFacility[] = [
  { id: "f1", name: "PHC Kota-4", lat: 25.18, lng: 75.86, risk: "critical", worstMedicine: "ARV, 1.5 days" },
  { id: "f2", name: "CHC Kota-2", lat: 25.35, lng: 75.7, risk: "monitor" },
  { id: "f3", name: "PHC Jaipur-9", lat: 26.75, lng: 75.55, risk: "healthy" },
  { id: "f4", name: "PHC Nindar", lat: 26.83, lng: 75.75, risk: "stress", worstMedicine: "ORS, 4 days" },
  { id: "f5", name: "PHC Alwar-4", lat: 27.55, lng: 76.7, risk: "stress" },
  { id: "f6", name: "PHC Alwar-1", lat: 27.7, lng: 76.4, risk: "healthy" },
  { id: "f7", name: "CHC Bikaner-2", lat: 28.05, lng: 73.4, risk: "critical", worstMedicine: "Insulin, 2 days" },
  { id: "f8", name: "PHC Bikaner-6", lat: 28.3, lng: 73.1, risk: "monitor" },
  { id: "f9", name: "PHC Udaipur-1", lat: 24.6, lng: 73.7, risk: "healthy" },
  { id: "f10", name: "CHC Udaipur-3", lat: 24.9, lng: 73.9, risk: "healthy" },
];

const WAREHOUSES: MapWarehouse[] = [
  { id: "w0", name: "Central Medical Store, Jaipur", lat: 26.91, lng: 75.79, central: true },
  { id: "w1", name: "Kota Warehouse", lat: 25.21, lng: 75.83 },
  { id: "w2", name: "Bikaner Warehouse", lat: 28.02, lng: 73.31 },
  { id: "w3", name: "Udaipur Warehouse", lat: 24.58, lng: 73.71 },
  { id: "w4", name: "Alwar Warehouse", lat: 27.56, lng: 76.61 },
];

function densify(points: LatLng[], perSegment = 20): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    for (let k = 0; k < perSegment; k++) out.push(lerpLatLng(points[i], points[i + 1], k / perSegment));
  }
  out.push(points[points.length - 1]);
  return out;
}

const ROUTE_A = densify([[26.91, 75.79], [26.4, 75.86], [25.9, 75.82], [25.4, 75.85], [25.18, 75.86]]);
const ROUTE_B = densify([[28.02, 73.31], [27.6, 74.2], [27.2, 75.0], [26.91, 75.79]]);

function at(route: LatLng[], progress: number): { p: LatLng; b: number; idx: number } {
  const idx = Math.min(route.length - 2, Math.floor(progress * (route.length - 1)));
  return { p: route[idx], b: bearing(route[idx], route[idx + 1]), idx };
}

const STEP = 0.01;

export function MapDemo() {
  const store = useMemo(() => createPositionsStore(), []);
  const [progress, setProgress] = useState(0.15);
  const [selected, setSelected] = useState<string | null>("SHP-2001");

  useEffect(() => {
    let a = 0.15;
    let b = 0.3;
    const tick = () => {
      a = a >= 0.99 ? 0.02 : a + STEP;
      b = b >= 0.99 ? 0.02 : b + STEP * 0.7;
      const pa = at(ROUTE_A, a);
      const pb = at(ROUTE_B, b);
      const items: LivePosition[] = [
        { shipment_id: "SHP-2001", vehicle_id: "RJ14-GB-1042", lat: pa.p[0], lng: pa.p[1], bearing: pa.b, speed_kmh: 52, progress: a, status: "in_transit" },
        { shipment_id: "SHP-2002", vehicle_id: "RJ07-CA-2210", lat: pb.p[0], lng: pb.p[1], bearing: pb.b, speed_kmh: 38, progress: b, status: "delayed" },
      ];
      store.publish(items);
      setProgress(a);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [store]);

  const fitPoints = useMemo<LatLng[]>(() => FACILITIES.map((f) => [f.lat, f.lng]), []);
  const travelledIndex = Math.floor(progress * (ROUTE_A.length - 1));

  return (
    <Card title="Map kit" eyebrow="C7" live footer="Sample data. Boundary: geoBoundaries (ODbL). Tiles follow the active theme.">
      <BaseMapClient height={460} fitPoints={fitPoints} scrollWheelZoom>
        <ChoroplethLayerClient
          values={DISTRICT_VALUES}
          scale={SCALE}
          describe={(id) => `Risk score ${DISTRICT_VALUES[id] ?? "n/a"}`}
        />
        <RouteLayerClient
          path={ROUTE_A}
          travelledIndex={travelledIndex}
          status="in_transit"
          origin={{ lat: 26.91, lng: 75.79, label: "Central Medical Store" }}
          destination={{ lat: 25.18, lng: 75.86, label: "PHC Kota-4" }}
        />
        <FacilityLayerClient facilities={FACILITIES} />
        <WarehouseLayerClient warehouses={WAREHOUSES} />
        <LiveTruckLayerClient store={store} selectedShipmentId={selected} onSelect={setSelected} />
      </BaseMapClient>
    </Card>
  );
}
