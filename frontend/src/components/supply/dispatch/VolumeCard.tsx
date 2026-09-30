"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ds/Card";
import { Select } from "@/components/ds/Select";
import { Skeleton } from "@/components/ds/Skeleton";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { AXIS_TICK, CURSOR_LINE, GRID_PROPS, ChartLegend } from "@/components/charts/common";
import { useVolumeSeries } from "@/lib/api/hooks";
import { useScope } from "@/lib/scope";
import { fmtDuration, fmtInt } from "@/lib/format";
import { PERIOD_LABEL, fmtDotDate, volumeFinding, volumePoints, type Period, type VolumePoint } from "./helpers";
import { SourceLine } from "./SourceLine";

const AREA = "var(--series-2)";
const LINE = "var(--text-muted)";
const MARGIN = { top: 14, right: 12, bottom: 0, left: 0 } as const;

type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: VolumePoint }> };

function VolumeTooltip({ active, payload }: TipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <ChartTooltip
      active
      label={fmtDotDate(p.date)}
      payload={[
        { name: "Shipments", value: p.shipments, color: AREA },
        { name: "Avg. Time", value: p.hours, color: LINE },
      ]}
      valueFormatter={(v, name) => (name === "Avg. Time" ? fmtDuration(v * 60) : fmtInt(v))}
    />
  );
}

export function VolumeCard() {
  const { scope } = useScope();
  const [period, setPeriod] = useState<Period>("month");
  const { data, isLoading } = useVolumeSeries(scope, 90);
  const uid = useId().replace(/:/g, "");
  const points = useMemo(() => volumePoints(data, period), [data, period]);
  const finding = useMemo(() => volumeFinding(points), [points]);

  return (
    <Card
      eyebrow="Shipments volume and transit time"
      title={finding.title}
      actions={
        <Select
          ariaLabel="Period"
          value={period}
          onValueChange={(v) => setPeriod(v as Period)}
          options={(Object.keys(PERIOD_LABEL) as Period[]).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
        />
      }
      footer={<SourceLine source="simulated shipment history, 90 days; Avg. Time is mean dispatch to arrival per day" sub="Supply chain / Dispatch" />}
    >
      {isLoading || points.length === 0 ? (
        <Skeleton className="h-[230px] w-full" />
      ) : (
        <div>
          <ChartLegend
            items={[
              { label: "Shipments per day", color: AREA },
              { label: "Avg. transit time", color: LINE },
            ]}
          />
          <div className="h-[120px]" role="group" aria-label="Shipments per day">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 120 }}>
              <AreaChart data={points} margin={MARGIN} syncId={`vol-${uid}`}>
                <defs>
                  <linearGradient id={`${uid}-a`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={AREA} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={AREA} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" hide />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={34} domain={[0, "auto"]} />
                <Tooltip cursor={{ ...CURSOR_LINE, strokeDasharray: "3 3" }} content={<VolumeTooltip />} />
                <Area
                  type="monotone"
                  dataKey="shipments"
                  name="Shipments"
                  stroke={AREA}
                  strokeWidth={2}
                  fill={`url(#${uid}-a)`}
                  dot={false}
                  activeDot={{ r: 4, fill: AREA, stroke: "var(--surface-1)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                {finding.peak && (
                  <ReferenceDot
                    x={finding.peak.label}
                    y={finding.peak.shipments}
                    r={3.5}
                    fill={AREA}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                    label={{ value: `Peak ${finding.peak.shipments}`, position: "left", fill: "var(--text-muted)", fontSize: 11 }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="h-[70px]" role="group" aria-label="Average transit time in hours">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 70 }}>
              <LineChart data={points} margin={{ ...MARGIN, top: 6 }} syncId={`vol-${uid}`}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={28} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={34} tickFormatter={(v: number) => `${v}h`} domain={[0, "auto"]} tickCount={3} />
                <Tooltip cursor={{ ...CURSOR_LINE, strokeDasharray: "3 3" }} content={() => null} />
                <Line
                  type="monotone"
                  dataKey="hours"
                  name="Avg. Time"
                  stroke={LINE}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: LINE, stroke: "var(--surface-1)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Read: the upper panel counts shipments, the lower panel shows how long each takes. Two panels share one time axis
            because the units differ.
          </p>
        </div>
      )}
    </Card>
  );
}
