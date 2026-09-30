"use client";

import Link from "next/link";
import { AudioLines } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { AXIS_TICK, CURSOR_BAND, ChartFrame, GRID_PROPS } from "@/components/charts/common";
import { Callout, CausalChain, InsightCard, Moneyshot, coverTone } from "@/components/districts/kit";
import { shortName } from "@/components/districts/metrics";
import { Meter } from "@/components/ds/Meter";
import { PageHeader } from "@/components/ds/PageHeader";
import { PriorityChip } from "@/components/ds/PriorityChip";
import { RiskChip } from "@/components/ds/RiskChip";
import { Skeleton } from "@/components/ds/Skeleton";
import { StatBlock } from "@/components/ds/StatBlock";
import { Stepper } from "@/components/ds/Stepper";
import { StatusChip } from "@/components/ds/StatusChip";
import { Tooltip } from "@/components/ds/Tooltip";
import { useFacilityProfile, usePerformance } from "@/lib/api/hooks";
import { useEntityIndex } from "@/lib/entity-index";
import { fmtDateTime, fmtInt, fmtRelative } from "@/lib/format";
import { useLiveSimNow } from "@/lib/live/LiveProvider";
import { cn } from "@/lib/cn";
import { PERF_DIMS, caseTitle, districtMean, isActive, lowestCover, shortMed, stepsFor, weakestDimension } from "./case";

const STATUS_DOT: Record<string, string> = {
  pending: "var(--status-recommended)",
  approved: "var(--status-approved)",
  modified: "var(--status-approved)",
  dispatched: "var(--status-in-transit)",
  fulfilled: "var(--status-delivered)",
  rejected: "var(--status-cancelled)",
  expired: "var(--status-cancelled)",
  cancelled: "var(--status-cancelled)",
};

export function FacilityCaseFile({ facilityId }: { facilityId: string }) {
  const index = useEntityIndex();
  const profile = useFacilityProfile(facilityId);
  const perfAll = usePerformance(profile.data?.district_id ?? "all");
  const simNow = useLiveSimNow();
  const p = profile.data;

  if (profile.error?.status === 404) {
    return (
      <div>
        <PageHeader eyebrow="Facilities" title="Facility not found" breadcrumbs={[{ label: "Facilities", href: "/facilities" }, { label: "Not found" }]} />
        <p className="text-[13px] text-muted">No facility matches this link.</p>
      </div>
    );
  }
  if (!p) {
    return (
      <div>
        <PageHeader eyebrow="Facilities" title="Facility case file" />
        <Skeleton className="mb-4 h-40" />
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-96 lg:col-span-3" />
          <Skeleton className="h-96 lg:col-span-6" />
          <Skeleton className="h-96 lg:col-span-3" />
        </div>
      </div>
    );
  }

  const meds = [...p.medicine_stock].sort((a, b) => a.days_remaining - b.days_remaining);
  const low = lowestCover(meds);
  const perf = p.performance;
  const districtRows = perfAll.data?.performance ?? [];
  const mean = perf ? districtMean(districtRows, perf.facility_id) : {};
  const weak = perf ? weakestDimension(perf, districtRows) : null;
  const bed = p.bed_forecast;
  const chain = p.causal_chain as { headline?: string; chain?: string[] } | null;
  const radar = perf ? PERF_DIMS.map((d) => ({ dim: d.label, facility: perf[d.key] as number, district: mean[d.key] ?? 0 })) : [];
  const bedPoints = [
    { label: "Now", pct: bed.occupancy_pct ?? 0 },
    { label: "Tomorrow", pct: bed.predicted_tomorrow_pct ?? 0 },
    { label: "Next week", pct: bed.predicted_next_week_pct ?? 0 },
  ];
  const active = p.inbound.filter(isActive);
  const delivered = p.inbound.filter((s) => s.status === "delivered");
  const flagged = p.doctors.length;
  const downTests = p.diagnostics.filter((d) => d.status !== "available");
  const unitsBars = Object.entries(p.history_30d.units_received_by_medicine)
    .map(([k, v]) => ({ name: shortMed(k), units: v }))
    .sort((a, b) => b.units - a.units);
  const recs = [...p.recommendations].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const dname = shortName(p.district_name);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`Facility case file / ${p.type}`}
        title={p.name}
        breadcrumbs={[{ label: "Facilities", href: "/facilities" }, { label: dname, href: `/districts/${p.district_id}` }, { label: p.name }]}
        description={caseTitle(p.name, meds, p.inbound)}
        actions={
          <>
            {low && <Moneyshot value={low.days_remaining} unit="days" label={`of ${shortMed(low.medicine_name)}, the lowest cover here`} href="/inventory" tone={low.days_remaining < 3 ? "critical" : "brand"} />}
            <Link
              href={`/voice?ask=${encodeURIComponent(`Tell me about ${p.name}`)}`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface-1 px-3 text-[12px] font-medium text-text hover:bg-surface-2"
            >
              <AudioLines size={14} aria-hidden /> Ask about this facility
            </Link>
          </>
        }
      />

      {/* Case header strip: identity, radar, five performance bars */}
      <section className="grid gap-0 overflow-hidden rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)] lg:grid-cols-12" aria-label="Case header">
        <div className="space-y-3 border-b border-border p-4 lg:col-span-3 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center gap-2">
            <RiskChip level={p.risk_level} />
            <span className="rounded-sm bg-surface-3 px-2 py-1 text-[12px] text-muted">{p.type}</span>
          </div>
          <StatBlock
            columns={2}
            items={[
              { label: "District", value: dname },
              { label: "Beds", value: `${bed.occupied ?? 0} of ${(p as unknown as { beds_total?: number }).beds_total ?? "?"}`, mono: true },
              { label: "Doctors flagged", value: flagged, mono: true },
              { label: "Tests down", value: downTests.length, mono: true },
              { label: "Inbound", value: active.length, mono: true },
              { label: "Deliveries, 30 days", value: p.history_30d.deliveries, mono: true },
            ]}
          />
          <Link href={`/districts/${p.district_id}`} className="inline-block text-[12px] text-brand hover:underline">
            Open the {dname} district report
          </Link>
        </div>
        <div className="border-b border-border p-2 lg:col-span-4 lg:border-b-0 lg:border-r">
          <p className="eyebrow px-2 pt-1">Performance shape, facility against {dname} peers</p>
          <ChartFrame label="Performance radar">
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 360, height: 210 }}>
                <RadarChart data={radar} outerRadius="68%">
                  <PolarGrid stroke="var(--border-strong)" />
                  <PolarAngleAxis dataKey="dim" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
                  <Radar name="District peers" dataKey="district" stroke="var(--text-faint)" strokeDasharray="4 3" fill="var(--text-faint)" fillOpacity={0.08} isAnimationActive={false} />
                  <Radar name={p.name} dataKey="facility" stroke="var(--series-2)" strokeWidth={2} fill="var(--series-2)" fillOpacity={0.28} isAnimationActive={false} />
                  <RTooltip content={<ChartTooltip unit="pts" />} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </ChartFrame>
        </div>
        <div className="space-y-2.5 p-4 lg:col-span-5">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">Five performance bars</p>
            {perf && (
              <p className="text-[12px] text-muted">
                Overall <span className="num text-[18px] font-semibold text-text">{perf.overall}</span>
              </p>
            )}
          </div>
          {perf ? (
            PERF_DIMS.map((d) => {
              const v = perf[d.key] as number;
              const m = mean[d.key] ?? 0;
              return (
                <div key={d.key}>
                  <div className="mb-0.5 flex items-center justify-between text-[12px]">
                    <span className="text-text">{d.label}</span>
                    <span className="num text-muted">
                      <span className="text-text">{v}</span> vs peers {m}
                    </span>
                  </div>
                  <div className="relative h-2 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: v < 60 ? "var(--risk-critical)" : v < 80 ? "var(--risk-monitor)" : "var(--risk-healthy)" }} />
                    <span className="absolute top-0 h-full w-0.5 bg-text" style={{ left: `${m}%` }} aria-hidden />
                  </div>
                </div>
              );
            })
          ) : (
            <Skeleton className="h-32" />
          )}
          {weak && weak.gap < -5 && <Callout tone="critical">{weak.label} is {Math.abs(Math.round(weak.gap))} points below its district peers</Callout>}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left rail */}
        <div className="grid content-start gap-4 lg:col-span-3">
          <InsightCard
            eyebrow="Inbound shipments"
            title={active.length > 0 ? `${active.length} shipment${active.length === 1 ? "" : "s"} on the way to ${p.name}` : "Nothing is on the way"}
            section="Case / Supply"
            source="Source: logistics shipments, simulated operational data"
            bodyClassName="space-y-4"
          >
            {active.length === 0 && <p className="text-[12px] text-muted">No active shipment. See recommendations for what is proposed.</p>}
            {active.map((s) => (
              <div key={s.id} className="space-y-2 rounded-md border border-border bg-surface-2 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/supply/shipments/${s.id}`} className="num text-[12px] font-semibold text-text hover:text-brand">
                    {s.id}
                  </Link>
                  <StatusChip status={s.status} size="sm" live />
                </div>
                <p className="text-[12px] text-muted">{s.lines_summary}</p>
                <Stepper steps={stepsFor(s.status)} />
                <p className="text-[11px] text-muted">
                  {s.eta ? (
                    <>
                      ETA <span className="num text-text">{fmtDateTime(s.eta)}</span>
                      {simNow && <span className="num"> ({fmtRelative(s.eta, simNow)})</span>}
                    </>
                  ) : (
                    "No ETA yet"
                  )}
                  {s.delay_minutes > 0 && <span className="text-risk-stress"> , {s.delay_minutes} min late</span>}
                </p>
              </div>
            ))}
            {delivered.length > 0 && <p className="text-[11px] text-faint">{delivered.length} recent deliveries completed.</p>}
          </InsightCard>
          <InsightCard
            eyebrow="Units received, 30 days"
            title={`${p.history_30d.deliveries} deliveries brought ${fmtInt(unitsBars.reduce((a, b) => a + b.units, 0))} units`}
            section="Case / History"
            source="Source: seeded delivery history, simulated"
          >
            <ChartFrame label="Units received by medicine">
              <div style={{ height: Math.max(120, unitsBars.length * 30 + 20) }}>
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 260, height: 160 }}>
                  <BarChart data={unitsBars} layout="vertical" margin={{ top: 0, right: 34, bottom: 0, left: 4 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={78} />
                    <RTooltip cursor={CURSOR_BAND} content={<ChartTooltip unit="units" />} />
                    <Bar dataKey="units" name="Units" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false}>
                      <LabelList dataKey="units" position="right" fill="var(--text-muted)" fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartFrame>
          </InsightCard>
        </div>

        {/* Centre: the case */}
        <div className="grid content-start gap-4 lg:col-span-6">
          <InsightCard
            eyebrow="Medicine cover against 21 days"
            title={low ? `${shortMed(low.medicine_name)} runs out in ${low.days_remaining} days; ${meds.filter((m) => m.days_remaining < 7).length} of ${meds.length} tracked lines are under a week` : "No medicine is below the watch threshold"}
            section="Case / Medicines"
            source="Source: medicine forecast, days of cover = units / average daily use; hover a row for the forecast factors"
            read="Meters fill to 21 days of cover. Red is under 3 days, the point where a stock-out is imminent."
          >
            <ul className="space-y-3.5">
              {meds.map((m) => (
                <li key={m.medicine_name}>
                  <Tooltip content={<span className="block max-w-[260px] text-[11px] leading-snug">{m.factors.join(". ")}</span>}>
                    <div tabIndex={0} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand">
                      <div className="mb-1 flex items-center justify-between gap-3 text-[12px]">
                        <span className="font-medium text-text">
                          {m.medicine_name}
                          {m.emergency && <span className="ml-1.5 rounded-sm bg-surface-3 px-1 text-[10px] text-muted">Emergency</span>}
                          {m.cold_chain && <span className="ml-1 rounded-sm bg-surface-3 px-1 text-[10px] text-muted">Cold chain</span>}
                        </span>
                        <span className="num text-muted">
                          {fmtInt(m.units_remaining)} {m.unit ?? "units"} <span className="text-text">{m.days_remaining}d</span>
                          <span className="ml-2 text-faint">{m.confidence}% conf.</span>
                        </span>
                      </div>
                      <Meter value={Math.min(21, m.days_remaining)} max={21} tone={coverTone(m.days_remaining)} showValue={false} />
                    </div>
                  </Tooltip>
                </li>
              ))}
              {meds.length === 0 && <li className="text-[12px] text-muted">All tracked medicines are above the watch threshold.</li>}
            </ul>
          </InsightCard>

          <InsightCard
            eyebrow="Beds: now, tomorrow, next week"
            title={`Occupancy climbs from ${bedPoints[0].pct}% to ${bedPoints[2].pct}% within a week${bedPoints[2].pct > 90 ? ", above the 90% redirect line" : ""}`}
            section="Case / Beds"
            source="Source: beds forecast, occupancy = occupied / total beds"
            read="Above 90% a redirect recommendation is raised to the nearest facility with room."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                {bedPoints.map((b) => (
                  <Meter key={b.label} label={b.label} value={b.pct} max={100} />
                ))}
              </div>
              <ChartFrame label="Occupancy trajectory">
                <div style={{ height: 130 }}>
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 260, height: 130 }}>
                    <AreaChart data={bedPoints} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                      <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={30} />
                      <RTooltip content={<ChartTooltip unit="%" />} />
                      <Area type="monotone" dataKey="pct" name="Occupancy" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.15} isAnimationActive={false} dot={{ r: 3, fill: "var(--series-1)" }}>
                        <LabelList dataKey="pct" position="top" formatter={(v) => `${v}%`} fill="var(--text-muted)" fontSize={11} />
                      </Area>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </ChartFrame>
            </div>
          </InsightCard>

          <InsightCard
            eyebrow="Causal chain"
            title={chain?.chain?.length ? String(chain.headline ?? "Why demand moved") : "No causal signal above the noise for this facility"}
            section="Case / Causes"
            source="Source: causal_chain from the demand model"
          >
            {chain?.chain?.length ? (
              <CausalChain steps={chain.chain} effect={low ? `${shortMed(low.medicine_name)} at ${low.days_remaining} days` : "Higher demand"} />
            ) : (
              <p className="text-[12px] text-muted">The model found no dominant driver, so the shortfall is baseline consumption against a thin stock.</p>
            )}
          </InsightCard>
        </div>

        {/* Right rail */}
        <div className="grid content-start gap-4 lg:col-span-3">
          <InsightCard eyebrow="Doctors" title={flagged > 0 ? `${flagged} doctor${flagged === 1 ? "" : "s"} at high absence risk` : "No doctor flagged"} section="Case / Staffing" source="Source: doctors attendance model" bodyClassName="space-y-3">
            {p.doctors.length === 0 && <p className="text-[12px] text-muted">Attendance is on pattern.</p>}
            {p.doctors.map((d, i) => (
              <div key={i} className="text-[12px]">
                <p className="font-medium text-text">{String(d.doctor_name)}</p>
                <p className="text-muted">{String(d.specialty)}, {String(d.absence_pattern)}</p>
                <Meter label="Patients delayed" value={Number(d.patient_delay_pct)} max={100} tone="stress" />
              </div>
            ))}
          </InsightCard>
          <InsightCard eyebrow="Diagnostics" title={downTests.length > 0 ? `${downTests.length} test${downTests.length === 1 ? "" : "s"} not available` : "All tests available"} section="Case / Tests" source="Source: diagnostics status" bodyClassName="space-y-2">
            {p.diagnostics.length === 0 && <p className="text-[12px] text-muted">All tests are running.</p>}
            {p.diagnostics.map((d, i) => (
              <div key={i} className="rounded-sm bg-surface-2 px-2 py-1.5 text-[12px]">
                <p className="flex items-center justify-between font-medium text-text">
                  {String(d.test_name)}
                  <span className="text-risk-stress">{String(d.status).replace(/_/g, " ")}</span>
                </p>
                {d.nearest_alternative_facility_id ? (
                  <p className="text-muted">
                    Nearest alternative:{" "}
                    <Link href={`/facilities/${String(d.nearest_alternative_facility_id)}`} className="text-text hover:text-brand">
                      {index.facilityName(String(d.nearest_alternative_facility_id))}
                    </Link>
                    , <span className="num">{String(d.distance_km)} km</span>
                  </p>
                ) : null}
              </div>
            ))}
          </InsightCard>
          <InsightCard
            eyebrow="Recommendation timeline"
            title={recs.length > 0 ? `${recs.filter((r) => r.status === "pending").length} pending of ${recs.length} recommendations` : "No recommendations yet"}
            section="Case / Actions"
            source="Source: recommendations engine v2, all statuses"
          >
            <ol className="relative space-y-3 border-l border-border-strong pl-4">
              {recs.map((r) => (
                <li key={r.id} className="relative text-[12px]">
                  <span aria-hidden className={cn("absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface-1")} style={{ backgroundColor: STATUS_DOT[r.status] ?? "var(--text-faint)" }} />
                  <div className="flex items-center gap-2">
                    <PriorityChip priority={r.priority} size="sm" />
                    <span className="capitalize text-muted">{r.status}</span>
                  </div>
                  <p className="mt-0.5 font-medium text-text">{r.subject}</p>
                  <p className="text-muted">{r.quantity_or_detail}</p>
                  <p className="num text-[11px] text-faint">
                    {fmtDateTime(r.created_at)}
                    {r.resolved_by ? `, ${r.resolved_by}` : ""}
                  </p>
                </li>
              ))}
              {recs.length === 0 && <li className="text-[12px] text-muted">Nothing proposed for this facility.</li>}
            </ol>
          </InsightCard>
        </div>
      </div>
    </div>
  );
}
