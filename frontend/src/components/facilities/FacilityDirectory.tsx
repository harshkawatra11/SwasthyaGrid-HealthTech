"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Search, X } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Bar, BarChart, CartesianGrid, XAxis, YAxis, LabelList } from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { AXIS_TICK, CURSOR_BAND, ChartFrame, GRID_PROPS } from "@/components/charts/common";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { KpiTile } from "@/components/ds/KpiTile";
import { PageHeader } from "@/components/ds/PageHeader";
import { RiskChip } from "@/components/ds/RiskChip";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { Skeleton } from "@/components/ds/Skeleton";
import { StatusChip } from "@/components/ds/StatusChip";
import { Callout, InlineBar, InsightCard, Moneyshot } from "@/components/districts/kit";
import { shortName } from "@/components/districts/metrics";
import { useBeds, useFacilities, useFacilityMatrix, useShipments, useStateSummary } from "@/lib/api/hooks";
import type { ShipmentSummary } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { RISK_LABEL, riskVar, type RiskLevel } from "@/lib/domain";
import { useEntityIndex } from "@/lib/entity-index";
import { heatColor } from "@/lib/heat";
import { useScope } from "@/lib/scope";
import {
  LENSES,
  LENS_DEFS,
  histogram,
  isLens,
  lensColor,
  lensTitle,
  matchesFilters,
  parseFilters,
  rankByLens,
  tileName,
  type FacilityRow,
  type Lens,
} from "./lenses";

const RISKS: RiskLevel[] = ["critical", "stress", "monitor", "healthy"];
const ACTIVE = new Set(["approved", "loading", "in_transit", "delayed"]);

export function FacilityDirectory() {
  const { scope } = useScope();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const index = useEntityIndex();
  const matrix = useFacilityMatrix(scope);
  const facs = useFacilities(scope);
  const beds = useBeds(scope);
  const ships = useShipments({ limit: 200, ...(scope !== "all" ? { district_id: scope } : {}) });
  const summary = useStateSummary(scope);

  const lensParam = params.get("lens");
  const lens: Lens = isLens(lensParam) ? lensParam : "risk";
  const filters = parseFilters((k) => params.get(k));

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const typeOf = useMemo(() => new Map((facs.data?.facilities ?? []).map((f) => [f.id, f.type])), [facs.data]);
  const bedsNow = useMemo(() => new Map((beds.data?.beds ?? []).map((b) => [b.facility_id, b.occupancy_pct ?? null])), [beds.data]);
  const inbound = useMemo(() => {
    const m = new Map<string, ShipmentSummary>();
    for (const s of ships.data?.items ?? []) if (ACTIVE.has(s.status) && !m.has(s.destination.id)) m.set(s.destination.id, s);
    return m;
  }, [ships.data]);

  const allRows = useMemo(() => matrix.data?.rows ?? [], [matrix.data]);
  const rows = allRows.filter((r) => matchesFilters(r, typeOf.get(r.facility_id) ?? "", filters));
  const ranked = rankByLens(lens, rows);

  if (!matrix.data || allRows.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Facilities" title="Facility directory" />
        <Skeleton className="h-[420px]" />
      </div>
    );
  }

  const def = LENS_DEFS[lens];
  const matchIds = new Set(rows.map((r) => r.facility_id));
  const districtIds = [...new Set(allRows.map((r) => r.district_id))];
  const counts = { healthy: 0, monitor: 0, stress: 0, critical: 0 } as Record<RiskLevel, number>;
  for (const r of rows) counts[r.risk_level] += 1;
  const perf = rows.map((r) => r.values.performance).filter((v): v is number => typeof v === "number");
  const hist = histogram(perf, 60, 100, 5);
  const lowBin = hist.filter((h) => h.from < 70).reduce((a, h) => a + h.count, 0);
  const critAll = allRows.filter((r) => r.risk_level === "critical").length;
  const perDistrict = (f: (r: FacilityRow) => boolean) => districtIds.map((d) => allRows.filter((r) => r.district_id === d && f(r)).length);
  const avgPerf = perf.length ? perf.reduce((a, b) => a + b, 0) / perf.length : 0;
  const worst = ranked[0];

  const columns: Column<FacilityRow>[] = [
    {
      key: "name",
      header: "Facility",
      accessor: (r) => r.facility_name,
      sortable: true,
      cell: (r) => (
        <Link href={`/facilities/${r.facility_id}`} className="whitespace-nowrap font-medium text-text hover:text-brand">
          {r.facility_name}
        </Link>
      ),
    },
    { key: "district", header: "District", accessor: (r) => index.districtName(r.district_id), sortable: true, cell: (r) => <span className="text-muted">{shortName(index.districtName(r.district_id))}</span> },
    { key: "risk", header: "Risk", accessor: (r) => LENS_DEFS.risk.value(r), sortable: true, cell: (r) => <RiskChip level={r.risk_level} size="sm" /> },
    {
      key: "lens",
      header: def.metric,
      accessor: (r) => def.value(r),
      sortable: true,
      align: "right",
      cell: (r) => {
        const v = def.value(r);
        return <InlineBar value={v === null ? null : lens === "stock" ? Math.min(v, def.max) : v} max={def.max} color={lensColor(lens, r)} label={v === null ? "-" : def.format(v)} width={72} labelWidth={lens === "stock" || lens === "beds" || lens === "performance" ? 36 : 58} />;
      },
    },
    {
      key: "cover",
      header: "Min cover",
      accessor: (r) => r.values.inventory,
      sortable: true,
      align: "right",
      cell: (r) => <span className="num" style={{ color: (r.values.inventory ?? 99) < 3 ? "var(--risk-critical)" : undefined }}>{r.values.inventory === null ? "-" : `${r.values.inventory}d`}</span>,
    },
    { key: "bnow", header: "Beds now", accessor: (r) => bedsNow.get(r.facility_id) ?? null, sortable: true, align: "right", cell: (r) => <span className="num">{bedsNow.get(r.facility_id) == null ? "-" : `${bedsNow.get(r.facility_id)}%`}</span> },
    { key: "bweek", header: "Beds +7d", accessor: (r) => r.values.beds, sortable: true, align: "right", cell: (r) => <span className="num">{r.values.beds === null ? "-" : `${Math.round(r.values.beds)}%`}</span> },
    { key: "docs", header: "Doctors at risk", accessor: (r) => r.values.staffing, sortable: true, align: "center", cell: (r) => (r.values.staffing ? <span className="text-risk-stress">Yes</span> : <span className="text-faint">No</span>) },
    { key: "diag", header: "Tests down", accessor: (r) => r.values.diagnostics, sortable: true, align: "center" },
    { key: "perf", header: "Score", accessor: (r) => r.values.performance, sortable: true, align: "right", cell: (r) => <span className="num" style={{ color: heatColor(r.values.performance, LENS_DEFS.performance.scale!) === "var(--heat-4)" ? "var(--risk-critical)" : undefined }}>{r.values.performance === null ? "-" : Math.round(r.values.performance)}</span> },
    {
      key: "inbound",
      header: "Inbound",
      accessor: (r) => r.values.supply,
      sortable: true,
      align: "right",
      cell: (r) => {
        const s = inbound.get(r.facility_id);
        const eta = r.values.supply;
        if (!s && eta === null) return <span className="text-faint">none</span>;
        return (
          <span className="inline-flex items-center justify-end gap-2">
            {s && <StatusChip status={s.status} size="sm" />}
            {eta !== null && <span className="num whitespace-nowrap text-muted">{eta < 1 ? "under 1h" : `${eta}h`}</span>}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Facilities / Directory"
        title="Forty facilities, five lenses"
        description="Switch the lens and the tile grid and the ranked table below recolour together."
        actions={<Moneyshot value={critAll} unit={`of ${allRows.length}`} label="facilities are critical right now, open the list" href="/facilities?risk=critical" />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Critical" value={critAll} tone="critical" sparkline={perDistrict((r) => r.risk_level === "critical")} hint="Spark: by district" href="/facilities?risk=critical" />
        <KpiTile label="Under 3 days of stock" value={allRows.filter((r) => (r.values.inventory ?? 99) < 3).length} tone="critical" sparkline={perDistrict((r) => (r.values.inventory ?? 99) < 3)} hint="Facilities" href="/facilities?lens=stock" />
        <KpiTile label="Beds above 90% next week" value={allRows.filter((r) => (r.values.beds ?? 0) > 90).length} tone="warning" sparkline={perDistrict((r) => (r.values.beds ?? 0) > 90)} hint="Facilities" href="/facilities?lens=beds" />
        <KpiTile label="Doctors at risk" value={allRows.filter((r) => r.values.staffing).length} sparkline={perDistrict((r) => !!r.values.staffing)} hint="Facilities" href="/facilities?lens=staffing" />
        <KpiTile label="Tests down" value={allRows.reduce((a, r) => a + (r.values.diagnostics ?? 0), 0)} sparkline={perDistrict((r) => (r.values.diagnostics ?? 0) > 0)} hint="Across facilities" />
        <KpiTile label="Average score" value={Math.round(avgPerf)} tone={avgPerf < 80 ? "warning" : "good"} sparkline={perDistrict(() => true).map((_, i) => Math.round(avgOf(allRows.filter((r) => r.district_id === districtIds[i]))))} hint="Performance, 0 to 100" href="/facilities?lens=performance" />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <InsightCard
          className="lg:col-span-8"
          eyebrow={`Lens: ${def.label}`}
          title={lensTitle(lens, rows)}
          section="Facilities / Lens grid"
          source="Source: insights/facility-matrix, one tile per facility grouped by district"
          actions={
            <SegmentedControl
              value={lens}
              onChange={(v) => update({ lens: v === "risk" ? null : v })}
              ariaLabel="Lens"
              options={LENSES.map((l) => ({ value: l, label: LENS_DEFS[l].label }))}
            />
          }
        >
          <div data-testid="facility-grid" className="space-y-1.5">
            {districtIds.map((d) => {
              const list = allRows.filter((r) => r.district_id === d);
              return (
                <div key={d} className="flex items-stretch gap-2">
                  <p className="w-20 shrink-0 self-center text-right text-[11px] leading-tight text-muted">{shortName(index.districtName(d))}</p>
                  <div className="grid flex-1 grid-cols-4 gap-1 sm:grid-cols-8">
                    {list.map((r) => {
                      const v = def.value(r);
                      const on = matchIds.has(r.facility_id);
                      return (
                        <Link
                          key={r.facility_id}
                          data-testid="facility-tile"
                          href={`/facilities/${r.facility_id}`}
                          title={`${r.facility_name}: ${v === null ? "no data" : def.format(v)}. Open the case file.`}
                          className={cn("flex h-[62px] flex-col justify-between rounded-[6px] px-1.5 py-1 text-[11px] leading-tight transition-opacity hover:ring-2 hover:ring-brand", !on && "opacity-25")}
                          style={{ backgroundColor: lensColor(lens, r), color: "var(--tile-ink, var(--text))" }}
                        >
                          <span className="truncate font-medium">{tileName(r.facility_name)}</span>
                          <span className="num text-[11px] opacity-90">{v === null ? "-" : def.format(v)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {worst && <Callout tone={lens === "risk" || lens === "stock" ? "critical" : "default"}>{worst.facility_name}: {def.format(def.value(worst) ?? 0)} is the weakest on {def.label.toLowerCase()}</Callout>}
            <Legend lens={lens} />
          </div>
        </InsightCard>

        <div className="grid gap-4 lg:col-span-4">
          <InsightCard
            eyebrow="Risk mix"
            title={`${counts.critical + counts.stress} of ${rows.length} shown are stress or critical`}
            section="Facilities / Mix"
            source="Source: facility risk level, current filters"
            bodyClassName="py-3"
          >
            <div className="flex items-center gap-4">
              <div className="relative h-[130px] w-[130px] shrink-0">
                <ChartFrame label="Facilities by risk level">
                  <ResponsiveContainer width={130} height={130} initialDimension={{ width: 130, height: 130 }}>
                    <PieChart>
                      <Pie data={RISKS.map((k) => ({ name: RISK_LABEL[k], value: counts[k], key: k }))} dataKey="value" innerRadius={40} outerRadius={62} stroke="var(--surface-1)" strokeWidth={2} isAnimationActive={false}>
                        {RISKS.map((k) => (
                          <Cell key={k} fill={riskVar(k)} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip unit="facilities" />} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartFrame>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="num text-[22px] font-semibold text-text">{rows.length}</span>
                  <span className="text-[10px] text-faint">shown</span>
                </div>
              </div>
              <ul className="flex-1 space-y-1 text-[12px]">
                {RISKS.map((k) => (
                  <li key={k}>
                    <button
                      type="button"
                      onClick={() => update({ risk: filters.risks.length === 1 && filters.risks[0] === k ? null : k })}
                      className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-surface-2"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: riskVar(k) }} />
                      <span className="text-muted">{RISK_LABEL[k]}</span>
                      <span className="num ml-auto text-text">{counts[k]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </InsightCard>
          <InsightCard
            eyebrow="Performance scores"
            title={`${lowBin} facilities score under 70, the median is ${median(perf)}`}
            section="Facilities / Scores"
            source="Source: performance score = inventory, attendance, diagnostics, wait, forecast accuracy"
            read="Left bars are the facilities to coach first."
            bodyClassName="py-3"
          >
            <ChartFrame label="Distribution of performance scores">
              <div style={{ height: 118 }}>
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 118 }}>
                  <BarChart data={hist} margin={{ top: 14, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                    <YAxis hide />
                    <Tooltip cursor={CURSOR_BAND} content={<ChartTooltip unit="facilities" />} />
                    <Bar dataKey="count" name="Facilities" radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false}>
                      {hist.map((h) => (
                        <Cell key={h.label} fill={heatColor(h.from + 5, LENS_DEFS.performance.scale!)} />
                      ))}
                      <LabelList dataKey="count" position="top" fill="var(--text-muted)" fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartFrame>
          </InsightCard>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-2">
        <span className="eyebrow mr-1">Filter</span>
        {RISKS.map((k) => {
          const on = filters.risks.includes(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => update({ risk: (on ? filters.risks.filter((x) => x !== k) : [...filters.risks, k]).join(",") })}
              className={cn("inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[12px]", on ? "border-brand bg-brand-soft text-text" : "border-border text-muted hover:text-text")}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: riskVar(k) }} />
              {RISK_LABEL[k]}
            </button>
          );
        })}
        <SegmentedControl
          value={(filters.type || "all") as "all" | "PHC" | "CHC"}
          onChange={(v) => update({ type: v === "all" ? null : v })}
          ariaLabel="Facility type"
          options={[{ value: "all", label: "All types" }, { value: "PHC", label: "PHC" }, { value: "CHC", label: "CHC" }]}
        />
        <label className="ml-auto flex h-8 items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-muted focus-within:border-brand">
          <Search size={13} aria-hidden />
          <input
            aria-label="Search facilities"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Search by name"
            className="w-44 bg-transparent text-text outline-none placeholder:text-faint"
          />
        </label>
        {(filters.risks.length > 0 || filters.type || filters.q) && (
          <button type="button" onClick={() => update({ risk: null, type: null, q: null })} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-text">
            <X size={12} aria-hidden /> Clear
          </button>
        )}
      </div>

      <InsightCard
        eyebrow={`Ranked by ${def.metric.toLowerCase()}`}
        title={`${ranked.length} facilities, ${ranked[0] ? `${ranked[0].facility_name} ranks first on ${def.label.toLowerCase()}` : "none match the filters"}`}
        section="Facilities / Ranking"
        source={`Source: facility matrix and beds forecast. ${summary.data ? `${summary.data.totals.pending_recommendations} recommendations pending in scope.` : ""}`}
        bodyClassName="p-0"
      >
        <DataTable
          key={`${lens}-${scope}`}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.facility_id}
          density="compact"
          stickyHeader={false}
          initialSort={{ key: "lens", dir: def.higherIsWorse ? "desc" : "asc" }}
          onRowClick={(r) => router.push(`/facilities/${r.facility_id}`)}
          empty={<p className="px-4 py-10 text-center text-[12px] text-muted">No facilities match. Clear a filter to see more.</p>}
        />
      </InsightCard>
    </div>
  );
}

function avgOf(rows: FacilityRow[]): number {
  const v = rows.map((r) => r.values.performance).filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

function median(v: number[]): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)]);
}

function Legend({ lens }: { lens: Lens }) {
  const def = LENS_DEFS[lens];
  const items: Array<{ color: string; label: string }> =
    lens === "risk"
      ? (["healthy", "monitor", "stress", "critical"] as RiskLevel[]).map((k) => ({ color: riskVar(k), label: RISK_LABEL[k] }))
      : lens === "staffing"
        ? [{ color: "var(--heat-0)", label: "Covered" }, { color: "var(--heat-4)", label: "At risk" }]
        : [0, 1, 2, 3, 4].map((i) => {
            const t = def.scale!.thresholds;
            const h = def.scale!.higherIsWorse;
            const label = i === 0 ? (h ? `<= ${t[0]}` : `>= ${t[0]}`) : i === 4 ? (h ? `> ${t[3]}` : `< ${t[3]}`) : h ? `<= ${t[i]}` : `>= ${t[i]}`;
            return { color: `var(--heat-${i})`, label };
          });
  return (
    <ul className="flex flex-wrap items-center gap-3 text-[11px] text-muted" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: i.color }} />
          <span className="num">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}
