"use client";

import { useMemo } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { AXIS_TICK, CHART_MARGIN, CURSOR_LINE, GRID_PROPS, ChartLegend } from "@/components/charts/common";
import { heatBin, heatColor, heatLegend } from "@/lib/heat";
import { cn } from "@/lib/cn";
import {
  FOOTFALL_SCALE,
  fanSeries,
  footfallPoints,
  forecastStart,
  shortDistrict,
} from "./derive";
import { HeatLegend, heatInk } from "./kit";
import type { FootfallForecast } from "@/lib/api/types";

/** Actual, predicted and a confidence band that widens with the horizon. */
export function FanChart({
  forecast,
  factor,
  height = 320,
}: {
  forecast: FootfallForecast;
  factor: number;
  height?: number;
}) {
  const pts = useMemo(() => footfallPoints(forecast), [forecast]);
  const fan = useMemo(() => fanSeries(pts, forecast.confidence, factor), [pts, forecast.confidence, factor]);
  const start = forecastStart(pts);
  const lows = fan.map((f) => f.lo ?? f.actual ?? 0).filter((v) => v > 0);
  const highs = fan.map((f) => Math.max(f.hi ?? 0, f.actual ?? 0));
  const yMin = Math.max(0, Math.floor((Math.min(...lows) - 15) / 10) * 10);
  const yMax = Math.ceil((Math.max(...highs) + 20) / 10) * 10;
  const peak = fan.slice(start).reduce<(typeof fan)[number] | null>((a, b) => ((b.predicted ?? 0) > (a?.predicted ?? -1) ? b : a), null);
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Actual visits", color: "var(--text)" },
          { label: "Predicted visits", color: "var(--series-1)", dashed: true },
          { label: `Confidence band (${forecast.confidence}%)`, color: "var(--series-1)" },
        ]}
      />
      <div style={{ height }} role="img" aria-label="Footfall forecast with confidence band">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 700, height }}>
          <ComposedChart data={fan} margin={{ ...CHART_MARGIN, top: 20, right: 44 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} allowDataOverflow domain={[yMin, yMax]} allowDecimals={false} />
            <RTooltip cursor={CURSOR_LINE} content={<ChartTooltip unit="visits" />} />
            <Area type="monotone" dataKey="lo" stackId="band" stroke="none" fill="transparent" name="Band low" isAnimationActive={false} activeDot={false} legendType="none" />
            <Area type="monotone" dataKey="band" stackId="band" stroke="none" fill="var(--series-1)" fillOpacity={0.2} name="Band width" isAnimationActive={false} activeDot={false} />
            {start < fan.length && start > 0 && (
              <ReferenceLine x={fan[start].day} stroke="var(--border-strong)" strokeDasharray="4 4" label={{ value: "Forecast starts", position: "insideTopLeft", fill: "var(--text-faint)", fontSize: 11 }} />
            )}
            <Line type="monotone" dataKey="predicted" name="Predicted" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="actual" name="Actual" stroke="var(--text)" strokeWidth={2} dot={{ r: 3, fill: "var(--surface-1)", stroke: "var(--text)", strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
            {peak && (
              <ReferenceDot
                x={peak.day}
                y={peak.predicted ?? 0}
                r={5}
                fill="var(--series-1)"
                stroke="var(--surface-1)"
                strokeWidth={2}
                label={{ value: `Peak ${peak.predicted}`, position: "top", fill: "var(--text)", fontSize: 11, fontWeight: 600 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** District rows by day columns; cell is predicted visits. A ring marks days with an observed actual. */
export function FootfallCalendar({
  data,
  selected,
  factor,
  onSelect,
}: {
  data: Array<{ districtId: string; forecast: FootfallForecast }>;
  selected: string;
  factor: number;
  onSelect: (id: string) => void;
}) {
  const days = useMemo(() => (data[0] ? footfallPoints(data[0].forecast).map((p) => p.day) : []), [data]);
  const legend = heatLegend(FOOTFALL_SCALE);
  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `130px repeat(${days.length}, minmax(56px, 1fr)) 70px` }}>
        <div />
        {days.map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-medium text-muted">
            {d}
          </div>
        ))}
        <div className="pb-1 text-right text-[11px] font-medium text-muted">7 day</div>
        {data.map(({ districtId, forecast }) => {
          const pts = footfallPoints(forecast);
          const start = forecastStart(pts);
          const total = pts.reduce((s, p, i) => s + Math.round((p.predicted ?? 0) * (i >= start ? factor : 1)), 0);
          return (
            <div key={districtId} className="contents">
              <button
                type="button"
                onClick={() => onSelect(districtId)}
                className={cn("truncate text-left text-[12px] leading-[38px] hover:text-brand", districtId === selected ? "font-semibold text-text" : "text-muted")}
              >
                {shortDistrict(districtId)}
              </button>
              {pts.map((p, i) => {
                const v = p.predicted === null ? null : Math.round(p.predicted * (i >= start ? factor : 1));
                return (
                  <div
                    key={p.day}
                    title={`${shortDistrict(districtId)} ${p.day}: ${v ?? "n/a"} predicted visits${p.actual !== null ? `, ${p.actual} observed` : ""}`}
                    className="num flex h-[32px] items-center justify-center rounded-[4px] text-[12px] font-semibold"
                    style={{
                      backgroundColor: heatColor(v, FOOTFALL_SCALE),
                      color: heatInk(v === null ? null : heatBin(v, FOOTFALL_SCALE)),
                      outline: p.actual !== null ? "2px solid var(--border-strong)" : undefined,
                      outlineOffset: -2,
                    }}
                  >
                    {v ?? "-"}
                  </div>
                );
              })}
              <div className="num text-right text-[12px] font-semibold leading-[38px] text-text">{total}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <HeatLegend labels={legend} />
        <span className="text-[11px] text-muted">Outlined cells already have an observed count; the value shown is the model prediction.</span>
      </div>
    </div>
  );
}

const GROUP_LABEL: Record<string, string> = {
  children: "Children",
  women: "Women",
  elderly: "Elderly",
  emergency: "Emergency",
  general: "General",
};

export function TomorrowBreakdown({ breakdown, factor }: { breakdown: Record<string, number>; factor: number }) {
  const entries = Object.entries(breakdown)
    .map(([k, v]) => ({ key: k, label: GROUP_LABEL[k] ?? k, v: Math.round(v * factor) }))
    .sort((a, b) => b.v - a.v);
  const total = entries.reduce((s, e) => s + e.v, 0);
  const max = Math.max(1, ...entries.map((e) => e.v));
  return (
    <ul className="space-y-2">
      {entries.map((e, i) => (
        <li key={e.key} className="grid grid-cols-[72px_1fr_64px] items-center gap-2 text-[12px]">
          <span className="text-muted">{e.label}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full" style={{ width: `${(e.v / max) * 100}%`, backgroundColor: e.key === "emergency" ? "var(--risk-stress)" : i === 0 ? "var(--series-1)" : "var(--series-1)", opacity: i === 0 || e.key === "emergency" ? 1 : 0.6 }} />
          </div>
          <span className="num text-right text-text">
            {e.v} <span className="text-faint">{total ? Math.round((e.v / total) * 100) : 0}%</span>
          </span>
        </li>
      ))}
      <li className="border-t border-border pt-2 text-right text-[12px] text-muted">
        Total <span className="num font-semibold text-text">{total}</span> visits
      </li>
    </ul>
  );
}

export function FactorChips({ factors }: { factors: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {factors.map((f) => (
        <li key={f} className="rounded-full border border-border-strong bg-surface-2 px-2.5 py-1 text-[11px] text-muted">
          {f}
        </li>
      ))}
    </ul>
  );
}

/** One identical small multiple per district: tomorrow number, delta against the state mean and a 7 day area. */
export function DistrictMultiple({
  districtId,
  forecast,
  factor,
  stateMean,
  active,
  onSelect,
}: {
  districtId: string;
  forecast: FootfallForecast;
  factor: number;
  stateMean: number;
  active: boolean;
  onSelect: () => void;
}) {
  const pts = footfallPoints(forecast);
  const start = forecastStart(pts);
  const tomorrow = pts[start] ?? pts[pts.length - 1];
  const value = tomorrow?.predicted === null || !tomorrow ? 0 : Math.round((tomorrow.predicted ?? 0) * factor);
  const delta = stateMean > 0 ? Math.round((value / stateMean - 1) * 100) : 0;
  const data = pts.map((p, i) => ({ day: p.day, v: p.predicted === null ? null : Math.round(p.predicted * (i >= start ? factor : 1)) }));
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "min-w-0 rounded-md border bg-surface-2 p-3 text-left transition-colors hover:bg-surface-3",
        active ? "border-brand" : "border-border",
      )}
    >
      <p className="truncate text-[11px] font-medium uppercase tracking-[0.1em] text-muted">{shortDistrict(districtId)}</p>
      <p className="num mt-1 text-[24px] font-semibold leading-none text-text">{value}</p>
      <p className="mt-1 text-[11px] text-muted">
        tomorrow, <span className="num" style={{ color: delta > 5 ? "var(--risk-stress)" : delta < -5 ? "var(--risk-healthy)" : "var(--text-muted)" }}>{delta >= 0 ? "+" : ""}{delta}%</span> vs mean
      </p>
      <div className="mt-2 h-12">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 140, height: 48 }}>
          <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <Bar dataKey="v" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={d.day} fill={i >= start ? "var(--series-1)" : "var(--text-faint)"} fillOpacity={i === start ? 1 : 0.65} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </button>
  );
}
