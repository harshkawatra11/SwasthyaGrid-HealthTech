"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BaseMapClient, ChoroplethLayerClient, FacilityLayerClient, LiveTruckLayerClient, WarehouseLayerClient } from "@/components/map/client";
import type { MapFacility, MapWarehouse } from "@/components/map/client";
import { useLivePositions } from "@/lib/live/LiveProvider";
import { cn } from "@/lib/cn";
import type { DistrictSummaryRow, Facility, StateSummary, WarehouseSummary } from "@/lib/api/types";
import { fmtPct } from "@/lib/format";
import { heatColor, heatLegend } from "@/lib/heat";
import type { Scope } from "@/lib/scope";
import { Panel, PanelSkeleton, SOURCE_SEED, ToggleChip } from "./Panel";
import { DRIVER_KEYS, DRIVER_LABEL, RISK_SCALE, indexDrivers, leagueTitle, mapTitle, shortDistrict, topDriver } from "./titles";
import { seriesColor } from "@/components/charts/common";

const MAP_HEIGHT = 400;

export function RiskMapCard({
  all,
  facilities,
  warehouses,
  scope,
  onScope,
}: {
  all: StateSummary | undefined;
  facilities: Facility[];
  warehouses: WarehouseSummary[];
  scope: Scope;
  onScope: (s: Scope) => void;
}) {
  const router = useRouter();
  const positions = useLivePositions();
  const [showFacilities, setShowFacilities] = useState(true);
  const [showTrucks, setShowTrucks] = useState(true);
  const [showWarehouses, setShowWarehouses] = useState(false);

  const values = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of all?.districts ?? []) out[d.district_id] = d.risk_index;
    return out;
  }, [all]);

  const mapFacilities: MapFacility[] = useMemo(
    () => facilities.map((f) => ({ id: f.id, name: f.name, lat: f.lat, lng: f.lng, risk: f.risk_level })),
    [facilities],
  );
  const mapWarehouses: MapWarehouse[] = useMemo(
    () => warehouses.map((w) => ({ id: w.id, name: w.name, lat: w.lat, lng: w.lng, central: w.type === "central" })),
    [warehouses],
  );
  const fit = useMemo(
    () =>
      facilities
        .filter((f) => scope === "all" || f.district_id === scope)
        .map((f) => [f.lat, f.lng] as [number, number]),
    [facilities, scope],
  );

  if (!all) return <PanelSkeleton className="lg:col-span-8" lines={9} />;

  const worst = [...all.districts].sort((a, b) => b.risk_index - a.risk_index)[0];
  const legend = heatLegend(RISK_SCALE);

  return (
    <Panel
      className="lg:col-span-8"
      eyebrow="District risk index"
      title={mapTitle(all)}
      live
      testId="card-map"
      actions={
        <div className="flex gap-1.5" role="group" aria-label="Map layers">
          <ToggleChip pressed={showFacilities} onClick={() => setShowFacilities((v) => !v)}>
            Facilities
          </ToggleChip>
          <ToggleChip pressed={showTrucks} onClick={() => setShowTrucks((v) => !v)}>
            Live trucks
          </ToggleChip>
          <ToggleChip pressed={showWarehouses} onClick={() => setShowWarehouses((v) => !v)}>
            Warehouses
          </ToggleChip>
        </div>
      }
      read={
        <>
          Read: click a district to scope the whole page to it; dot size marks critical facilities. Risk index blends critical share,
          stock-outs, bed pressure and absence risk.
        </>
      }
      source={`${SOURCE_SEED}; boundaries geoBoundaries (ODbL)`}
      section="Command / Geo"
      bodyClassName="pb-2"
    >
      <div className="relative">
        <BaseMapClient height={MAP_HEIGHT} fitPoints={fit}>
          <ChoroplethLayerClient
            values={values}
            scale={RISK_SCALE}
            selectedId={scope === "all" ? null : scope}
            onSelect={(id) => onScope(id)}
            describe={(id) => {
              const d = all.districts.find((x) => x.district_id === id);
              return d ? `Risk index ${d.risk_index}, ${d.risk_counts.critical} critical` : undefined;
            }}
          />
          {showFacilities && <FacilityLayerClient facilities={mapFacilities} onSelect={(id) => router.push(`/facilities/${id}`)} />}
          {showWarehouses && <WarehouseLayerClient warehouses={mapWarehouses} />}
          {showTrucks && <LiveTruckLayerClient store={positions} />}
        </BaseMapClient>
        {worst && (
          <div className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-[220px] rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1.5 text-[11px] leading-snug text-text shadow-[var(--shadow-overlay)]">
            <span className="eyebrow block">Highest risk</span>
            {shortDistrict(worst.name)}: index <span className="num font-semibold">{worst.risk_index}</span>,{" "}
            <span className="num">{worst.risk_counts.critical}</span> critical
          </div>
        )}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] flex items-center gap-2 rounded-sm border border-border-strong bg-surface-2 px-2 py-1 text-[10px] text-muted">
          <span className="eyebrow">Index</span>
          {legend.map((l, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-3.5 rounded-[2px]" style={{ backgroundColor: `var(--heat-${i})` }} />
              <span className="num">{l.replace("<= ", "").replace("> ", ">")}</span>
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function IndexBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="num w-6 text-right text-text">{value}</span>
      <span className="block h-2 w-14 rounded-full bg-surface-3" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, backgroundColor: heatColor(value, RISK_SCALE) }} />
      </span>
    </div>
  );
}

export function LeagueTableCard({ all, scope, className }: { all: StateSummary | undefined; scope: Scope; className?: string }) {
  const router = useRouter();
  if (!all) return <PanelSkeleton className="lg:col-span-4" lines={7} />;
  const rows = all.districts;
  const t = all.totals;
  const avgIndex = rows.length ? Math.round(rows.reduce((s, r) => s + r.risk_index, 0) / rows.length) : 0;

  const ranked = [...rows].sort((a, b) => b.risk_index - a.risk_index);

  return (
    <Panel
      className={cn("lg:col-span-4", className)}
      eyebrow="District league table"
      title={leagueTitle(rows)}
      testId="card-league"
      read="Read: crit = critical facilities, out = stock lines under 3 days, beds = forecast occupancy next week, on time = shipments in the last 7 days."
      source={`${SOURCE_SEED}; risk index per insights spec`}
      section="Command / Districts"
      bodyClassName="px-0"
    >
      <table className="w-full border-collapse text-[12px]" data-testid="league-table">
        <thead className="bg-surface-2">
          <tr className="text-left text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
            <th scope="col" className="py-1.5 pl-4 pr-1">District</th>
            <th scope="col" className="px-1 py-1.5">Risk index</th>
            <th scope="col" className="px-1 py-1.5 text-right" title="Critical facilities">Crit</th>
            <th scope="col" className="px-1 py-1.5 text-right" title="Stock lines under 3 days">Out</th>
            <th scope="col" className="px-1 py-1.5 text-right" title="Forecast bed occupancy next week">Beds</th>
            <th scope="col" className="py-1.5 pl-1 pr-4 text-right" title="On-time shipments, 7 days">On time</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
            <tr
              key={r.district_id}
              tabIndex={0}
              onClick={() => router.push(`/districts/${r.district_id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter") router.push(`/districts/${r.district_id}`);
              }}
              className="cursor-pointer border-t border-border hover:bg-surface-3"
            >
              <td className="py-2 pl-4 pr-1">
                <span className="num mr-1.5 text-faint">{i + 1}</span>
                <span className={r.district_id === scope ? "font-semibold text-brand" : "text-text"}>{shortDistrict(r.name)}</span>
              </td>
              <td className="px-1 py-2">
                <IndexBar value={r.risk_index} />
              </td>
              <td className="num px-1 py-2 text-right">{r.risk_counts.critical}</td>
              <td className="num px-1 py-2 text-right">{r.stockout_items}</td>
              <td className="num px-1 py-2 text-right">{fmtPct(r.bed_next_week_avg)}</td>
              <td className="num py-2 pl-1 pr-4 text-right">{fmtPct(r.on_time_rate_7d * 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <DriverBars rows={rows} />
      <div className="num flex items-center justify-between border-t border-border bg-surface-2 px-3 py-1.5 text-[11px] text-muted">
        <span className="eyebrow">State</span>
        <span>index {avgIndex}</span>
        <span>{t.risk_counts.critical} crit</span>
        <span>{t.stockout_items} out</span>
        <span>{fmtPct(t.bed_next_week_avg)}</span>
        <span>{fmtPct(t.on_time_rate_7d * 100)}</span>
      </div>
    </Panel>
  );
}

function DriverBars({ rows }: { rows: DistrictSummaryRow[] }) {
  const sorted = [...rows].sort((a, b) => b.risk_index - a.risk_index);
  const max = Math.max(1, ...sorted.map((r) => DRIVER_KEYS.reduce((s, k) => s + indexDrivers(r)[k], 0)));
  return (
    <div className="border-t border-border px-4 py-3" data-testid="index-drivers">
      <p className="eyebrow mb-2">What drives the index (points)</p>
      <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
        {DRIVER_KEYS.map((k, i) => (
          <li key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: seriesColor(i) }} />
            {DRIVER_LABEL[k]}
          </li>
        ))}
      </ul>
      <div className="space-y-1.5">
        {sorted.map((r) => {
          const v = indexDrivers(r);
          return (
            <div key={r.district_id} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-[11px]">
              <span className="truncate text-muted">{shortDistrict(r.name)}</span>
              <span className="flex h-2.5 overflow-hidden rounded-[3px] bg-surface-2" style={{ width: "100%" }} title={`${shortDistrict(r.name)}: largest driver ${DRIVER_LABEL[topDriver(r)]}`}>
                {DRIVER_KEYS.map((k, i) => (
                  <span key={k} style={{ width: `${(v[k] / max) * 100}%`, backgroundColor: seriesColor(i), borderRight: "2px solid var(--surface-1)" }} />
                ))}
              </span>
              <span className="text-faint">{DRIVER_LABEL[topDriver(r)]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
