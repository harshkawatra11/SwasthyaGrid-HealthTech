"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { AXIS_TICK, GRID_PROPS } from "@/components/charts/common";
import { heatBin, heatColor } from "@/lib/heat";
import { ABSENCE_SCALE, WEEKDAYS, type DoctorRow } from "./derive";
import { HeatLegend, heatInk } from "./kit";

const RISK_COLOR = { high: "var(--risk-critical)", medium: "var(--risk-monitor)", low: "var(--risk-healthy)" } as const;

/** Hero: doctors by weekday, cell is modelled absence likelihood. */
export function AttendanceCalendar({ rows }: { rows: DoctorRow[] }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.score - a.score), [rows]);
  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: "minmax(170px,1.4fr) repeat(7, minmax(44px, 1fr))" }}>
        <div />
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-medium text-muted">
            {d}
          </div>
        ))}
        {sorted.map((r) => (
          <div key={`${r.facility_id}-${r.doctor_name}`} className="contents">
            <div className="flex min-w-0 flex-col justify-center pr-2 leading-tight">
              <span className="truncate text-[12px] font-medium text-text">{r.doctor_name}</span>
              <Link href={`/facilities/${r.facility_id}`} className="truncate text-[11px] text-muted hover:text-brand">
                {r.facilityLabel}, {r.specialty}
              </Link>
            </div>
            {r.week.map((v, i) => (
              <div
                key={i}
                title={`${r.doctor_name}, ${WEEKDAYS[i]}: ${Math.round(v * 100)}% absence likelihood`}
                className="num flex h-11 items-center justify-center rounded-[4px] text-[12px] font-semibold"
                style={{ backgroundColor: heatColor(v, ABSENCE_SCALE), color: heatInk(heatBin(v, ABSENCE_SCALE)) }}
              >
                {Math.round(v * 100)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <HeatLegend labels={["<=8%", "<=20%", "<=40%", "<=70%", ">70%"]} />
        <span className="text-[11px] text-muted">Modelled from the recorded absence pattern and risk level, not a duty roster.</span>
      </div>
    </div>
  );
}

export function AbsenceRanking({ rows }: { rows: DoctorRow[] }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.score - a.score), [rows]);
  return (
    <ol className="space-y-3">
      {sorted.map((r, i) => (
        <li key={`${r.facility_id}-${r.doctor_name}`} className="grid grid-cols-[18px_1fr_34px] items-center gap-2 text-[12px]">
          <span className="num text-right text-faint">{i + 1}</span>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium text-text">{r.doctor_name}</span>
              <span className="shrink-0 text-[11px] text-muted">{r.absence_pattern ?? "no pattern"}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full" style={{ width: `${r.score}%`, backgroundColor: RISK_COLOR[r.risk_level] }} />
            </div>
          </div>
          <span className="num text-right font-semibold text-text">{r.score}</span>
        </li>
      ))}
    </ol>
  );
}

export function DelayBars({ rows }: { rows: DoctorRow[] }) {
  const data = useMemo(
    () => [...rows].sort((a, b) => b.patient_delay_pct - a.patient_delay_pct).map((r) => ({ name: r.doctor_name.replace(/^Dr\.\s*/, ""), v: r.patient_delay_pct, risk: r.risk_level, site: r.facilityLabel })),
    [rows],
  );
  return (
    <div style={{ height: Math.max(200, data.length * 24 + 30) }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 260 }}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} unit="%" />
          <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={96} />
          <RTooltip cursor={{ fill: "var(--surface-3)", fillOpacity: 0.5 }} content={<ChartTooltip unit="% of patients delayed" />} />
          <Bar dataKey="v" name="Patients delayed" radius={[0, 4, 4, 0]} barSize={12} isAnimationActive={false} label={{ position: "right", fill: "var(--text)", fontSize: 11 }}>
            {data.map((d, i) => (
              <Cell key={i} fill={RISK_COLOR[d.risk]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

