"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ds/PageHeader";
import { KpiTile } from "@/components/ds/KpiTile";
import { useMedicines } from "@/lib/api/hooks";
import { useScope } from "@/lib/scope";
import { InventoryHeatmap } from "@/components/operations/InventoryHeatmap";
import {
  ColdChainCard,
  EmergencyByDistrict,
  MedicineCoverCharts,
  StockTable,
  StockoutLadder,
  WarehouseCover,
} from "@/components/operations/InventoryPanels";
import { InsightCard, Moneyshot, PageSkeleton, ScenarioSwitch, AssumptionRow, Callout, useFacRefs } from "@/components/operations/kit";
import {
  DISTRICT_ORDER,
  LOW_DAYS,
  STOCKOUT_DAYS,
  coverUnder,
  countBelow,
  emergencyTitle,
  enrichMedicines,
  minCoverByFacility,
  scenarioOf,
  shortDistrict,
  shortMedicine,
  stockoutTitle,
  type ScenarioId,
} from "@/components/operations/derive";

const SOURCE = "Source: SwasthyaGrid seed data. Days of cover = units on hand / average daily use";

export default function InventoryPage() {
  const { scope } = useScope();
  const { data, isLoading } = useMedicines(scope);
  const { refs } = useFacRefs(scope);
  const [scenario, setScenario] = useState<ScenarioId>("realistic");
  const [facility, setFacility] = useState<string | null>(null);
  const factor = scenarioOf(scenario).factor;

  const rows = useMemo(() => enrichMedicines(data?.medicines ?? [], refs), [data, refs]);
  const facilities = useMemo(() => [...refs.values()].filter((f) => scope === "all" || f.districtId === scope), [refs, scope]);

  const stats = useMemo(() => {
    const out3 = rows.filter((r) => coverUnder(r.days, factor) < STOCKOUT_DAYS);
    const facilitiesAffected = new Set(out3.map((r) => r.facilityId)).size;
    const emergencyRisk = rows.filter((r) => r.emergency && coverUnder(r.days, factor) < LOW_DAYS).length;
    const cold = rows.filter((r) => r.coldChain && coverUnder(r.days, factor) < LOW_DAYS).length;
    const perDistrict = (fn: (rs: typeof rows) => number) =>
      DISTRICT_ORDER.map((d) => fn(rows.filter((r) => r.districtId === d)));
    const avg = rows.length ? rows.reduce((s, r) => s + coverUnder(r.days, factor), 0) / rows.length : 0;
    const worst = minCoverByFacility(rows.map((r) => ({ ...r, days: coverUnder(r.days, factor) })))[0];
    return {
      out3: out3.length,
      facilitiesAffected,
      under7: countBelow(rows, LOW_DAYS, factor),
      emergencyRisk,
      cold,
      avg,
      worst,
      sparkOut: perDistrict((rs) => countBelow(rs, STOCKOUT_DAYS, factor)),
      sparkLow: perDistrict((rs) => countBelow(rs, LOW_DAYS, factor)),
      sparkEm: perDistrict((rs) => rs.filter((r) => r.emergency && coverUnder(r.days, factor) < LOW_DAYS).length),
      sparkCold: perDistrict((rs) => rs.filter((r) => r.coldChain && coverUnder(r.days, factor) < LOW_DAYS).length),
      sparkAvg: perDistrict((rs) => (rs.length ? rs.reduce((s, r) => s + coverUnder(r.days, factor), 0) / rs.length : 0)),
    };
  }, [rows, factor]);

  if (isLoading && rows.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Inventory" title="Stock cover heatmap" />
        <PageSkeleton />
      </div>
    );
  }

  const scopeName = scope === "all" ? "Rajasthan" : shortDistrict(scope);
  const facCount = new Set(rows.map((r) => r.facilityId)).size;

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Inventory"
        title="Stock cover heatmap"
        description={`${facCount} facilities by ${new Set(rows.map((r) => r.medicine)).size} medicines in ${scopeName}. Every cell is days of cover.`}
        actions={<ScenarioSwitch value={scenario} onChange={setScenario} label="Demand scenario" />}
      />

      <div className="grid gap-3 xl:grid-cols-12">
        <Moneyshot
          className="xl:col-span-3"
          value={stats.out3}
          label="Stock-outs inside 3 days"
          note={
            stats.worst ? (
              <>
                Across {stats.facilitiesAffected} facilities. Tightest: {stats.worst.name}, {shortMedicine(stats.worst.medicine)}, {stats.worst.min.toFixed(1)} days.
              </>
            ) : (
              "No stock rows in this scope."
            )
          }
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:col-span-9">
          <KpiTile label="Under 7 days" value={stats.under7} sparkline={stats.sparkLow} tone="warning" hint="Items to reorder this week" />
          <KpiTile label="Emergency items at risk" value={stats.emergencyRisk} sparkline={stats.sparkEm} tone="critical" hint="Emergency medicines under 7 days" />
          <KpiTile label="Cold chain at risk" value={stats.cold} sparkline={stats.sparkCold} tone="warning" hint="Vaccines and oxytocin under 7 days" />
          <KpiTile label="Facilities affected" value={stats.facilitiesAffected} sparkline={stats.sparkOut} hint={`of ${facCount} with a stock-out`} />
          <KpiTile label="Mean cover" value={stats.avg.toFixed(1)} unit="days" sparkline={stats.sparkAvg} hint="Across every stock row" />
          <KpiTile label="Stock rows tracked" value={rows.length} hint={`${new Set(rows.map((r) => r.medicine)).size} medicines`} />
        </div>
      </div>

      <InsightCard
        eyebrow="Days of cover by facility and medicine"
        title={stockoutTitle(stats.out3, stats.facilitiesAffected, factor)}
        source={SOURCE}
        section="Inventory / Heatmap"
        actions={stats.worst ? <Callout tone="critical">Weakest: {stats.worst.name}</Callout> : undefined}
      >
        <InventoryHeatmap rows={rows} facilities={facilities} factor={factor} selectedFacility={facility} onSelectFacility={setFacility} />
        <AssumptionRow active={scenario} />
      </InsightCard>

      <div className="grid gap-3 xl:grid-cols-12">
        <InsightCard className="xl:col-span-4" eyebrow="Stock-out ladder" title="Twelve facilities closest to running out" source={SOURCE} section="Inventory / Ranking">
          <StockoutLadder rows={rows} factor={factor} />
        </InsightCard>
        <InsightCard className="xl:col-span-4" eyebrow="Emergency medicine cover" title={emergencyTitle(rows)} source="Source: seed data, weakest facility per district" section="Inventory / Emergency">
          <EmergencyByDistrict rows={rows} factor={factor} />
        </InsightCard>
        <InsightCard className="xl:col-span-4" eyebrow="Cold chain" title={`${stats.cold} cold chain items are inside a week of cover`} source="Source: medicine catalogue cold chain flag" section="Inventory / Cold chain">
          <ColdChainCard rows={rows} factor={factor} />
        </InsightCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <InsightCard className="xl:col-span-8" eyebrow="Cover by medicine" title="Averages hide the weakest facility: compare the two bars" source={SOURCE} section="Inventory / Medicines">
          <MedicineCoverCharts rows={rows} factor={factor} />
          <div className="mt-2">
            <Callout>The dashed line marks the 3 day stock-out threshold; a weakest bar left of it is a stock-out today.</Callout>
          </div>
        </InsightCard>
        <InsightCard className="xl:col-span-4" eyebrow="District warehouses" title="Warehouse cover and expiry flags" source="Source: logistics warehouse stock, simulated" section="Inventory / Supply">
          <WarehouseCover scope={scope} />
        </InsightCard>
      </div>

      <InsightCard eyebrow="All stock rows" title={`${rows.length} stock rows, sorted by weakest cover first`} source={SOURCE} section="Inventory / Table">
        <StockTable rows={rows} factor={factor} facilityFilter={facility} onClearFacility={() => setFacility(null)} />
      </InsightCard>
    </div>
  );
}
