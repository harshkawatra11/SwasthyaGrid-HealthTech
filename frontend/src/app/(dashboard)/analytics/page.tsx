"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ds/PageHeader";
import { RiskChip } from "@/components/ds/RiskChip";
import { useAlerts, useBeds, useDiagnostics, useDoctors, useMedicines, usePerformance } from "@/lib/api/hooks";
import { useLiveEvents } from "@/lib/live/LiveProvider";
import { useEntityIndex } from "@/lib/entity-index";
import { useScope } from "@/lib/scope";
import type { RiskLevel } from "@/lib/domain";
import {
  ConfidenceHistogram,
  CausalFlow,
  CorrelationMultiples,
  EventsList,
  FacilityPicker,
  ScorecardTable,
  alertsToFeed,
  liveToFeed,
  useCausalChain,
  type Evidence,
} from "@/components/analytics/AnalyticsPanels";
import { KpiTree, type TreeBranch } from "@/components/analytics/KpiTree";
import { Callout, InsightCard, Moneyshot, PageSkeleton, useFacRefs } from "@/components/operations/kit";
import { diagState, enrichMedicines, mean, shortDistrict, shortMedicine } from "@/components/operations/derive";

const SOURCE = "Source: SwasthyaGrid performance scores, seed data. Scores 0 to 100, higher is better";

export default function AnalyticsPage() {
  const { scope } = useScope();
  const perfQ = usePerformance(scope);
  const medQ = useMedicines(scope);
  const bedQ = useBeds(scope);
  const docQ = useDoctors(scope);
  const diagQ = useDiagnostics(scope);
  const alertQ = useAlerts(scope);
  const { refs } = useFacRefs(scope);
  const index = useEntityIndex();
  const live = useLiveEvents();
  const [pick, setPick] = useState<string | null>(null);

  const perf = useMemo(() => (perfQ.data?.performance ?? []).filter((r) => !!r.facility_id), [perfQ.data]);
  const risk = useMemo(() => new Map<string, RiskLevel>([...refs].map(([id, f]) => [id, f.risk as RiskLevel])), [refs]);
  const stock = useMemo(() => enrichMedicines(medQ.data?.medicines ?? [], refs), [medQ.data, refs]);

  const defaultId = useMemo(() => {
    const order: Record<RiskLevel, number> = { critical: 0, stress: 1, monitor: 2, healthy: 3 };
    return [...perf].sort((a, b) => order[risk.get(a.facility_id) ?? "healthy"] - order[risk.get(b.facility_id) ?? "healthy"] || a.overall - b.overall)[0]?.facility_id ?? null;
  }, [perf, risk]);
  const selected = pick && perf.some((p) => p.facility_id === pick) ? pick : defaultId;
  const row = perf.find((p) => p.facility_id === selected) ?? null;
  const chainQ = useCausalChain(selected);

  const facts = useMemo(() => {
    if (!selected) return null;
    const meds = stock.filter((m) => m.facilityId === selected).sort((a, b) => a.days - b.days);
    const bed = (bedQ.data?.beds ?? []).find((b) => b.facility_id === selected);
    const docs = (docQ.data?.doctors ?? []).filter((d) => d.facility_id === selected);
    const diags = (diagQ.data?.diagnostics ?? []).filter((d) => d.facility_id === selected);
    return {
      weakest: meds[0],
      under3: meds.filter((m) => m.days < 3).length,
      bedNow: bed?.occupancy_pct ?? null,
      bedWeek: bed?.predicted_next_week_pct ?? null,
      docsHigh: docs.filter((d) => d.risk_level === "high").length,
      docsN: docs.length,
      delay: docs.length ? Math.max(...docs.map((d) => d.patient_delay_pct)) : null,
      down: diags.filter((d) => diagState(d.status) !== "available"),
      diagN: diags.length,
    };
  }, [selected, stock, bedQ.data, docQ.data, diagQ.data]);

  const avg = useMemo(
    () => ({
      overall: mean(perf.map((p) => p.overall)),
      inventory: mean(perf.map((p) => p.inventory)),
      attendance: mean(perf.map((p) => p.attendance)),
      diagnostics: mean(perf.map((p) => p.diagnostics)),
    }),
    [perf],
  );

  const evidence: Evidence[] = useMemo(() => {
    if (!facts) return [];
    const out: Evidence[] = [];
    if (facts.weakest) out.push({ label: `${shortMedicine(facts.weakest.medicine)} cover`, value: `${facts.weakest.days.toFixed(1)} d`, tone: facts.weakest.days < 3 ? "critical" : facts.weakest.days < 7 ? "warning" : "good" });
    if (facts.bedWeek !== null) out.push({ label: "Beds next week", value: `${facts.bedWeek}%`, tone: facts.bedWeek > 90 ? "critical" : facts.bedWeek > 75 ? "warning" : "good" });
    out.push({ label: "High-risk doctors", value: `${facts.docsHigh}`, tone: facts.docsHigh ? "critical" : "good" });
    out.push({ label: "Tests down", value: `${facts.down.length}`, tone: facts.down.length ? "critical" : "good" });
    return out;
  }, [facts]);

  const branches: TreeBranch[] = useMemo(() => {
    if (!row || !facts) return [];
    return [
      {
        id: "stock",
        label: "Stock",
        score: row.inventory,
        state: `state avg ${avg.inventory.toFixed(0)}`,
        leaves: [
          { label: "Weakest item", value: facts.weakest ? `${shortMedicine(facts.weakest.medicine)} ${facts.weakest.days.toFixed(1)} d` : "n/a" },
          { label: "Items under 3 days", value: String(facts.under3) },
        ],
      },
      {
        id: "beds",
        label: "Beds",
        score: facts.bedWeek === null ? null : Math.max(0, 100 - facts.bedWeek),
        unit: " headroom",
        state: facts.bedWeek === null ? null : `${facts.bedWeek}% full next week`,
        leaves: [
          { label: "Occupancy now", value: facts.bedNow === null ? "n/a" : `${facts.bedNow}%` },
          { label: "Occupancy next week", value: facts.bedWeek === null ? "n/a" : `${facts.bedWeek}%` },
        ],
      },
      {
        id: "staff",
        label: "Staffing",
        score: row.attendance,
        state: `state avg ${avg.attendance.toFixed(0)}`,
        leaves: [
          { label: "High-risk doctors", value: facts.docsN ? `${facts.docsHigh} of ${facts.docsN}` : "none monitored" },
          { label: "Patient wait score", value: String(row.patient_wait) },
        ],
      },
      {
        id: "diag",
        label: "Diagnostics",
        score: row.diagnostics,
        state: `state avg ${avg.diagnostics.toFixed(0)}`,
        leaves: [
          { label: "Tests down", value: facts.diagN ? `${facts.down.length} of ${facts.diagN}` : "none reported" },
          { label: "Forecast accuracy", value: `${row.forecast_accuracy}` },
        ],
      },
    ];
  }, [row, facts, avg]);

  const feed = useMemo(() => {
    const nm = (id: string) => index.facilityName(id);
    const events = liveToFeed(live, nm).reverse().slice(0, 20);
    return events.length ? { items: events, live: true } : { items: alertsToFeed(alertQ.data?.alerts ?? []).slice(0, 20), live: false };
  }, [live, index, alertQ.data]);

  const confidence = useMemo(
    () => [
      { name: "Medicine cover", values: (medQ.data?.medicines ?? []).map((m) => m.confidence).filter((v) => typeof v === "number"), color: "var(--series-1)" },
      { name: "Bed occupancy", values: (bedQ.data?.beds ?? []).map((b) => b.confidence ?? 0).filter((v) => v > 0), color: "var(--series-2)" },
    ],
    [medQ.data, bedQ.data],
  );

  const allConf = confidence.flatMap((g) => g.values);
  const share80 = allConf.length ? Math.round((allConf.filter((v) => v >= 80).length / allConf.length) * 100) : 0;

  if (perfQ.isLoading && perf.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Analytics" title="Analyst workbench" />
        <PageSkeleton />
      </div>
    );
  }

  const worst = [...perf].sort((a, b) => a.overall - b.overall)[0];
  const chain = chainQ.data?.chain ?? (facts?.weakest ? ["Demand rises in the district", `${shortMedicine(facts.weakest.medicine)} stock draws down`, "Days of cover fall"] : ["No causal signal available"]);
  const headline = chainQ.data?.headline ?? "Derived from the facility's live stock, beds and staffing signals";
  const facName = row?.facility_name ?? "facility";
  const level = selected ? risk.get(selected) : undefined;

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Analytics"
        title="Analyst workbench"
        description={`Why a facility scores what it does: causes, components and peers across ${perf.length} facilities in ${scope === "all" ? "Rajasthan" : shortDistrict(scope)}.`}
      />

      <div className="grid gap-3 xl:grid-cols-12">
        <aside className="flex flex-col gap-3 xl:col-span-3">
          <Moneyshot
            tone="warning"
            value={avg.overall.toFixed(0)}
            unit="/ 100"
            label="Mean performance score"
            note={worst ? `Lowest: ${worst.facility_name} at ${worst.overall}. The gap to the mean is ${(avg.overall - worst.overall).toFixed(0)} points.` : "No scores available."}
          />
          <InsightCard eyebrow="Facility" title="Pick a facility to explain" source="Sorted by risk level, then score" section="Analytics / Selector">
            <FacilityPicker rows={perf} risk={risk} selected={selected} onSelect={setPick} />
          </InsightCard>
        </aside>

        <div className="flex min-w-0 flex-col gap-3 xl:col-span-9">
          <InsightCard
            eyebrow="Causal chain explorer"
            title={row ? `${facName}: ${chain[0]} sets off the chain that ends in its ${level ?? "current"} rating` : "Select a facility"}
            source="Source: SwasthyaGrid causal model, district signals joined with the facility's live metrics"
            section="Analytics / Causal chain"
            actions={level ? <RiskChip level={level} size="sm" /> : undefined}
          >
            <CausalFlow chain={chain} headline={headline} evidence={evidence} facilityName={facName} />
          </InsightCard>

          <InsightCard
            eyebrow="KPI tree"
            title={row ? `${facName} scores ${row.overall}, ${row.overall < avg.overall ? "below" : "above"} the state mean of ${avg.overall.toFixed(0)}` : "KPI tree"}
            source={SOURCE}
            section="Analytics / KPI tree"
            actions={<Callout>Node edge colour follows the score band</Callout>}
          >
            {row && branches.length > 0 ? (
              <KpiTree root={{ label: "Performance score", score: row.overall, sub: `state mean ${avg.overall.toFixed(0)}` }} branches={branches} />
            ) : (
              <p className="text-[12px] text-muted">No score for this facility.</p>
            )}
          </InsightCard>
        </div>
      </div>

      <InsightCard
        eyebrow="Performance scorecard"
        title={worst ? `${worst.facility_name} is last on the scorecard; sort any column to find the weak spot` : "Scorecard"}
        source={SOURCE}
        section="Analytics / Scorecard"
      >
        <ScorecardTable rows={perf} risk={risk} onSelect={setPick} />
      </InsightCard>

      <div className="grid gap-3 xl:grid-cols-12">
        <InsightCard className="xl:col-span-4" eyebrow="Forecast confidence" title={`${share80}% of forecasts carry at least 80% model confidence`} source="Source: confidence field of medicine and bed forecasts" section="Analytics / Confidence">
          <ConfidenceHistogram groups={confidence} />
        </InsightCard>
        <InsightCard className="xl:col-span-4" eyebrow="What moves the score" title="Which component tracks the overall score" source={SOURCE} section="Analytics / Correlation">
          <CorrelationMultiples rows={perf} selected={selected} />
        </InsightCard>
        <InsightCard className="xl:col-span-4" eyebrow="Events" title={feed.live ? "Last 20 live events" : "Latest alerts while the stream is quiet"} source="Source: SwasthyaGrid live stream and alerts" section="Analytics / Events">
          <EventsList items={feed.items} live={feed.live} />
        </InsightCard>
      </div>
    </div>
  );
}
