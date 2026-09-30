"use client";

import { useMemo } from "react";
import { Skeleton } from "@/components/ds/Skeleton";
import { KpiTile } from "@/components/ds/KpiTile";
import { PageHeader } from "@/components/ds/PageHeader";
import { HeatmapMatrix } from "@/components/ds/HeatmapMatrix";
import { MultiLineForecast } from "@/components/charts/MultiLineForecast";
import { seriesColor } from "@/components/charts/common";
import { useMedicineMatrix, useStateSummary } from "@/lib/api/hooks";
import { useScope, withScope } from "@/lib/scope";
import { ComparisonMatrix } from "./ComparisonMatrix";
import { DistrictCard } from "./DistrictCard";
import { useDistrictFootfalls, toSeries } from "./data";
import { Callout, COVER_SCALE, InsightCard, Moneyshot } from "./kit";
import {
  footfallTitle,
  heatTitle,
  leagueTitle,
  peakDay,
  shortMedicine,
  shortName,
  topShortage,
} from "./metrics";

export function DistrictsLab() {
  const { scope } = useScope();
  const all = useStateSummary("all");
  const scoped = useStateSummary(scope);
  const matrix = useMedicineMatrix("all");
  const footfalls = useDistrictFootfalls();

  const summary = all.data;
  const rows = useMemo(() => summary?.districts ?? [], [summary]);
  const series = useMemo(() => {
    const out: Record<string, ReturnType<typeof toSeries>> = {};
    for (const r of rows) out[r.district_id] = toSeries(footfalls[r.district_id]);
    return out;
  }, [rows, footfalls]);

  const axis = useMemo(() => {
    const vals = Object.values(series).flatMap((s) => s.map((p) => p.actual ?? p.predicted ?? 0)).filter((v) => v > 0);
    return { min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 1 };
  }, [series]);

  if (!summary || rows.length === 0 || !matrix.data) {
    return (
      <div>
        <PageHeader eyebrow="Districts" title="District comparison lab" />
        <div className="grid gap-3 xl:grid-cols-5 md:grid-cols-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[430px]" />
          ))}
        </div>
      </div>
    );
  }

  const ranked = [...rows].sort((a, b) => b.risk_index - a.risk_index);
  const rankOf = (id: string) => ranked.findIndex((r) => r.district_id === id) + 1;
  const mdata = matrix.data;
  const tot = (scoped.data ?? summary).totals;
  const top = ranked[0];

  const spark = (f: (r: (typeof rows)[number]) => number) => rows.map(f);
  const peaks = rows
    .map((r) => {
      const p = peakDay(series[r.district_id] ?? []);
      return p ? { name: shortName(r.name), ...p } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b.value - a.value);

  const worstCell = mdata.cells.filter((c) => c.min_days_remaining !== null).sort((a, b) => (a.min_days_remaining as number) - (b.min_days_remaining as number))[0];
  const worstDistrict = rows.find((r) => r.district_id === worstCell?.district_id);

  const dayKeys = (series[rows[0].district_id] ?? []).map((p) => p.day);
  const footRows = dayKeys.map((day, i) => {
    const row: Record<string, string | number | null> = { day };
    for (const r of rows) {
      const p = series[r.district_id]?.[i];
      row[r.district_id] = p ? (p.actual ?? p.predicted ?? null) : null;
    }
    return row;
  });
  const forecastFrom = (series[rows[0].district_id] ?? []).find((p) => p.actual === undefined)?.day;

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Districts / Comparison lab"
        title="Five districts, one yardstick"
        description="Every card and chart uses the same axes, so a bar or a colour means the same thing in each district."
        actions={
          <Moneyshot
            value={top.risk_index}
            unit="risk index"
            label={`${shortName(top.name)} is the district to watch, ${top.risk_counts.critical} critical ${top.risk_counts.critical === 1 ? "facility" : "facilities"}`}
            href={`/districts/${top.district_id}`}
          />
        }
      />

      {/* KPI band: never the main event */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Critical facilities" value={tot.risk_counts.critical} unit={`of ${tot.facilities}`} tone="critical" href={withScope("/facilities?risk=critical", scope)} sparkline={spark((r) => r.risk_counts.critical)} hint="Spark: by district" />
        <KpiTile label="Stock-out items" value={tot.stockout_items} tone="critical" href={withScope("/inventory", scope)} sparkline={spark((r) => r.stockout_items)} hint="Under 3 days" />
        <KpiTile label="Beds next week" value={Math.round(tot.bed_next_week_avg)} unit="%" tone={tot.bed_next_week_avg > 85 ? "critical" : "warning"} href={withScope("/beds", scope)} sparkline={spark((r) => r.bed_next_week_avg)} hint="Average occupancy" />
        <KpiTile label="Pending approvals" value={tot.pending_recommendations} href={withScope("/recommendations", scope)} sparkline={spark((r) => r.pending_recommendations)} hint="Awaiting an officer" />
        <KpiTile label="In transit" value={tot.shipments_in_transit} href={withScope("/supply", scope)} sparkline={spark((r) => r.shipments_in_transit)} hint="Shipments on the road" />
        <KpiTile label="On time, 7 days" value={Math.round(tot.on_time_rate_7d * 100)} unit="%" tone={tot.on_time_rate_7d < 0.7 ? "warning" : "good"} href={withScope("/supply", scope)} sparkline={spark((r) => r.on_time_rate_7d * 100)} hint="Simulated deliveries" />
      </div>

      {/* Hero: five identical small multiples */}
      <section aria-label="District small multiples">
        <div className="mb-1 flex items-baseline justify-between">
          <div>
            <p className="eyebrow">Small multiples</p>
            <h2 className="text-[14px] font-semibold text-text">{leagueTitle(rows)}</h2>
          </div>
          <p className="text-[11px] text-faint">Ranked by risk index, left to right. Sparklines share one axis.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {ranked.map((r) => (
            <DistrictCard
              key={r.district_id}
              row={r}
              rank={rankOf(r.district_id)}
              series={series[r.district_id] ?? []}
              axis={axis}
              shortage={topShortage(mdata, r.district_id)}
              facilityName={r.critical_facilities[0]?.name}
              selected={scope === r.district_id}
              dimmed={scope !== "all" && scope !== r.district_id}
            />
          ))}
        </div>
      </section>

      <InsightCard
        eyebrow="Comparison matrix"
        title={`${shortName(top.name)} leads on ${rows.length > 1 ? "risk index" : "risk"}; each column is coloured against the other four districts`}
        section="Districts / Matrix"
        source="Source: SwasthyaGrid insights/state-summary. Colours rank each metric across districts. Click a cell for the rows behind it."
        read="Read across a row to see where a district is weak, down a column to see who is the outlier."
        bodyClassName="p-0"
      >
        <ComparisonMatrix rows={rows} scope={scope} />
      </InsightCard>

      <div className="grid gap-3 lg:grid-cols-12">
        <InsightCard
          className="lg:col-span-5"
          eyebrow="Lowest days of cover, medicine by district"
          title={heatTitle(mdata)}
          section="Districts / Medicines"
          source="Source: insights/medicine-matrix, days of cover = units / average daily use"
          read="Red cells are under 3 days. Click a cell to open the inventory for that district."
        >
          <HeatmapMatrix
            rows={[...mdata.medicines].sort((a, b) => Number(b.emergency) - Number(a.emergency)).map((m) => ({ id: m.name, label: shortMedicine(m.name), group: m.emergency ? "Emergency medicines" : "Essential medicines" }))}
            cols={mdata.districts.map((d) => ({ id: d.id, label: shortName(d.name) }))}
            value={(rid, cid) => mdata.cells.find((c) => c.medicine_name === rid && c.district_id === cid)?.min_days_remaining ?? null}
            scale={COVER_SCALE}
            format={(v) => `${v}d`}
            cellSize={38}
          />
          {worstCell && worstDistrict && (
            <div className="mt-2">
              <Callout tone="critical">
                {shortMedicine(worstCell.medicine_name)} in {shortName(worstDistrict.name)}: {worstCell.min_days_remaining} days, {worstCell.facilities_below_threshold} facilities below threshold
              </Callout>
            </div>
          )}
        </InsightCard>
        <InsightCard
          className="lg:col-span-7"
          eyebrow="Footfall forecast, five districts"
          title={footfallTitle(peaks[0] ?? null)}
          section="Districts / Footfall"
          source="Source: footfall/forecast per district, actual up to Friday, model forecast after"
          read="Lines share one axis. Districts that rise together need the same surge stock."
        >
          <MultiLineForecast
            data={footRows}
            xKey="day"
            forecastFrom={forecastFrom}
            series={rows.map((r, i) => ({ key: r.district_id, name: shortName(r.name), color: seriesColor(i) }))}
            unit="visits"
            height={260}
          />
          {peaks[0] && <div className="mt-2"><Callout>{peaks[0].name} peaks on {peaks[0].day} at {peaks[0].value} visits</Callout></div>}
        </InsightCard>
      </div>
    </div>
  );
}
