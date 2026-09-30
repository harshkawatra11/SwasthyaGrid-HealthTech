"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RISK_LABEL, riskVar, type RiskLevel } from "@/lib/domain";
import { ChartTooltip } from "./ChartTooltip";
import type { Datum } from "./AreaTrend";
import { AXIS_TICK, CHART_MARGIN, CURSOR_BAND, ChartFrame, ChartLegend, GRID_PROPS } from "./common";

export const RISK_ORDER: RiskLevel[] = ["healthy", "monitor", "stress", "critical"];

/**
 * Stacked bars of facility counts by risk level per category (for example per district).
 * Rows carry one numeric key per risk level. Segments are separated by a 2px surface gap.
 */
export function StackedRiskBars({
  data,
  categoryKey,
  height = 240,
  unit = "facilities",
  label = "Facilities by risk level",
}: {
  data: Datum[];
  categoryKey: string;
  height?: number;
  unit?: string;
  label?: string;
}) {
  return (
    <ChartFrame label={label}>
      <ChartLegend items={RISK_ORDER.map((r) => ({ label: RISK_LABEL[r], color: riskVar(r) }))} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          <BarChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey={categoryKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip cursor={CURSOR_BAND} content={<ChartTooltip unit={unit} />} />
            {RISK_ORDER.map((r, i) => (
              <Bar
                key={r}
                dataKey={r}
                name={RISK_LABEL[r]}
                stackId="risk"
                fill={riskVar(r)}
                stroke="var(--surface-1)"
                strokeWidth={2}
                maxBarSize={28}
                radius={i === RISK_ORDER.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
