"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { AXIS_TICK, CURSOR_BAND, ChartFrame, ChartLegend, GRID_PROPS } from "@/components/charts/common";
import type { DistrictSummaryRow } from "@/lib/api/types";
import { COVER_LINE, PRESSURE_LINE, shortName, type QuadrantPoint } from "./metrics";

type ShapeProps = { cx?: number; cy?: number; payload?: QuadrantPoint };

function Bubble({ cx = 0, cy = 0, payload, size, below }: ShapeProps & { size: (v: number) => number; below: (id: string) => boolean }) {
  if (!payload) return null;
  const r = size(payload.footfall);
  const color = payload.danger ? "var(--risk-critical)" : "var(--series-1)";
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={2} />
      <text x={cx} y={below(payload.id) ? cy + r + 13 : cy - r - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">
        {payload.name}
      </text>
    </g>
  );
}

/** x: median stock cover (days), y: bed pressure next week (%), bubble: tomorrow footfall. */
export function QuadrantScatter({ points, height = 300 }: { points: QuadrantPoint[]; height?: number }) {
  const foot = points.map((p) => p.footfall);
  const lo = Math.min(...foot, 1);
  const hi = Math.max(...foot, 2);
  const size = (v: number) => 9 + ((v - lo) / Math.max(1, hi - lo)) * 12;
  const sorted = [...points].sort((a, b) => a.cover - b.cover);
  const below = (id: string) => sorted.findIndex((p) => p.id === id) % 2 === 1;
  const maxX = Math.max(14, Math.ceil(Math.max(...points.map((p) => p.cover), 0) + 2));
  const ys = points.map((p) => p.pressure);
  const yMin = Math.floor(Math.min(...ys, 60) / 5) * 5 - 5;
  const yMax = Math.ceil(Math.max(...ys, 90) / 5) * 5 + 5;
  return (
    <ChartFrame label="Quadrant of stock cover against bed pressure by district">
      <ChartLegend
        items={[
          { label: "Inside the danger quadrant", color: "var(--risk-critical)" },
          { label: "Outside", color: "var(--series-1)" },
        ]}
      />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          <ScatterChart margin={{ top: 18, right: 16, bottom: 20, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} vertical />
            <ReferenceArea x1={0} x2={COVER_LINE} y1={PRESSURE_LINE} y2={yMax} fill="var(--risk-critical)" fillOpacity={0.08} />
            <ReferenceLine x={COVER_LINE} stroke="var(--border-strong)" strokeDasharray="4 4" />
            <ReferenceLine y={PRESSURE_LINE} stroke="var(--border-strong)" strokeDasharray="4 4" />
            <XAxis
              type="number"
              dataKey="cover"
              name="Stock cover"
              domain={[0, maxX]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              label={{ value: "Median days of stock cover", position: "insideBottom", offset: -10, fill: "var(--text-faint)", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="pressure"
              name="Bed pressure"
              domain={[yMin, yMax]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={40}
              unit="%"
            />
            <ZAxis type="number" dataKey="footfall" range={[80, 500]} name="Footfall" />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as QuadrantPoint | undefined;
                if (!active || !p) return null;
                return (
                  <ChartTooltip
                    active
                    label={p.name}
                    payload={[
                      { name: "Median stock cover", value: `${p.cover.toFixed(1)} days` },
                      { name: "Beds next week", value: `${p.pressure.toFixed(1)}%` },
                      { name: "Footfall tomorrow", value: `${p.footfall} visits` },
                    ]}
                  />
                );
              }}
            />
            <Scatter data={points} shape={(props: unknown) => <Bubble {...(props as ShapeProps)} size={size} below={below} />} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/** Grouped bars: stock-out items against pending approvals per district. */
export function StockoutVsApprovals({ rows, height = 260 }: { rows: DistrictSummaryRow[]; height?: number }) {
  const data = rows.map((r) => ({ name: shortName(r.name), stockouts: r.stockout_items, pending: r.pending_recommendations }));
  return (
    <ChartFrame label="Stock-out items and pending approvals by district">
      <ChartLegend
        items={[
          { label: "Stock-out items (under 3 days)", color: "var(--risk-critical)" },
          { label: "Pending approvals", color: "var(--series-1)" },
        ]}
      />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barGap={3}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={0} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
            <Tooltip cursor={CURSOR_BAND} content={<ChartTooltip />} />
            <Bar dataKey="stockouts" name="Stock-out items" fill="var(--risk-critical)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
              <LabelList dataKey="stockouts" position="top" fill="var(--text-muted)" fontSize={11} />
            </Bar>
            <Bar dataKey="pending" name="Pending approvals" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
              <LabelList dataKey="pending" position="top" fill="var(--text-muted)" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/**
 * Small-multiple sparkline drawn on a shared axis (min and max are passed in), so five district
 * cards are visually comparable. The last point is emphasised.
 */
export function SharedSpark({ data, min, max, width = 150, height = 34, color = "var(--series-1)" }: { data: number[]; min: number; max: number; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const span = Math.max(1, max - min);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * (width - 6) + 3, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" points={pts.map((p) => p.join(",")).join(" ")} />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
    </svg>
  );
}
