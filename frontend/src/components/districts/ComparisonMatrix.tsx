"use client";

import Link from "next/link";
import { useMemo } from "react";
import { DataTable, type Column } from "@/components/ds/DataTable";
import type { DistrictSummaryRow } from "@/lib/api/types";
import { heatColor, type HeatScale } from "@/lib/heat";
import { cn } from "@/lib/cn";
import { withScope } from "@/lib/scope";
import { shortName } from "./metrics";

type Metric = {
  key: string;
  header: string;
  get: (r: DistrictSummaryRow) => number;
  format: (v: number) => string;
  higherIsWorse: boolean;
  /** Where clicking a cell of this column goes (the rows that prove it). */
  href: (r: DistrictSummaryRow) => string;
};

const int = (v: number) => String(Math.round(v));
const pctFmt = (v: number) => `${Math.round(v)}%`;

export const MATRIX_METRICS: Metric[] = [
  { key: "risk_index", header: "Risk index", get: (r) => r.risk_index, format: int, higherIsWorse: true, href: (r) => `/districts/${r.district_id}` },
  { key: "critical", header: "Critical", get: (r) => r.risk_counts.critical, format: int, higherIsWorse: true, href: (r) => withScope("/facilities?risk=critical", r.district_id) },
  { key: "stockout", header: "Stock-out", get: (r) => r.stockout_items, format: int, higherIsWorse: true, href: (r) => withScope("/inventory", r.district_id) },
  { key: "low_cover", header: "Low", get: (r) => r.low_cover_items, format: int, higherIsWorse: true, href: (r) => withScope("/inventory", r.district_id) },
  { key: "beds_now", header: "Beds", get: (r) => r.bed_occupancy_avg, format: pctFmt, higherIsWorse: true, href: (r) => withScope("/beds", r.district_id) },
  { key: "beds_week", header: "Beds +7d", get: (r) => r.bed_next_week_avg, format: pctFmt, higherIsWorse: true, href: (r) => withScope("/beds", r.district_id) },
  { key: "doctors", header: "Doctors", get: (r) => r.doctors_high_risk, format: int, higherIsWorse: true, href: (r) => withScope("/doctors", r.district_id) },
  { key: "diag", header: "Diag. down", get: (r) => r.diagnostics_down, format: int, higherIsWorse: true, href: (r) => withScope("/diagnostics", r.district_id) },
  { key: "pending", header: "Pending", get: (r) => r.pending_recommendations, format: int, higherIsWorse: true, href: (r) => withScope("/recommendations", r.district_id) },
  { key: "transit", header: "In transit", get: (r) => r.shipments_in_transit, format: int, higherIsWorse: false, href: (r) => withScope("/supply", r.district_id) },
  { key: "ontime", header: "On time 7d", get: (r) => r.on_time_rate_7d * 100, format: pctFmt, higherIsWorse: false, href: (r) => withScope("/supply", r.district_id) },
  { key: "footfall", header: "Footfall", get: (r) => r.footfall_tomorrow, format: int, higherIsWorse: true, href: (r) => withScope("/footfall", r.district_id) },
];

/** Quartile scale over a column, so each column is coloured relative to its five districts. */
export function relativeScale(values: number[], higherIsWorse: boolean): HeatScale {
  const s = [...values].sort((a, b) => a - b);
  const lo = s[0] ?? 0;
  const hi = s[s.length - 1] ?? 0;
  const step = (hi - lo) / 5;
  const cuts = [1, 2, 3, 4].map((i) => lo + step * i);
  const thresholds = (higherIsWorse ? cuts : [...cuts].reverse()) as [number, number, number, number];
  return { thresholds, higherIsWorse };
}

export function ComparisonMatrix({ rows, scope }: { rows: DistrictSummaryRow[]; scope: string }) {
  const scales = useMemo(() => {
    const out: Record<string, HeatScale> = {};
    for (const m of MATRIX_METRICS) out[m.key] = relativeScale(rows.map(m.get), m.higherIsWorse);
    return out;
  }, [rows]);
  const flat = (m: Metric) => new Set(rows.map(m.get)).size <= 1;

  const columns: Column<DistrictSummaryRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "District",
        accessor: (r) => r.name,
        sortable: true,
        cell: (r) => (
          <Link href={`/districts/${r.district_id}`} className={cn("font-medium text-text hover:text-brand", scope === r.district_id && "text-brand")}>
            {shortName(r.name)}
          </Link>
        ),
      },
      ...MATRIX_METRICS.map<Column<DistrictSummaryRow>>((m) => ({
        key: m.key,
        header: m.header,
        accessor: m.get,
        sortable: true,
        align: "center",
        cell: (r) => (
          <Link
            href={m.href(r)}
            title={`${m.header}: ${m.format(m.get(r))}. Open the rows behind this number.`}
            className="num block rounded-[4px] px-1 py-1 text-[12px] font-medium text-text"
            style={{ backgroundColor: flat(m) ? "var(--surface-3)" : heatColor(m.get(r), scales[m.key]), color: "var(--heat-text, var(--text))" }}
          >
            {m.format(m.get(r))}
          </Link>
        ),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flat depends on rows only
    [scales, scope, rows],
  );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.district_id}
      density="compact"
      initialSort={{ key: "risk_index", dir: "desc" }}
      stickyHeader={false}
    />
  );
}
