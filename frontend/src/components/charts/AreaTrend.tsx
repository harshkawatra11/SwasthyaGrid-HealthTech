"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import { AXIS_TICK, CHART_MARGIN, CURSOR_LINE, ChartFrame, ChartLegend, GRID_PROPS, seriesColor, type Series } from "./common";

export type Datum = Record<string, string | number | null>;

/** One or more areas over an x axis. Vertical gradient fill from the stroke colour at 28% to 0. */
export function AreaTrend({
  data,
  xKey,
  series,
  height = 220,
  unit,
  xFormatter,
  yFormatter,
  valueFormatter,
  label = "Trend chart",
}: {
  data: Datum[];
  xKey: string;
  series: Series[];
  height?: number;
  unit?: string;
  xFormatter?: (v: string | number) => string;
  yFormatter?: (v: number) => string;
  valueFormatter?: (v: number, name: string) => string;
  label?: string;
}) {
  const uid = useId().replace(/:/g, "");
  return (
    <ChartFrame label={label}>
      <ChartLegend items={series.map((s, i) => ({ label: s.name, color: s.color ?? seriesColor(i) }))} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          <AreaChart data={data} margin={CHART_MARGIN}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color ?? seriesColor(i)} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.color ?? seriesColor(i)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={xFormatter} minTickGap={24} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} tickFormatter={yFormatter} />
            <Tooltip
              cursor={CURSOR_LINE}
              content={<ChartTooltip unit={unit} valueFormatter={valueFormatter} labelFormatter={xFormatter ? (l) => xFormatter(l) : undefined} />}
            />
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color ?? seriesColor(i)}
                strokeWidth={2}
                fill={`url(#${uid}-${s.key})`}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
