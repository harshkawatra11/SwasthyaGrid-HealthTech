"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { AXIS_TICK, CURSOR_BAND, ChartFrame, GRID_PROPS } from "@/components/charts/common";
import { MultiLineForecast } from "@/components/charts/MultiLineForecast";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { KpiTile } from "@/components/ds/KpiTile";
import { Meter } from "@/components/ds/Meter";
import { PageHeader } from "@/components/ds/PageHeader";
import { PriorityChip } from "@/components/ds/PriorityChip";
import { RiskChip } from "@/components/ds/RiskChip";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { Skeleton } from "@/components/ds/Skeleton";
import type { MapFacility, MapWarehouse } from "@/components/map/client";
import {
  useDistricts,
  useFacilities,
  useFacilityMatrix,
  useFacilityProfile,
  useMedicines,
  useRecommendations,
  useStateSummary,
  useWarehouse,
  useWarehouses,
} from "@/lib/api/hooks";
import type { DistrictSummaryRow } from "@/lib/api/types";
import { useEntityIndex } from "@/lib/entity-index";
import { fmtInt } from "@/lib/format";
import { withScope } from "@/lib/scope";
import { toSeries, useDistrictFootfalls } from "./data";
import { DistrictMap } from "./DistrictMap";
import { BEDS_SCALE, COVER_SCALE, Callout, CausalChain, InlineBar, InsightCard, Moneyshot, PERF_SCALE, RiskMixBar, coverTone } from "./kit";
import { Scorecard, PRINT_CSS } from "./Scorecard";
import { SCENARIOS, applyScenario, districtHeadline, peakDay, shortMedicine, shortName, type FacilityRow, type Scenario } from "./metrics";
import { heatColor } from "@/lib/heat";
import { DISTRICT_IDS } from "@/lib/scope";

const CHAIN_EFFECT = "Stock and beds under pressure";

export function DistrictDetail({ districtId }: { districtId: string }) {
  const index = useEntityIndex();
  const districts = useDistricts();
  const summary = useStateSummary(districtId);
  const all = useStateSummary("all");
  const matrix = useFacilityMatrix(districtId);
  const facs = useFacilities(districtId);
  const meds = useMedicines(districtId);
  const whs = useWarehouses(districtId);
  const recs = useRecommendations({ district_id: districtId });
  const footfalls = useDistrictFootfalls();
  const [scenario, setScenario] = useState<Scenario>("realistic");

  const row = summary.data?.districts.find((d) => d.district_id === districtId);
  const rows = useMemo(() => (matrix.data?.rows ?? []).filter((r) => r.district_id === districtId), [matrix.data, districtId]);
  const ranked = useMemo(() => [...rows].sort((a, b) => order(b) - order(a) || (a.values.inventory ?? 99) - (b.values.inventory ?? 99)), [rows]);
  const worst = ranked[0];
  const p1 = useFacilityProfile(ranked[0]?.facility_id);
  const p2 = useFacilityProfile(ranked[1]?.facility_id);
  const p3 = useFacilityProfile(ranked[2]?.facility_id);
  const chainSource = [p1, p2, p3].map((p, i) => ({ p: p.data, row: ranked[i] })).find((x) => ((x.p?.causal_chain as { chain?: string[] } | null)?.chain?.length ?? 0) > 0);
  const districtWh = (whs.data?.items ?? []).find((w) => w.type === "district") ?? whs.data?.items[0];
  const wh = useWarehouse(districtWh?.id);

  const valid = (DISTRICT_IDS as readonly string[]).includes(districtId);
  if (!valid) {
    return (
      <div>
        <PageHeader eyebrow="Districts" title="District not found" breadcrumbs={[{ label: "Districts", href: "/districts" }, { label: "Not found" }]} />
        <p className="text-[13px] text-muted">This district is not part of the five monitored districts.</p>
      </div>
    );
  }
  if (!row || !facs.data) {
    return (
      <div>
        <PageHeader eyebrow="Districts" title="District report" />
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-[470px] lg:col-span-7" />
          <Skeleton className="h-[470px] lg:col-span-5" />
        </div>
      </div>
    );
  }

  const name = shortName(row.name);
  const info = districts.data?.districts.find((d) => d.id === districtId);
  const peers = (all.data?.districts ?? []).filter((d) => d.district_id !== districtId);
  const avg = (f: (d: DistrictSummaryRow) => number) => (peers.length ? peers.reduce((a, d) => a + f(d), 0) / peers.length : 0);
  const facilityInfo = new Map(facs.data.facilities.map((f) => [f.id, f]));
  const worstMed = new Map<string, string>();
  for (const m of meds.data?.medicines ?? []) {
    const cur = worstMed.get(m.facility_id);
    const curDays = (meds.data?.medicines ?? []).filter((x) => x.facility_id === m.facility_id).reduce((a, x) => Math.min(a, x.days_remaining), 999);
    if (!cur && m.days_remaining === curDays) worstMed.set(m.facility_id, shortMedicine(m.medicine_name));
  }
  const mapFacilities: MapFacility[] = facs.data.facilities.map((f) => ({ id: f.id, name: f.name, lat: f.lat, lng: f.lng, risk: f.risk_level, worstMedicine: worstMed.get(f.id) }));
  const mapWarehouses: MapWarehouse[] = (whs.data?.items ?? []).map((w) => ({ id: w.id, name: w.name, lat: w.lat, lng: w.lng, central: w.type === "central" }));

  const dist = (f: (r: FacilityRow) => number | null) => rows.map((r) => f(r) ?? 0);
  const kpi = (label: string, value: number, peerAvg: number, extra: Partial<React.ComponentProps<typeof KpiTile>> = {}) => (
    <KpiTile key={label} label={label} value={value} hint={<span>State peers avg <span className="num text-text">{peerAvg.toFixed(peerAvg < 10 ? 1 : 0)}</span></span>} {...extra} />
  );

  const ownSeries = toSeries(footfalls[districtId]);
  const peerIds = DISTRICT_IDS.filter((d) => d !== districtId);
  const peerSeries = peerIds.map((id) => toSeries(footfalls[id]));
  const scen = applyScenario(ownSeries, scenario);
  const peerAvgFoot = ownSeries.map((_, i) => {
    const vs = peerSeries.map((s) => s[i]?.actual ?? s[i]?.predicted).filter((v): v is number => typeof v === "number");
    return vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : null;
  });
  const foreFrom = ownSeries.find((p) => p.actual === undefined)?.day;
  const footData = scen.map((p, i) => ({
    day: p.day,
    actual: p.actual ?? null,
    predicted: p.predicted ?? null,
    peers: peerAvgFoot[i],
  }));
  const peak = peakDay(scen);
  const breakdown = Object.entries(footfalls[districtId]?.tomorrow_breakdown ?? {}).map(([k, v]) => ({ group: k[0].toUpperCase() + k.slice(1), visits: v }));
  const topGroup = [...breakdown].sort((a, b) => b.visits - a.visits)[0];
  const totalTomorrow = breakdown.reduce((a, b) => a + b.visits, 0);

  const wcols = (wh.data?.stock ?? []).filter((x) => typeof x.days_of_cover === "number").slice().sort((a, b) => a.days_of_cover - b.days_of_cover);
  const pendingRecs = (recs.data?.recommendations ?? []).filter((r) => r.status === "pending");
  const doneRecs = (recs.data?.recommendations ?? []).filter((r) => r.status !== "pending");
  const critical = row.risk_counts.critical;

  const cols: Column<FacilityRow>[] = [
    {
      key: "name",
      header: "Facility",
      accessor: (r) => r.facility_name,
      sortable: true,
      cell: (r) => (
        <Link href={`/facilities/${r.facility_id}`} className="font-medium text-text hover:text-brand">
          {r.facility_name}
        </Link>
      ),
    },
    { key: "type", header: "Type", accessor: (r) => facilityInfo.get(r.facility_id)?.type ?? "", sortable: true, cell: (r) => <span className="text-muted">{facilityInfo.get(r.facility_id)?.type}</span> },
    { key: "risk", header: "Risk", accessor: (r) => order(r), sortable: true, cell: (r) => <RiskChip level={r.risk_level} size="sm" /> },
    {
      key: "cover",
      header: "Min cover",
      accessor: (r) => r.values.inventory,
      sortable: true,
      align: "right",
      cell: (r) => <InlineBar value={r.values.inventory === null ? null : Math.min(21, r.values.inventory)} max={21} color={heatColor(r.values.inventory, COVER_SCALE)} label={r.values.inventory === null ? "-" : `${r.values.inventory}d`} width={80} />,
    },
    {
      key: "beds",
      header: "Beds +7d",
      accessor: (r) => r.values.beds,
      sortable: true,
      align: "right",
      cell: (r) => <InlineBar value={r.values.beds} max={100} color={heatColor(r.values.beds, BEDS_SCALE)} label={r.values.beds === null ? "-" : `${Math.round(r.values.beds)}%`} width={80} />,
    },
    {
      key: "perf",
      header: "Performance",
      accessor: (r) => r.values.performance,
      sortable: true,
      align: "right",
      cell: (r) => <InlineBar value={r.values.performance} max={100} color={heatColor(r.values.performance, PERF_SCALE)} label={r.values.performance === null ? "-" : String(Math.round(r.values.performance))} width={80} />,
    },
    { key: "staff", header: "Doctors at risk", accessor: (r) => r.values.staffing, sortable: true, align: "center", cell: (r) => (r.values.staffing ? <span className="text-risk-stress">Yes</span> : <span className="text-faint">No</span>) },
    { key: "diag", header: "Tests down", accessor: (r) => r.values.diagnostics, sortable: true, align: "center" },
    {
      key: "eta",
      header: "Inbound ETA",
      accessor: (r) => r.values.supply,
      sortable: true,
      align: "right",
      cell: (r) => (r.values.supply === null ? <span className="text-faint">none</span> : <span className="num">{r.values.supply < 1 ? "under 1h" : `${r.values.supply}h`}</span>),
    },
  ];

  const scoreActions = doneRecs;

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>
      <PageHeader
        eyebrow={`District report${info?.hq_city ? ` / HQ ${info.hq_city}` : ""}${info?.rto_code ? ` / RTO ${info.rto_code}` : ""}`}
        title={row.name}
        breadcrumbs={[{ label: "Districts", href: "/districts" }, { label: name }]}
        description={`${districtHeadline(rows, name)}. Peer comparisons use the average of the other four districts.`}
        actions={
          <>
            <Moneyshot value={critical} unit={`of ${row.facilities}`} label={`facilities critical in ${name}`} href={withScope("/facilities?risk=critical", districtId)} />
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface-1 px-3 text-[12px] font-medium text-text hover:bg-surface-2"
            >
              <Printer size={14} aria-hidden /> Print scorecard
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <InsightCard
            eyebrow="District map"
            title={`${critical} critical and ${row.risk_counts.stress} stressed facilities across ${name}, served by ${mapWarehouses.length} warehouse${mapWarehouses.length === 1 ? "" : "s"}`}
            section="District / Map"
            source="Source: facilities, logistics warehouses and live vehicle positions. Boundary shaded by risk index."
            className="h-full"
            bodyClassName="p-0"
          >
            <DistrictMap districtId={districtId} riskIndex={row.risk_index} facilities={mapFacilities} warehouses={mapWarehouses} height={470} />
          </InsightCard>
        </div>
        <div className="grid grid-cols-2 content-start gap-3 lg:col-span-5">
          {kpi("Risk index", row.risk_index, avg((d) => d.risk_index), { tone: row.risk_index > 35 ? "critical" : "warning", sparkline: dist((r) => order(r)), href: "/districts" })}
          {kpi("Critical facilities", critical, avg((d) => d.risk_counts.critical), { tone: critical > 0 ? "critical" : "good", href: withScope("/facilities?risk=critical", districtId), sparkline: dist((r) => r.values.inventory) })}
          {kpi("Stock-out items", row.stockout_items, avg((d) => d.stockout_items), { tone: row.stockout_items > 0 ? "critical" : "good", href: withScope("/inventory", districtId) })}
          {kpi("Beds next week", Math.round(row.bed_next_week_avg), avg((d) => d.bed_next_week_avg), { unit: "%", href: withScope("/beds", districtId), sparkline: dist((r) => r.values.beds) })}
          {kpi("Doctors at risk", row.doctors_high_risk, avg((d) => d.doctors_high_risk), { href: withScope("/doctors", districtId) })}
          {kpi("Pending approvals", row.pending_recommendations, avg((d) => d.pending_recommendations), { href: withScope("/recommendations", districtId) })}
          {kpi("In transit", row.shipments_in_transit, avg((d) => d.shipments_in_transit), { href: withScope("/supply", districtId), className: "col-span-2" })}
          <div className="col-span-2 rounded-md border border-border bg-surface-1 p-3">
            <p className="eyebrow mb-1.5">Facility risk mix</p>
            <RiskMixBar counts={row.risk_counts} showLegend />
          </div>
        </div>
      </div>

      <InsightCard
        eyebrow="Facility table"
        title={worst ? `${worst.facility_name} is the weakest of ${rows.length} facilities: ${worst.values.inventory ?? "no"} days of stock and beds at ${Math.round(worst.values.beds ?? 0)}% next week` : "Facilities"}
        section="District / Facilities"
        source="Source: insights/facility-matrix. Bars are coloured on the same heat scale as the Command Centre."
        bodyClassName="p-0"
      >
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.facility_id} density="compact" stickyHeader={false} initialSort={{ key: "risk", dir: "desc" }} />
      </InsightCard>

      <div className="grid gap-4 lg:grid-cols-12">
        <InsightCard
          className="lg:col-span-7"
          eyebrow="Footfall, actual against predicted"
          title={peak ? `${name} peaks at ${fmtInt(peak.value)} visits on ${peak.day} under the ${SCENARIOS[scenario].label.toLowerCase()} case` : "Footfall forecast"}
          section="District / Footfall"
          source="Source: footfall/forecast. Scenarios scale forecast days only, computed on this page."
          actions={
            <SegmentedControl
              value={scenario}
              onChange={setScenario}
              ariaLabel="Scenario"
              options={(Object.keys(SCENARIOS) as Scenario[]).map((k) => ({ value: k, label: SCENARIOS[k].label }))}
            />
          }
          read={`${SCENARIOS[scenario].assumption}. The grey line is the average of the other four districts.`}
        >
          <MultiLineForecast
            data={footData}
            xKey="day"
            forecastFrom={foreFrom}
            height={250}
            unit="visits"
            series={[
              { key: "actual", name: "Actual", color: "var(--series-1)" },
              { key: "predicted", name: "Predicted", color: "var(--series-2)", dashed: true },
              { key: "peers", name: "Other four districts", color: "var(--text-faint)", dashed: true },
            ]}
          />
          {peak && <div className="mt-2"><Callout>Peak day: {peak.day}, {fmtInt(peak.value)} visits</Callout></div>}
        </InsightCard>
        <InsightCard
          className="lg:col-span-5"
          eyebrow="Tomorrow breakdown"
          title={topGroup ? `${topGroup.group} are the largest group tomorrow, ${topGroup.visits} of ${totalTomorrow} visits` : "Tomorrow breakdown"}
          section="District / Footfall"
          source="Source: footfall/forecast tomorrow_breakdown, one day ahead"
          read="Plan staff and stock for the largest bar first."
        >
          <ChartFrame label="Tomorrow's footfall by patient group">
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 250 }}>
                <BarChart data={breakdown} layout="vertical" margin={{ top: 4, right: 32, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                  <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis type="category" dataKey="group" tick={AXIS_TICK} tickLine={false} axisLine={false} width={64} />
                  <Tooltip cursor={CURSOR_BAND} content={<ChartTooltip unit="visits" />} />
                  <Bar dataKey="visits" name="Visits" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
                    <LabelList dataKey="visits" position="right" fill="var(--text-muted)" fontSize={11} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartFrame>
        </InsightCard>
      </div>

      <InsightCard
        eyebrow="Causal chain"
        title={
          chainSource
            ? `${chainSource.row.facility_name}: ${String((chainSource.p?.causal_chain as { headline?: string }).headline ?? "why demand moved").toLowerCase()}`
            : `${worst?.facility_name ?? "The weakest facility"} is short because stock, beds and staffing signals point the same way`
        }
        section="District / Causes"
        source="Source: facility profile causal_chain; when the model finds no signal the chain is built from the facility matrix"
        read="Each step is a signal behind the forecast; the last box is what the district officer sees."
      >
        {chainSource ? (
          <CausalChain steps={(chainSource.p?.causal_chain as { chain: string[] }).chain} effect={CHAIN_EFFECT} />
        ) : worst ? (
          <CausalChain
            steps={[
              `${worst.values.inventory ?? "No"} days of stock cover`,
              `Beds at ${Math.round(worst.values.beds ?? 0)}% next week`,
              worst.values.staffing ? "A doctor at high absence risk" : "Staffing holds",
              `Performance score ${Math.round(worst.values.performance ?? 0)}`,
            ]}
            effect={CHAIN_EFFECT}
          />
        ) : (
          <Skeleton className="h-16" />
        )}
      </InsightCard>

      <div className="grid gap-4 lg:grid-cols-12">
        <InsightCard
          className="lg:col-span-5"
          eyebrow="District warehouse cover"
          title={wcols[0] ? `${districtWh?.name ?? "The warehouse"} holds ${wcols[0].days_of_cover} days of ${shortMedicine(wcols[0].medicine_name)}, its lowest line` : "District warehouse cover"}
          section="District / Warehouse"
          source="Source: logistics/warehouses stock, days of cover against a 30 day window"
          read="Meters are days of cover out of 30; low lines cap what a replenishment can deliver."
        >
          <ul className="space-y-2.5">
            {wcols.map((s) => (
              <li key={s.medicine_name}>
                <div className="mb-0.5 flex items-center justify-between text-[12px]">
                  <span className="text-text">{shortMedicine(s.medicine_name)}</span>
                  <span className="num text-muted">
                    {fmtInt(s.units)} units, {s.days_of_cover} days
                  </span>
                </div>
                <Meter value={Math.min(30, s.days_of_cover)} max={30} tone={coverTone(s.days_of_cover)} showValue={false} />
              </li>
            ))}
            {wcols.length === 0 && <Skeleton className="h-24" />}
          </ul>
        </InsightCard>
        <InsightCard
          className="lg:col-span-7"
          eyebrow="Recommendations"
          title={`${pendingRecs.length} pending and ${doneRecs.length} already actioned for ${name}`}
          section="District / Actions"
          source="Source: recommendations engine v2, filtered to this district"
          actions={<Link href={withScope("/recommendations", districtId)} className="text-[12px] text-brand hover:underline">Open the desk</Link>}
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {[...pendingRecs, ...doneRecs].slice(0, 7).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-[12px]">
                <PriorityChip priority={r.priority} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-text">
                    {r.subject}
                    <span className="font-normal text-muted"> to {index.facilityName(r.target_facility_id)}</span>
                  </p>
                  <p className="truncate text-muted">{r.quantity_or_detail}</p>
                </div>
                <span className="num text-muted">{r.confidence}%</span>
                <span className="w-20 text-right capitalize text-muted">{r.status}</span>
              </li>
            ))}
            {pendingRecs.length + doneRecs.length === 0 && <li className="px-4 py-6 text-center text-[12px] text-muted">No recommendations for this district.</li>}
          </ul>
        </InsightCard>
      </div>

      <Scorecard
        row={row}
        matrix={{ dimensions: matrix.data?.dimensions ?? [], rows }}
        topRisks={summary.data?.top_risks ?? []}
        actions={scoreActions}
        generatedAt={summary.data?.generated_at ?? ""}
        facilityName={index.facilityName}
      />
    </div>
  );
}

function order(r: FacilityRow): number {
  return { healthy: 0, monitor: 1, stress: 2, critical: 3 }[r.risk_level];
}
