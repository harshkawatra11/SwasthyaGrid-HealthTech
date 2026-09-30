"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import type { Datum } from "./AreaTrend";
import { AXIS_TICK, CHART_MARGIN, CURSOR_LINE, ChartFrame, ChartLegend, GRID_PROPS, seriesColor, type Series } from "./common";

/**
 * Several lines over time. A series with `dashed` is a forecast; `forecastFrom` draws a labelled
 * divider at the first forecast x value. Missing values (null) leave a gap.
 */
export function MultiLineForecast({
  data,
  xKey,
  series,
  forecastFrom,
  height = 240,
  unit,
  xFormatter,
  label = "Forecast chart",
}: {
  data: Datum[];
  xKey: string;
  series: Series[];
  forecastFrom?: string | number;
  height?: number;
  unit?: string;
  xFormatter?: (v: string | number) => string;
  label?: string;
}) {
  return (
    <ChartFrame label={label}>
      <ChartLegend items={series.map((s, i) => ({ label: s.name, color: s.color ?? seriesColor(i), dashed: s.dashed }))} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          <LineChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={xFormatter} minTickGap={24} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
            <Tooltip cursor={CURSOR_LINE} content={<ChartTooltip unit={unit} labelFormatter={xFormatter ? (l) => xFormatter(l) : undefined} />} />
            {forecastFrom !== undefined && (
              <ReferenceLine
                x={forecastFrom}
                stroke="var(--border-strong)"
                strokeDasharray="4 4"
                label={{ value: "Forecast", position: "insideTopRight", fill: "var(--text-faint)", fontSize: 11 }}
              />
            )}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color ?? seriesColor(i)}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "6 4" : undefined}
                dot={false}
                connectNulls={false}
                activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
