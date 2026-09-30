"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Search, Truck, TriangleAlert, ListChecks } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis, ZAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { AXIS_TICK, GRID_PROPS } from "@/components/charts/common";
import { useApi } from "@/lib/api/hooks";
import { fmtClock } from "@/lib/format";
import { heatBin, heatColor } from "@/lib/heat";
import type { Alert, PerformanceRow } from "@/lib/api/types";
import type { LiveEvent } from "@/lib/live/types";
import type { RiskLevel } from "@/lib/domain";
import { cn } from "@/lib/cn";
import { histogram, mean, pearson, shortDistrict } from "@/components/operations/derive";
import { heatInk } from "@/components/operations/kit";
import { SCORE_SCALE } from "./KpiTree";

/* ---------- causal chain ---------- */

export type CausalChain = { facility_id: string; headline: string; chain: string[] };

export function useCausalChain(facilityId: string | null) {
  return useApi<CausalChain | null>(facilityId ? `/api/v1/analytics/causal-chain/${facilityId}` : null, null);
}

export type Evidence = { label: string; value: string; tone: "critical" | "warning" | "good" | "neutral" };

/** Connected flow: each cause is a node, joined by arrows, ending in the measured impact on the facility. */
export function CausalFlow({ chain, headline, evidence, facilityName }: { chain: string[]; headline: string; evidence: Evidence[]; facilityName: string }) {
  const steps = [...chain, `Impact at ${facilityName}`];
  return (
    <div>
      <ol className="flex flex-wrap items-stretch gap-y-3">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={`${s}-${i}`} className="flex min-w-0 items-center">
              <div
                className={cn("flex h-full min-h-[84px] w-[168px] flex-col justify-between rounded-md border p-3", last ? "bg-surface-2" : "bg-surface-1")}
                style={{ borderColor: last ? "var(--risk-critical)" : "var(--border-strong)" }}
              >
                <span className="num text-[11px] text-faint">{last ? "EFFECT" : `CAUSE ${i + 1}`}</span>
                <span className="mt-1 text-[12px] font-medium leading-snug text-text">{s}</span>
              </div>
              {!last && (
                <span className="flex w-8 shrink-0 items-center" aria-hidden>
                  <span className="h-px flex-1 bg-border-strong" />
                  <ChevronRight size={14} className="-ml-1 text-muted" />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        {evidence.map((e) => (
          <span
            key={e.label}
            className="inline-flex items-baseline gap-2 rounded-sm border border-border bg-surface-2 px-2.5 py-1.5 text-[12px]"
            style={{
              borderLeft: `3px solid ${e.tone === "critical" ? "var(--risk-critical)" : e.tone === "warning" ? "var(--risk-monitor)" : e.tone === "good" ? "var(--risk-healthy)" : "var(--border-strong)"}`,
            }}
          >
            <span className="text-muted">{e.label}</span>
            <span className="num font-semibold text-text">{e.value}</span>
          </span>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-faint">Model headline: {headline}</p>
    </div>
  );
}

/* ---------- facility picker ---------- */

export function FacilityPicker({
  rows,
  risk,
  selected,
  onSelect,
}: {
  rows: PerformanceRow[];
  risk: Map<string, RiskLevel>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const order: Record<RiskLevel, number> = { critical: 0, stress: 1, monitor: 2, healthy: 3 };
    return rows
      .filter((r) => r.facility_name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (order[risk.get(a.facility_id) ?? "healthy"] - order[risk.get(b.facility_id) ?? "healthy"]) || a.overall - b.overall);
  }, [rows, risk, q]);
  return (
    <div>
      <label className="relative mb-2 block">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a facility"
          aria-label="Find a facility"
          className="h-8 w-full rounded-md border border-border bg-surface-2 pl-8 pr-2 text-[12px] text-text placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        />
      </label>
      <ul className="max-h-[460px] space-y-0.5 overflow-auto pr-1" role="listbox" aria-label="Facilities">
        {list.map((r) => {
          const lvl = risk.get(r.facility_id) ?? "healthy";
          const active = r.facility_id === selected;
          return (
            <li key={r.facility_id} role="option" aria-selected={active}>
              <button
                type="button"
                onClick={() => onSelect(r.facility_id)}
                className={cn("flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-surface-3", active && "bg-surface-3 ring-1 ring-brand")}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--risk-${lvl})` }} />
                  <span className="truncate text-text">{r.facility_name}</span>
                </span>
                <span className="num shrink-0 text-muted">{r.overall}</span>
              </button>
            </li>
          );
        })}
        {list.length === 0 && <li className="px-2 py-3 text-[12px] text-muted">No facility matches.</li>}
      </ul>
    </div>
  );
}

/* ---------- scorecard heat table ---------- */

const DIMS: Array<{ key: keyof PerformanceRow; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "inventory", label: "Inventory" },
  { key: "attendance", label: "Attendance" },
  { key: "diagnostics", label: "Diagnostics" },
  { key: "patient_wait", label: "Patient wait" },
  { key: "forecast_accuracy", label: "Forecast" },
];

export function ScorecardTable({ rows, risk, onSelect }: { rows: PerformanceRow[]; risk: Map<string, RiskLevel>; onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: keyof PerformanceRow | "facility_name"; dir: "asc" | "desc" }>({ key: "overall", dir: "asc" });
  const sorted = useMemo(() => {
    const s = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      return s * (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "en", { numeric: true }));
    });
  }, [rows, sort]);
  const avg = DIMS.map((d) => mean(rows.map((r) => Number(r[d.key]))));
  const toggle = (key: keyof PerformanceRow | "facility_name") => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const head = (k: keyof PerformanceRow | "facility_name", label: string, className?: string) => (
    <th key={k} scope="col" aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("sticky top-0 z-10 border-b border-border bg-surface-2 px-2 py-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted", className)}>
      <button type="button" onClick={() => toggle(k)} className="inline-flex items-center gap-1 uppercase hover:text-text">
        {label}
        {sort.key === k && (sort.dir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </button>
    </th>
  );
  return (
    <div className="max-h-[440px] overflow-auto">
      <table className="w-full border-separate border-spacing-[2px] text-[12px]">
        <thead>
          <tr>
            {head("facility_name", "Facility", "text-left")}
            <th scope="col" className="sticky top-0 z-10 border-b border-border bg-surface-2 px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-muted">District</th>
            {DIMS.map((d) => head(d.key, d.label, "text-center"))}
          </tr>
          <tr>
            <td className="px-2 pb-1 text-[11px] font-semibold text-text">State average</td>
            <td />
            {avg.map((v, i) => (
              <td key={i} className="num pb-1 text-center text-[11px] font-semibold text-muted">
                {v.toFixed(0)}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.facility_id} className="hover:bg-surface-3">
              <td className="px-2 py-1">
                <button type="button" onClick={() => onSelect(r.facility_id)} className="flex items-center gap-2 text-left hover:text-brand">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--risk-${risk.get(r.facility_id) ?? "healthy"})` }} />
                  {r.facility_name}
                </button>
              </td>
              <td className="px-2 py-1 text-muted">{shortDistrict(r.district_id)}</td>
              {DIMS.map((d) => {
                const v = Number(r[d.key]);
                return (
                  <td key={d.key} className="num rounded-[3px] py-1 text-center font-semibold" style={{ backgroundColor: heatColor(v, SCORE_SCALE), color: heatInk(heatBin(v, SCORE_SCALE)) }} title={`${r.facility_name}, ${d.label}: ${v}`}>
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- histogram ---------- */

export function ConfidenceHistogram({ groups }: { groups: Array<{ name: string; values: number[]; color: string }> }) {
  const edges = [50, 60, 70, 80, 90, 100];
  const data = useMemo(() => {
    const per = groups.map((g) => histogram(g.values, edges));
    return edges.slice(0, -1).map((_, i) => ({
      label: `${edges[i]}-${edges[i + 1]}`,
      ...Object.fromEntries(groups.map((g, gi) => [g.name, per[gi][i].count])),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);
  const all = groups.flatMap((g) => g.values);
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {groups.map((g) => (
          <li key={g.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-[2px]" style={{ backgroundColor: g.color }} />
            {g.name}
          </li>
        ))}
      </ul>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 360, height: 220 }}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} unit="%" />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
            <RTooltip cursor={{ fill: "var(--surface-3)", fillOpacity: 0.5 }} content={<ChartTooltip unit="forecasts" />} />
            {groups.map((g, i) => (
              <Bar key={g.name} dataKey={g.name} stackId="h" fill={g.color} radius={i === groups.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {all.length} forecasts, mean confidence <span className="num font-semibold text-text">{mean(all).toFixed(0)}%</span>, lowest <span className="num font-semibold text-text">{all.length ? Math.min(...all) : 0}%</span>.
      </p>
    </div>
  );
}

/* ---------- correlation small multiples ---------- */

export function CorrelationMultiples({ rows, selected }: { rows: PerformanceRow[]; selected: string | null }) {
  const dims: Array<{ key: "inventory" | "attendance" | "diagnostics" | "patient_wait"; label: string }> = [
    { key: "inventory", label: "Inventory" },
    { key: "attendance", label: "Attendance" },
    { key: "diagnostics", label: "Diagnostics" },
    { key: "patient_wait", label: "Patient wait" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {dims.map((d) => {
        const xs = rows.map((r) => r[d.key]);
        const ys = rows.map((r) => r.overall);
        const r = pearson(xs, ys);
        const pts = rows.map((p) => ({ x: p[d.key], y: p.overall, name: p.facility_name, sel: p.facility_id === selected }));
        return (
          <div key={d.key} className="rounded-md border border-border bg-surface-2 p-2">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="font-medium text-text">{d.label}</span>
              <span className="num text-muted">
                r = <span className="font-semibold" style={{ color: Math.abs(r) > 0.6 ? "var(--risk-healthy)" : "var(--text)" }}>{r.toFixed(2)}</span>
              </span>
            </div>
            <div style={{ height: 110 }}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 160, height: 110 }}>
                <ScatterChart margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID_PROPS} vertical />
                  <XAxis type="number" dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={false} domain={["dataMin - 5", "dataMax + 5"]} tickCount={3} />
                  <YAxis type="number" dataKey="y" tick={AXIS_TICK} tickLine={false} axisLine={false} width={24} domain={["dataMin - 5", "dataMax + 5"]} tickCount={3} />
                  <ZAxis range={[26, 26]} />
                  <RTooltip cursor={false} content={<ChartTooltip valueFormatter={(v) => v.toFixed(0)} />} />
                  <Scatter data={pts} isAnimationActive={false}>
                    {pts.map((p) => (
                      <Cell key={p.name} fill={p.sel ? "var(--risk-critical)" : "var(--series-1)"} fillOpacity={p.sel ? 1 : 0.6} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- events ---------- */

export type FeedItem = { id: string; icon: "shipment" | "risk" | "rec" | "alert"; text: string; at: string; tone: "critical" | "good" | "neutral" | "warning" };

const ICONS = { shipment: Truck, risk: TriangleAlert, rec: ListChecks, alert: TriangleAlert } as const;

export function liveToFeed(events: readonly LiveEvent[], name: (id: string) => string): FeedItem[] {
  return events.map((e) => {
    const at = new Date(e.receivedAt).toISOString();
    if (e.kind === "shipment") {
      return { id: `s${e.id}`, icon: "shipment" as const, text: `${e.data.event.title}: ${name(e.data.facility_id)}`, at: e.data.event.at ?? at, tone: "neutral" as const };
    }
    if (e.kind === "risk") {
      const better = ["healthy", "monitor", "stress", "critical"].indexOf(e.data.to) < ["healthy", "monitor", "stress", "critical"].indexOf(e.data.from);
      return { id: `r${e.id}`, icon: "risk" as const, text: `${e.data.facility_name} moved from ${e.data.from} to ${e.data.to}`, at, tone: better ? ("good" as const) : ("critical" as const) };
    }
    return { id: `c${e.id}`, icon: "rec" as const, text: `Recommendations: ${e.data.added.length} added, ${e.data.expired.length} expired`, at, tone: "neutral" as const };
  });
}

export function alertsToFeed(alerts: Alert[]): FeedItem[] {
  return alerts.map((a) => ({ id: a.id, icon: "alert" as const, text: a.detail ? `${a.title}. ${a.detail}` : a.title, at: "", tone: a.severity === "critical" ? ("critical" as const) : ("warning" as const) }));
}

export function EventsList({ items, live }: { items: FeedItem[]; live: boolean }) {
  return (
    <div>
      <p className="mb-2 text-[11px] text-muted">{live ? "Live stream, newest first." : "No live events yet, showing the latest alerts instead."}</p>
      <ul className="max-h-[380px] space-y-1 overflow-auto pr-1">
        {items.slice(0, 20).map((it) => {
          const Icon = ICONS[it.icon];
          const color = it.tone === "critical" ? "var(--risk-critical)" : it.tone === "good" ? "var(--risk-healthy)" : it.tone === "warning" ? "var(--risk-monitor)" : "var(--text-muted)";
          return (
            <li key={it.id} className="flex items-start gap-2 rounded-sm px-1.5 py-1 text-[12px] hover:bg-surface-3">
              <Icon size={13} className="mt-0.5 shrink-0" style={{ color }} aria-hidden />
              <span className="min-w-0 flex-1 leading-snug text-text">{it.text}</span>
              {it.at && <span className="num shrink-0 text-[11px] text-faint">{fmtClock(it.at)}</span>}
            </li>
          );
        })}
        {items.length === 0 && <li className="text-[12px] text-muted">Nothing to show.</li>}
      </ul>
    </div>
  );
}
