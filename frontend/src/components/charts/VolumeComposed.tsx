"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import type { Datum } from "./AreaTrend";
import { AXIS_TICK, CHART_MARGIN, CURSOR_BAND, ChartFrame, ChartLegend, GRID_PROPS, seriesColor, type Series } from "./common";

/**
 * Bars for a volume plus an optional line on the SAME axis (one y scale, never dual-axis).
 * Example: shipments per day (bars) and delivered per day (line).
 */
export function VolumeComposed({
  data,
  xKey,
  bar,
  line,
  height = 220,
  unit,
  xFormatter,
  label = "Volume chart",
}: {
  data: Datum[];
  xKey: string;
  bar: Series;
  line?: Series;
  height?: number;
  unit?: string;
  xFormatter?: (v: string | number) => string;
  label?: string;
}) {
  const barColor = bar.color ?? seriesColor(0);
  const lineColor = line?.color ?? seriesColor(1);
  return (
    <ChartFrame label={label}>
      <ChartLegend
        items={[{ label: bar.name, color: barColor }, ...(line ? [{ label: line.name, color: lineColor }] : [])]}
      />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          <ComposedChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={xFormatter} minTickGap={24} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
            <Tooltip cursor={CURSOR_BAND} content={<ChartTooltip unit={unit} labelFormatter={xFormatter ? (l) => xFormatter(l) : undefined} />} />
            <Bar
              dataKey={bar.key}
              name={bar.name}
              fill={barColor}
              maxBarSize={14}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            {line && (
              <Line
                type="monotone"
                dataKey={line.key}
                name={line.name}
                stroke={lineColor}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
