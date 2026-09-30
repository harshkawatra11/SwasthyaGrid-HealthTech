"use client";

import { useMemo, useState } from "react";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { MultiLineForecast } from "@/components/charts/MultiLineForecast";
import { StackedRiskBars } from "@/components/charts/StackedRiskBars";
import { VolumeComposed } from "@/components/charts/VolumeComposed";
import { seriesColor } from "@/components/charts/common";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { useFootfall } from "@/lib/api/hooks";
import type { FootfallForecast, StateSummary, StatusBreakdown, VolumeSeries } from "@/lib/api/types";
import { STATUS_LABEL, statusVar, type ShipmentStatus } from "@/lib/domain";
import { DISTRICT_IDS, type Scope } from "@/lib/scope";
import fixtureByDistrict from "@/data/fixtures/footfall__by-district.json";
import { Panel, PanelSkeleton, SOURCE_SEED, SOURCE_SIM } from "./Panel";
import {
  SCENARIOS,
  footfallPeak,
  footfallRows,
  footfallTitle,
  peakVolumeDay,
  riskMixTitle,
  shortDistrict,
  volumeTitle,
  type FootfallScenario,
} from "./titles";

/** Five explicit calls: the number of districts is fixed, and hooks must not run in a loop. */
export function useDistrictFootfalls(): Array<{ id: string; forecast: FootfallForecast | null }> {
  const a = useFootfall(DISTRICT_IDS[0]);
  const b = useFootfall(DISTRICT_IDS[1]);
  const c = useFootfall(DISTRICT_IDS[2]);
  const d = useFootfall(DISTRICT_IDS[3]);
  const e = useFootfall(DISTRICT_IDS[4]);
  const fixtures = fixtureByDistrict as unknown as Record<string, FootfallForecast>;
  return [a, b, c, d, e].map((r, i) => {
    const id = DISTRICT_IDS[i];
    const forecast = r.offline ? (fixtures[id] ?? null) : (r.data ?? null);
    return { id, forecast };
  });
}

const dateLabel = (v: string | number) => {
  const d = new Date(`${String(v)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function FootfallCard({
  footfalls,
  summary,
  scope,
}: {
  footfalls: Array<{ id: string; forecast: FootfallForecast | null }>;
  summary: StateSummary | undefined;
  scope: Scope;
}) {
  const [scenario, setScenario] = useState<FootfallScenario>("realistic");
  const names = useMemo(() => Object.fromEntries((summary?.districts ?? []).map((d) => [d.district_id, shortDistrict(d.name)])), [summary]);
  const ready = footfalls.some((f) => f.forecast);
  const scoped = scope === "all" ? null : footfalls.find((f) => f.id === scope) ?? null;
  const visible = scope === "all" ? footfalls : footfalls.filter((f) => f.id === scope);
  const rows = useMemo(() => footfallRows(visible, scenario), [visible, scenario]);
  const ids = visible.map((f) => f.id);

  // Scoped view: actual against predicted for the one district.
  const scopedRows = useMemo(() => {
    const s = scoped?.forecast?.series ?? [];
    const f = SCENARIOS[scenario].factor;
    return s.map((p) => ({
      day: String(p.day),
      actual: typeof p.actual === "number" ? p.actual : null,
      predicted: typeof p.predicted === "number" ? Math.round(p.predicted * (typeof p.actual === "number" ? 1 : f)) : null,
    }));
  }, [scoped, scenario]);

  const breakdown = useMemo(() => {
    const sum: Record<string, number> = {};
    for (const f of visible) for (const [k, v] of Object.entries(f.forecast?.tomorrow_breakdown ?? {})) sum[k] = (sum[k] ?? 0) + v;
    return sum;
  }, [visible]);

  if (!ready || !summary) return <PanelSkeleton className="lg:col-span-4" lines={8} />;

  const firstFuture = scoped
    ? scopedRows.find((r) => r.actual === null)?.day
    : (visible[0]?.forecast?.series.find((s) => typeof s.actual !== "number")?.day as string | undefined);
  const peak = footfallPeak(rows, ids);
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0) || 1;
  const parts = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);

  return (
    <Panel
      className="lg:col-span-4"
      eyebrow="Footfall, next 7 days"
      title={
        scoped
          ? `${names[scope] ?? scope} expects ${scopedRows.find((r) => r.actual === null)?.predicted ?? 0} visits ${scopedRows.find((r) => r.actual === null)?.day ?? "soon"}`
          : footfallTitle(rows, ids, names)
      }
      testId="card-footfall"
      actions={
        <SegmentedControl
          ariaLabel="Scenario"
          value={scenario}
          onChange={setScenario}
          options={SCENARIO_OPTIONS}
        />
      }
      read={
        <>
          <span className="font-medium text-text">{SCENARIOS[scenario].label}:</span> {SCENARIOS[scenario].assumption}. Applies to forecast days only.
          {peak && (
            <span className="ml-1 rounded-sm bg-surface-3 px-1.5 py-0.5 text-[11px] text-text">
              Peak: {names[peak.id] ?? peak.id}, {peak.day}, <span className="num">{peak.value}</span>
            </span>
          )}
        </>
      }
      source={`${SOURCE_SEED}; model forecast, scenario factor client side`}
      section="Command / Demand"
    >
      {scoped ? (
        <MultiLineForecast
          data={scopedRows}
          xKey="day"
          series={[
            { key: "actual", name: "Actual" },
            { key: "predicted", name: "Predicted", dashed: true, color: seriesColor(1) },
          ]}
          forecastFrom={firstFuture}
          height={190}
          unit="visits"
          label="Footfall actual against predicted"
        />
      ) : (
        <MultiLineForecast
          data={rows}
          xKey="day"
          series={footfalls.map((f, i) => ({ key: f.id, name: names[f.id] ?? f.id, color: seriesColor(i) }))}
          forecastFrom={firstFuture}
          height={190}
          unit="visits"
          label="Predicted footfall by district"
        />
      )}
      <div className="mt-2 border-t border-border pt-2" data-testid="tomorrow-breakdown">
        <p className="eyebrow mb-1.5">Tomorrow by patient group</p>
        <div className="flex h-3 overflow-hidden rounded-[3px] bg-surface-2">
          {parts.map(([k, v], i) => (
            <span key={k} title={`${k}: ${v}`} style={{ width: `${(v / total) * 100}%`, backgroundColor: seriesColor(i), borderRight: "2px solid var(--surface-1)" }} />
          ))}
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-muted">
          {parts.map(([k, v], i) => (
            <li key={k} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: seriesColor(i) }} />
              {k} <span className="num text-text">{v}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

const SCENARIO_OPTIONS: Array<{ value: FootfallScenario; label: string }> = [
  { value: "pessimistic", label: "Worst" },
  { value: "realistic", label: "Base" },
  { value: "optimistic", label: "Best" },
];

const STATUS_ORDER: ShipmentStatus[] = ["recommended", "approved", "loading", "in_transit", "delayed", "arrived", "delivered", "cancelled"];

export function VolumeCard({ volume, breakdown }: { volume: VolumeSeries | undefined; breakdown: StatusBreakdown | undefined }) {
  const data = useMemo(
    () => (volume?.points ?? []).map((p) => ({ date: p.date, shipments: p.shipments, delivered: p.delivered, transit: p.avg_transit_hours })),
    [volume],
  );
  if (!volume) return <PanelSkeleton className="lg:col-span-4" lines={8} />;
  const peak = peakVolumeDay(volume);
  const counts = breakdown?.counts ?? {};
  const total = STATUS_ORDER.reduce((s, k) => s + (counts[k] ?? 0), 0) || 1;
  return (
    <Panel
      className="lg:col-span-4"
      eyebrow="Shipments per day, 90 days"
      title={volumeTitle(volume)}
      testId="card-volume"
      read={
        <>
          Read: bars are shipments created, the line is delivered, the lower chart is average transit hours.
          {peak && (
            <span className="ml-1 rounded-sm bg-surface-3 px-1.5 py-0.5 text-[11px] text-text">
              Peak: <span className="num">{peak.shipments}</span> on {dateLabel(peak.date)}
            </span>
          )}
        </>
      }
      source={`${SOURCE_SIM}; 90 day history`}
      section="Command / Supply chain"
    >
      <VolumeComposed
        data={data}
        xKey="date"
        bar={{ key: "shipments", name: "Shipments" }}
        line={{ key: "delivered", name: "Delivered" }}
        height={130}
        unit="shipments"
        xFormatter={dateLabel}
        label="Shipments per day"
      />
      <p className="eyebrow mb-0.5 mt-1">Average transit, hours</p>
      <AreaTrend data={data} xKey="date" series={[{ key: "transit", name: "Avg transit, hours", color: seriesColor(3) }]} height={64} unit="h" xFormatter={dateLabel} label="Average transit hours" />
      <div className="mt-2 border-t border-border pt-2" data-testid="status-mix">
        <p className="eyebrow mb-1.5">Status mix today</p>
        <div className="flex h-3 overflow-hidden rounded-[3px] bg-surface-2">
          {STATUS_ORDER.filter((k) => (counts[k] ?? 0) > 0).map((k) => (
            <span key={k} title={`${STATUS_LABEL[k]}: ${counts[k]}`} style={{ width: `${((counts[k] ?? 0) / total) * 100}%`, backgroundColor: statusVar(k), borderRight: "2px solid var(--surface-1)" }} />
          ))}
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-muted">
          {STATUS_ORDER.filter((k) => (counts[k] ?? 0) > 0).map((k) => (
            <li key={k} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: statusVar(k) }} />
              {STATUS_LABEL[k]} <span className="num text-text">{counts[k]}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

export function RiskMixCard({ all, scope }: { all: StateSummary | undefined; scope: Scope }) {
  const data = useMemo(
    () => (all?.districts ?? []).map((d) => ({ district: shortDistrict(d.name), ...d.risk_counts })),
    [all],
  );
  if (!all) return <PanelSkeleton className="lg:col-span-4" lines={8} />;
  const rows = all.districts;
  const t = all.totals;
  return (
    <Panel
      className="lg:col-span-4"
      eyebrow="Risk mix by district"
      title={riskMixTitle(rows)}
      testId="card-risk-mix"
      read={
        scope === "all"
          ? "Read: every district holds 8 facilities, so the stack height is the same and the colour split is the comparison."
          : `Read: the state has ${t.risk_counts.critical} critical facilities; ${shortDistrict(rows.find((d) => d.district_id === scope)?.name ?? scope)} is one of five peers.`
      }
      source={`${SOURCE_SEED}; risk level per facility`}
      section="Command / Districts"
    >
      <StackedRiskBars data={data} categoryKey="district" height={240} label="Facilities by risk level per district" />
      <div className="mt-2 grid grid-cols-4 gap-2 border-t border-border pt-2 text-center">
        {(["healthy", "monitor", "stress", "critical"] as const).map((k) => (
          <div key={k}>
            <p className="num text-[18px] font-semibold text-text">{t.risk_counts[k]}</p>
            <p className="eyebrow">{k}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
