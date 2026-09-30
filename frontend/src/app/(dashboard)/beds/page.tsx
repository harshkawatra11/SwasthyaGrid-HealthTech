"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ds/PageHeader";
import { KpiTile } from "@/components/ds/KpiTile";
import { useBeds, useRecommendations } from "@/lib/api/hooks";
import { useScope } from "@/lib/scope";
import { CapacityWaterfall, DistrictBedBars, OccupancyStrip, PressureList, RedirectList } from "@/components/operations/BedsPanels";
import { AssumptionRow, Callout, InsightCard, Moneyshot, PageSkeleton, ScenarioSwitch, useFacRefs } from "@/components/operations/kit";
import {
  DISTRICT_ORDER,
  bedsTitle,
  capacityWaterfall,
  enrichBeds,
  mean,
  scenarioOf,
  shortDistrict,
  weekUnder,
  type ScenarioId,
} from "@/components/operations/derive";

const SOURCE = "Source: SwasthyaGrid bed model, seed admissions. Occupancy = occupied beds / bed capacity";

export default function BedsPage() {
  const { scope } = useScope();
  const { data, isLoading } = useBeds(scope);
  const { refs } = useFacRefs(scope);
  const recsQ = useRecommendations({ type: "bed_redirect", status: "pending", district_id: scope === "all" ? undefined : scope });
  const [scenario, setScenario] = useState<ScenarioId>("realistic");
  const factor = scenarioOf(scenario).factor;

  const rows = useMemo(() => enrichBeds(data?.beds ?? [], refs).filter((r) => scope === "all" || r.districtId === scope), [data, refs, scope]);
  const recs = useMemo(
    () => (recsQ.data?.recommendations ?? []).filter((r) => r.type === "bed_redirect" && r.status === "pending"),
    [recsQ.data],
  );

  const s = useMemo(() => {
    const over90 = rows.filter((r) => weekUnder(r, factor) > 90);
    const over100 = rows.filter((r) => r.week * factor >= 100).length;
    const perDistrict = (fn: (rs: typeof rows) => number) => DISTRICT_ORDER.map((d) => fn(rows.filter((r) => r.districtId === d)));
    const w = capacityWaterfall(rows, factor);
    return {
      over90,
      over100,
      avgNow: mean(rows.map((r) => r.now)),
      avgWeek: mean(rows.map((r) => weekUnder(r, factor))),
      w,
      sparkOver: perDistrict((rs) => rs.filter((r) => weekUnder(r, factor) > 90).length),
      sparkNow: perDistrict((rs) => mean(rs.map((r) => r.now))),
      sparkWeek: perDistrict((rs) => mean(rs.map((r) => weekUnder(r, factor)))),
      worst: [...rows].sort((a, b) => weekUnder(b, factor) - weekUnder(a, factor))[0],
    };
  }, [rows, factor]);

  if (isLoading && rows.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Beds" title="Bed capacity board" />
        <PageSkeleton />
      </div>
    );
  }
  const scopeName = scope === "all" ? "Rajasthan" : shortDistrict(scope);

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Beds"
        title="Bed capacity board"
        description={`Occupancy now, tomorrow and next week for ${rows.length} facilities in ${scopeName}, worst first.`}
        actions={<ScenarioSwitch value={scenario} onChange={setScenario} label="Bed pressure scenario" />}
      />

      <div className="grid gap-3 xl:grid-cols-12">
        <InsightCard
          className="xl:col-span-5"
          eyebrow="Occupancy strip"
          title={bedsTitle(rows, factor)}
          source={SOURCE}
          section="Beds / Strip"
          actions={s.worst ? <Callout tone="critical">Worst: {s.worst.name}</Callout> : undefined}
        >
          <OccupancyStrip rows={rows} factor={factor} />
        </InsightCard>

        <div className="flex flex-col gap-3 xl:col-span-7">
          <div className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <Moneyshot
              value={s.over90.length}
              unit="facilities"
              label="Above 90% next week"
              note={`${s.over100} forecast at or over full capacity. System average moves from ${Math.round(s.avgNow)}% to ${Math.round(s.avgWeek)}%.`}
              href="#pressure"
            />
            <div className="grid grid-cols-2 gap-3">
              <KpiTile label="Beds tracked" value={s.w.total} sparkline={[]} hint={`${rows.length} facilities`} />
              <KpiTile label="Occupied now" value={s.w.occupied} sparkline={s.sparkNow} hint={`${Math.round(s.avgNow)}% average`} />
              <KpiTile label="Extra by next week" value={s.w.extra} tone="warning" sparkline={s.sparkWeek} hint="Predicted admissions" />
              <KpiTile label="Redirects pending" value={recs.length} tone={recs.length ? "warning" : "default"} sparkline={s.sparkOver} hint="Bed redirect recommendations" />
            </div>
          </div>

          <div id="pressure">
            <InsightCard
              eyebrow="Capacity and district pressure"
              title={`Beds fill by ${s.w.extra} by next week; ${s.over90.length} sites cross the 90% redirect trigger`}
              source={SOURCE}
              section="Beds / Capacity"
            >
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted">Capacity waterfall, beds</p>
                  <CapacityWaterfall rows={rows} factor={factor} />
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted">Average occupancy by district, %</p>
                  <DistrictBedBars rows={rows} factor={factor} />
                </div>
              </div>
              <AssumptionRow active={scenario} />
            </InsightCard>
          </div>

          <InsightCard
            eyebrow="Top 10 pressure list"
            title={s.worst ? `${s.worst.name} is the tightest site at ${weekUnder(s.worst, factor)}% next week` : "No pressure data"}
            source={SOURCE}
            section="Beds / Ranking"
          >
            <PressureList rows={rows} factor={factor} />
          </InsightCard>

          <InsightCard
            eyebrow="Redirect recommendations"
            title={recs.length ? `${recs.length} bed redirects are waiting for approval` : "No bed redirect is waiting"}
            source="Source: recommendation engine, redirect when next week occupancy exceeds 90%"
            section="Beds / Actions"
          >
            <RedirectList recs={recs} refs={refs} />
          </InsightCard>
        </div>
      </div>
    </div>
  );
}
