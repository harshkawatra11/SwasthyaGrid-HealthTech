"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Snowflake } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Select } from "@/components/ds/Select";
import { Meter } from "@/components/ds/Meter";
import { Skeleton } from "@/components/ds/Skeleton";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { AXIS_TICK, GRID_PROPS } from "@/components/charts/common";
import { useWarehouse, useWarehouses } from "@/lib/api/hooks";
import { cn } from "@/lib/cn";
import { heatBin, heatColor } from "@/lib/heat";
import {
  COVER_SCALE,
  DISTRICT_ORDER,
  LOW_DAYS,
  STOCKOUT_DAYS,
  coverUnder,
  medicineDistrictMin,
  medicineStats,
  minCoverByFacility,
  shortDistrict,
  shortMedicine,
  type StockRow,
} from "./derive";
import { heatInk, HeatLegend } from "./kit";

const fmt1 = (d: number) => (d < 10 ? d.toFixed(1) : String(Math.round(d)));

/** Facilities ranked by their weakest item, with the item named and a bar on a 21 day scale. */
export function StockoutLadder({ rows, factor, limit = 12 }: { rows: StockRow[]; factor: number; limit?: number }) {
  const ranked = useMemo(
    () =>
      minCoverByFacility(rows.map((r) => ({ ...r, days: coverUnder(r.days, factor) })))
        .slice(0, limit),
    [rows, factor, limit],
  );
  return (
    <ol className="space-y-1.5">
      {ranked.map((f, i) => {
        const bin = heatBin(f.min, COVER_SCALE);
        return (
          <li key={f.facilityId} className="grid grid-cols-[18px_1fr_44px] items-center gap-2 text-[12px]">
            <span className="num text-right text-faint">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/facilities/${f.facilityId}`} className="truncate font-medium text-text hover:text-brand">
                  {f.name}
                </Link>
                <span className="shrink-0 text-[11px] text-muted">
                  {shortMedicine(f.medicine)}
                  {f.below3 > 1 ? ` +${f.below3 - 1}` : ""}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (f.min / 21) * 100)}%`, backgroundColor: heatColor(f.min, COVER_SCALE) }} />
              </div>
            </div>
            <span className="num text-right font-semibold" style={{ color: bin !== null && bin >= 3 ? "var(--risk-critical)" : "var(--text)" }}>
              {fmt1(f.min)}d
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Emergency medicines (rows) by district (columns), cell is the minimum days of cover. */
export function EmergencyByDistrict({ rows, factor }: { rows: StockRow[]; factor: number }) {
  const adj = useMemo(() => rows.map((r) => ({ ...r, days: coverUnder(r.days, factor) })), [rows, factor]);
  const meds = useMemo(() => medicineStats(adj).filter((m) => m.emergency).sort((a, b) => a.min - b.min), [adj]);
  const districts = useMemo(() => DISTRICT_ORDER.filter((d) => adj.some((r) => r.districtId === d)), [adj]);
  return (
    <div>
      <div className="grid gap-[2px] text-[11px]" style={{ gridTemplateColumns: `minmax(70px,1fr) repeat(${districts.length}, minmax(44px, 62px))` }}>
        <div />
        {districts.map((d) => (
          <div key={d} className="truncate pb-1 text-center text-[10px] text-muted" title={shortDistrict(d)}>
            {shortDistrict(d)}
          </div>
        ))}
        {meds.map((m) => (
          <div key={m.medicine} className="contents">
            <div className="flex items-center gap-1 truncate text-text" title={m.medicine}>
              {shortMedicine(m.medicine)}
              {m.coldChain && <Snowflake size={10} className="text-cyan" aria-label="Cold chain" />}
            </div>
            {districts.map((d) => {
              const v = medicineDistrictMin(adj, m.medicine, d);
              return (
                <div
                  key={d}
                  title={`${shortDistrict(d)}, ${m.medicine}: weakest facility ${v === null ? "n/a" : v.toFixed(1)} days`}
                  className="num flex h-8 items-center justify-center rounded-[3px] text-[11px] font-semibold"
                  style={{ backgroundColor: heatColor(v, COVER_SCALE), color: heatInk(v === null ? null : heatBin(v, COVER_SCALE)) }}
                >
                  {v === null ? "-" : fmt1(v)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <HeatLegend labels={["21+", "14+", "7+", "3+", "<3"]} />
      </div>
    </div>
  );
}

/** Cold chain items under a week of cover: these need a working cold room on the truck as well. */
export function ColdChainCard({ rows, factor }: { rows: StockRow[]; factor: number }) {
  const risky = useMemo(
    () => rows.filter((r) => r.coldChain && coverUnder(r.days, factor) < LOW_DAYS).sort((a, b) => a.days - b.days),
    [rows, factor],
  );
  const total = rows.filter((r) => r.coldChain).length;
  return (
    <div>
      <div className="flex items-end gap-3">
        <span className="num text-[28px] font-semibold leading-none text-text">{risky.length}</span>
        <span className="pb-0.5 text-[12px] text-muted">of {total} cold chain stock rows under {LOW_DAYS} days</span>
      </div>
      <div className="mt-3">
        <Meter value={risky.length} max={Math.max(1, total)} tone={risky.length / Math.max(1, total) > 0.25 ? "stress" : "monitor"} showValue={false} label="Share at risk" />
      </div>
      <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-[12px]">
        {risky.slice(0, 8).map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <Snowflake size={11} className="shrink-0 text-cyan" aria-hidden />
              <Link href={`/facilities/${r.facilityId}`} className="truncate hover:text-brand">
                {r.facilityName}
              </Link>
              <span className="shrink-0 text-muted">{shortMedicine(r.medicine)}</span>
            </span>
            <span className="num shrink-0 font-semibold" style={{ color: coverUnder(r.days, factor) < STOCKOUT_DAYS ? "var(--risk-critical)" : "var(--risk-monitor)" }}>
              {fmt1(coverUnder(r.days, factor))}d
            </span>
          </li>
        ))}
        {risky.length === 0 && <li className="text-muted">No cold chain item is under a week of cover.</li>}
      </ul>
    </div>
  );
}

/** Two charts under one finding: average cover against weakest facility, and how many facilities sit under 7 days. */
export function MedicineCoverCharts({ rows, factor }: { rows: StockRow[]; factor: number }) {
  const data = useMemo(() => {
    const adj = rows.map((r) => ({ ...r, days: coverUnder(r.days, factor) }));
    return medicineStats(adj)
      .map((m) => ({ name: shortMedicine(m.medicine), avg: Math.round(m.avg * 10) / 10, min: Math.round(m.min * 10) / 10, below7: m.below7, below3: m.below3, worst: m.worstFacility }))
      .sort((a, b) => a.avg - b.avg);
  }, [rows, factor]);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="mb-1 text-[11px] font-medium text-muted">Average and weakest cover, days</p>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 280 }}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barGap={2}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={96} />
              <RTooltip cursor={{ fill: "var(--surface-3)", fillOpacity: 0.5 }} content={<ChartTooltip unit="d" valueFormatter={(v) => v.toFixed(1)} />} />
              <ReferenceLine x={STOCKOUT_DAYS} stroke="var(--risk-critical)" strokeDasharray="4 4" label={{ value: "3d", fill: "var(--text-faint)", fontSize: 10, position: "top" }} />
              <Bar dataKey="avg" name="State average" fill="var(--series-1)" radius={[0, 4, 4, 0]} barSize={9} isAnimationActive={false} />
              <Bar dataKey="min" name="Weakest facility" fill="var(--risk-stress)" radius={[0, 4, 4, 0]} barSize={9} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-medium text-muted">Facilities under 7 days, by medicine</p>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 280 }}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={96} />
              <RTooltip cursor={{ fill: "var(--surface-3)", fillOpacity: 0.5 }} content={<ChartTooltip unit="facilities" />} />
              <Bar dataKey="below7" name="Under 7 days" radius={[0, 4, 4, 0]} barSize={12} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.below3 > 0 ? "var(--risk-critical)" : "var(--risk-monitor)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function WarehouseRow({ id, name }: { id: string; name: string }) {
  const { data, isLoading } = useWarehouse(id);
  if (isLoading) return <Skeleton className="h-9 w-full" />;
  const stock = data?.stock ?? [];
  const expiring = stock.filter((s) => s.expiring_soon).length;
  return (
    <div className="rounded-sm border border-border p-2">
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="truncate font-medium text-text" title={name}>
          {name.replace(/^District Drug Warehouse, /, "DDW ").replace(/^State Central Drug Warehouse, /, "Central, ")}
        </span>
        <span className={cn("shrink-0 text-[11px]", expiring > 0 ? "text-risk-monitor" : "text-faint")}>{expiring > 0 ? `${expiring} expiring` : "no expiry flags"}</span>
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {stock.map((s) => (
          <span
            key={s.medicine_name}
            title={`${s.medicine_name}: ${s.days_of_cover} days of cover, batch ${s.batch_no}, expires ${s.expiry_date}`}
            className="num flex h-6 flex-1 items-center justify-center rounded-[3px] text-[10px] font-semibold"
            style={{ backgroundColor: heatColor(s.days_of_cover, COVER_SCALE), color: heatInk(heatBin(s.days_of_cover, COVER_SCALE)) }}
          >
            {Math.round(s.days_of_cover)}
          </span>
        ))}
        {stock.length === 0 && <span className="text-[11px] text-muted">No stock rows</span>}
      </div>
    </div>
  );
}

/** District warehouse cover per medicine (days) with expiry flags, from the logistics warehouse endpoints. */
export function WarehouseCover({ scope }: { scope: string }) {
  const { data, isLoading } = useWarehouses(scope);
  const items = (data?.items ?? []).filter((w) => w.type === "district" || w.type === "central");
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (items.length === 0) return <p className="text-[12px] text-muted">Warehouse stock is not available while the backend is offline.</p>;
  return (
    <div className="space-y-2">
      {items.map((w) => (
        <WarehouseRow key={w.id} id={w.id} name={w.name} />
      ))}
      <p className="text-[11px] text-faint">Cell value is days of cover, in the order the medicines are stocked. Hover for batch and expiry.</p>
    </div>
  );
}

/* ---------- filterable stock table ---------- */

export function StockTable({
  rows,
  factor,
  facilityFilter,
  onClearFacility,
}: {
  rows: StockRow[];
  factor: number;
  facilityFilter: string | null;
  onClearFacility: () => void;
}) {
  const [medicine, setMedicine] = useState("all");
  const [district, setDistrict] = useState("all");
  const [maxDays, setMaxDays] = useState("all");
  const [flag, setFlag] = useState("all");

  const meds = useMemo(() => [...new Set(rows.map((r) => r.medicine))].sort(), [rows]);
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (facilityFilter && r.facilityId !== facilityFilter) return false;
        if (medicine !== "all" && r.medicine !== medicine) return false;
        if (district !== "all" && r.districtId !== district) return false;
        if (maxDays !== "all" && coverUnder(r.days, factor) >= Number(maxDays)) return false;
        if (flag === "emergency" && !r.emergency) return false;
        if (flag === "cold" && !r.coldChain) return false;
        return true;
      }),
    [rows, facilityFilter, medicine, district, maxDays, flag, factor],
  );

  const columns: Column<StockRow>[] = [
    {
      key: "facility",
      header: "Facility",
      accessor: (r) => r.facilityName,
      sortable: true,
      cell: (r) => (
        <Link href={`/facilities/${r.facilityId}`} className="font-medium hover:text-brand">
          {r.facilityName}
        </Link>
      ),
    },
    { key: "district", header: "District", accessor: (r) => shortDistrict(r.districtId), sortable: true },
    {
      key: "medicine",
      header: "Medicine",
      accessor: (r) => r.medicine,
      sortable: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.medicine}
          {r.coldChain && <Snowflake size={11} className="text-cyan" aria-label="Cold chain" />}
        </span>
      ),
    },
    { key: "units", header: "On hand", accessor: (r) => r.units, sortable: true, align: "right", cell: (r) => `${r.units} ${r.unit}` },
    {
      key: "days",
      header: "Cover (days)",
      accessor: (r) => coverUnder(r.days, factor),
      sortable: true,
      width: 190,
      cell: (r) => {
        const d = coverUnder(r.days, factor);
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (d / 21) * 100)}%`, backgroundColor: heatColor(d, COVER_SCALE) }} />
            </div>
            <span className="num w-9 text-right font-semibold">{fmt1(d)}</span>
          </div>
        );
      },
    },
    { key: "confidence", header: "Confidence", accessor: (r) => r.confidence, sortable: true, align: "right", cell: (r) => `${r.confidence}%` },
  ];

  const districtOptions = [{ value: "all", label: "All districts" }, ...DISTRICT_ORDER.map((d) => ({ value: d, label: shortDistrict(d) }))];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={medicine} onValueChange={setMedicine} ariaLabel="Medicine filter" options={[{ value: "all", label: "All medicines" }, ...meds.map((m) => ({ value: m, label: m }))]} />
        <Select value={district} onValueChange={setDistrict} ariaLabel="District filter" options={districtOptions} />
        <Select
          value={maxDays}
          onValueChange={setMaxDays}
          ariaLabel="Maximum days of cover"
          options={[
            { value: "all", label: "Any cover" },
            { value: "3", label: "Under 3 days" },
            { value: "7", label: "Under 7 days" },
            { value: "14", label: "Under 14 days" },
          ]}
        />
        <Select
          value={flag}
          onValueChange={setFlag}
          ariaLabel="Medicine type"
          options={[
            { value: "all", label: "All types" },
            { value: "emergency", label: "Emergency only" },
            { value: "cold", label: "Cold chain only" },
          ]}
        />
        {facilityFilter && (
          <button type="button" onClick={onClearFacility} className="h-8 rounded-md border border-border-strong bg-surface-2 px-2.5 text-[12px] text-text hover:bg-surface-3">
            Clear facility filter
          </button>
        )}
        <span className="num ml-auto text-[12px] text-muted">{filtered.length} of {rows.length} rows</span>
      </div>
      <DataTable columns={columns} rows={filtered} rowKey={(r) => r.key} initialSort={{ key: "days", dir: "asc" }} density="compact" maxHeight={420} />
    </div>
  );
}
