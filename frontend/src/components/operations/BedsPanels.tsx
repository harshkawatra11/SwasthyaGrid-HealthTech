"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { AXIS_TICK, ChartLegend, GRID_PROPS } from "@/components/charts/common";
import { Meter } from "@/components/ds/Meter";
import { PriorityChip } from "@/components/ds/PriorityChip";
import { heatBin, heatColor } from "@/lib/heat";
import type { RecommendationV2 } from "@/lib/api/types";
import { BED_SCALE, DISTRICT_ORDER, capacityWaterfall, mean, shortDistrict, weekUnder, type BedRow, type FacRef } from "./derive";
import { HeatLegend, heatInk } from "./kit";

/** Hero: facility rows by now, tomorrow and next week occupancy, worst first. */
export function OccupancyStrip({ rows, factor }: { rows: BedRow[]; factor: number }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => weekUnder(b, factor) - weekUnder(a, factor) || b.now - a.now), [rows, factor]);
  return (
    <div>
      <div className="grid items-center gap-[3px]" style={{ gridTemplateColumns: "minmax(0,1fr) 62px 62px 62px 30px" }}>
        <div className="text-[10px] uppercase tracking-[0.1em] text-muted">Facility</div>
        {["Now", "Tomorrow", "Next week"].map((c) => (
          <div key={c} className="text-center text-[10px] uppercase tracking-[0.06em] text-muted">
            {c}
          </div>
        ))}
        <div />
        {sorted.map((r) => {
          const week = weekUnder(r, factor);
          const cells = [r.now, r.tomorrow, week];
          const rising = week - r.now;
          return (
            <div key={r.facilityId} className="contents">
              <div className="flex min-w-0 items-baseline gap-2 text-[12px] leading-[30px]">
                <Link href={`/facilities/${r.facilityId}`} className="truncate font-medium text-text hover:text-brand">
                  {r.name}
                </Link>
                <span className="hidden shrink-0 text-[10px] text-faint 2xl:inline">{shortDistrict(r.districtId)}</span>
              </div>
              {cells.map((v, i) => (
                <div
                  key={i}
                  title={`${r.name}, ${["now", "tomorrow", "next week"][i]}: ${v}% of ${r.total} beds`}
                  className="num flex h-[26px] items-center justify-center rounded-[3px] text-[11px] font-semibold"
                  style={{ backgroundColor: heatColor(v, BED_SCALE), color: heatInk(heatBin(v, BED_SCALE)) }}
                >
                  {v}
                </div>
              ))}
              <div className="flex justify-end" title={`${rising >= 0 ? "+" : ""}${rising} points now to next week`}>
                <TrendingUp size={12} className={rising > 10 ? "text-risk-critical" : rising > 3 ? "text-risk-monitor" : "text-faint"} aria-label="Trend" />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <HeatLegend labels={["<=60%", "<=75%", "<=85%", "<=95%", ">95%"]} />
      </div>
    </div>
  );
}

/** Total beds, occupied now, predicted extra by next week, and what stays free. */
export function CapacityWaterfall({ rows, factor }: { rows: BedRow[]; factor: number }) {
  const w = useMemo(() => capacityWaterfall(rows, factor), [rows, factor]);
  const data = [
    { name: "Total", base: 0, v: w.total, color: "var(--series-1)" },
    { name: "Occupied", base: 0, v: w.occupied, color: "var(--series-4)" },
    { name: "Extra", base: w.occupied, v: w.extra, color: "var(--risk-stress)" },
    { name: "Free", base: w.occupied + w.extra, v: w.free, color: "var(--risk-healthy)" },
  ];
  return (
    <div>
      <div style={{ height: 220 }} role="img" aria-label="Capacity waterfall">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 220 }}>
          <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={0} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
            <RTooltip cursor={{ fill: "var(--surface-3)", fillOpacity: 0.5 }} content={<ChartTooltip unit="beds" />} />
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} legendType="none" name="Base" />
            <Bar dataKey="v" stackId="w" name="Beds" radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: "top", fill: "var(--text)", fontSize: 11 }}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Facilities are forecast to add <span className="num font-semibold text-text">{w.extra}</span> occupied beds by next week.
        {w.overflow > 0 && (
          <>
            {" "}
            Demand beyond capacity at individual sites is <span className="num font-semibold text-risk-critical">{w.overflow}</span> beds.
          </>
        )}
      </p>
    </div>
  );
}

/** Average occupancy per district at the three horizons, same scale for all five. */
export function DistrictBedBars({ rows, factor }: { rows: BedRow[]; factor: number }) {
  const data = useMemo(
    () =>
      DISTRICT_ORDER.filter((d) => rows.some((r) => r.districtId === d)).map((d) => {
        const rs = rows.filter((r) => r.districtId === d);
        return {
          name: shortDistrict(d),
          now: Math.round(mean(rs.map((r) => r.now))),
          tomorrow: Math.round(mean(rs.map((r) => r.tomorrow))),
          week: Math.round(mean(rs.map((r) => weekUnder(r, factor)))),
        };
      }),
    [rows, factor],
  );
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Now", color: "var(--series-4)" },
          { label: "Tomorrow", color: "var(--series-1)" },
          { label: "Next week", color: "var(--risk-stress)" },
        ]}
      />
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 200 }}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} domain={[0, 100]} />
            <RTooltip cursor={{ fill: "var(--surface-3)", fillOpacity: 0.5 }} content={<ChartTooltip unit="%" />} />
            <ReferenceLine y={90} stroke="var(--risk-critical)" strokeDasharray="4 4" label={{ value: "90% trigger", fill: "var(--text-faint)", fontSize: 10, position: "insideTopRight" }} />
            <Bar dataKey="now" name="Now" fill="var(--series-4)" radius={[3, 3, 0, 0]} barSize={12} isAnimationActive={false} />
            <Bar dataKey="tomorrow" name="Tomorrow" fill="var(--series-1)" radius={[3, 3, 0, 0]} barSize={12} isAnimationActive={false} />
            <Bar dataKey="week" name="Next week" fill="var(--risk-stress)" radius={[3, 3, 0, 0]} barSize={12} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PressureList({ rows, factor, limit = 10 }: { rows: BedRow[]; factor: number; limit?: number }) {
  const top = useMemo(() => [...rows].sort((a, b) => weekUnder(b, factor) - weekUnder(a, factor)).slice(0, limit), [rows, factor, limit]);
  return (
    <ol className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
      {top.map((r, i) => {
        const w = weekUnder(r, factor);
        return (
          <li key={r.facilityId} className="grid grid-cols-[20px_1fr] items-center gap-2">
            <span className="num text-right text-[12px] text-faint">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <Link href={`/facilities/${r.facilityId}`} className="truncate font-medium hover:text-brand">
                  {r.name}
                </Link>
                <span className="num shrink-0 text-muted">
                  {r.occupied}/{r.total} now, <span className="font-semibold text-text">{w}%</span> in a week
                </span>
              </div>
              <Meter value={w} max={100} showValue={false} className="mt-1" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function RedirectList({ recs, refs }: { recs: RecommendationV2[]; refs: Map<string, FacRef> }) {
  const name = (id: string) => refs.get(id)?.name ?? "Unnamed facility";
  if (recs.length === 0) return <p className="text-[12px] text-muted">No bed redirects are pending.</p>;
  return (
    <ul className="divide-y divide-border">
      {recs.slice(0, 6).map((r) => (
        <li key={r.id} className="py-2 first:pt-0">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <Link href={`/facilities/${r.source_facility_id}`} className="truncate font-medium hover:text-brand">
                {name(r.source_facility_id)}
              </Link>
              <ArrowRight size={12} className="shrink-0 text-faint" aria-hidden />
              <Link href={`/facilities/${r.target_facility_id}`} className="truncate font-medium hover:text-brand">
                {name(r.target_facility_id)}
              </Link>
            </span>
            <PriorityChip priority={r.priority} />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted" title={r.reasons.join(". ")}>
            {r.reasons[0]}
            {r.distance_km ? ` (${r.distance_km} km, ${r.eta_minutes ?? "?"} min)` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
