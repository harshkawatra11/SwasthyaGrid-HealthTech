"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/ds/PageHeader";
import { KpiTile } from "@/components/ds/KpiTile";
import { useDiagnostics } from "@/lib/api/hooks";
import { useScope } from "@/lib/scope";
import { AlternativeList, AvailabilityMatrix } from "@/components/operations/DiagnosticsPanels";
import { Callout, InsightCard, Moneyshot, PageSkeleton, useFacRefs } from "@/components/operations/kit";
import { DISTRICT_ORDER, diagState, diagnosticsTitle, mean, shortDistrict } from "@/components/operations/derive";

const SOURCE = "Source: SwasthyaGrid diagnostics seed data. Facilities without a record are shown as not reported";

export default function DiagnosticsPage() {
  const { scope } = useScope();
  const { data, isLoading } = useDiagnostics(scope);
  const { refs } = useFacRefs(scope);

  const rows = useMemo(() => (data?.diagnostics ?? []).filter((r) => !!r.facility_id), [data]);
  const scopedRefs = useMemo(() => new Map([...refs].filter(([, f]) => scope === "all" || f.districtId === scope)), [refs, scope]);
  const tests = useMemo(() => [...new Set(rows.map((r) => r.test_name))].sort(), [rows]);
  const districts = DISTRICT_ORDER.filter((d) => scope === "all" || d === scope);

  const s = useMemo(() => {
    const down = rows.filter((r) => diagState(r.status) !== "available");
    const withAlt = down.filter((r) => r.nearest_alternative_facility_id);
    const per = (fn: (rs: typeof rows) => number) =>
      DISTRICT_ORDER.map((d) => fn(rows.filter((r) => (refs.get(r.facility_id)?.districtId ?? r.district_id) === d)));
    return {
      down,
      up: rows.length - down.length,
      withAlt: withAlt.length,
      avgKm: mean(withAlt.map((r) => r.distance_km ?? 0)),
      maxKm: Math.max(0, ...withAlt.map((r) => r.distance_km ?? 0)),
      reporting: new Set(rows.map((r) => r.facility_id)).size,
      sparkDown: per((rs) => rs.filter((r) => diagState(r.status) !== "available").length),
      sparkN: per((rs) => rs.length),
    };
  }, [rows, refs]);

  if (isLoading && rows.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Diagnostics" title="Test availability matrix" />
        <PageSkeleton />
      </div>
    );
  }
  const scopeName = scope === "all" ? "Rajasthan" : shortDistrict(scope);

  return (
    <div className="space-y-3">
      <PageHeader eyebrow="Diagnostics" title="Test availability matrix" description={`${scopedRefs.size} facilities in ${scopeName} against ${tests.length} tracked tests. ${s.reporting} facilities report a status.`} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Moneyshot value={s.down.length} unit={`of ${rows.length} tests`} label="Diagnostics down" note={`${s.withAlt} have a nearest alternative on record, ${s.avgKm.toFixed(1)} km away on average.`} />
        <KpiTile label="Available" value={s.up} tone="good" sparkline={s.sparkN} hint="Reported tests working" />
        <KpiTile label="Longest referral" value={s.maxKm} unit="km" tone="warning" sparkline={s.sparkDown} hint="Patients travel this far for the test" />
        <KpiTile label="Facilities reporting" value={s.reporting} sparkline={s.sparkN} hint={`of ${scopedRefs.size} in scope`} />
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-12">
        <InsightCard className="xl:col-span-8" eyebrow="Facilities by test" title={diagnosticsTitle(rows)} source={SOURCE} section="Diagnostics / Matrix" actions={s.down[0] ? <Callout tone="critical">{s.down[0].test_name} down in {shortDistrict(s.down[0].district_id)}</Callout> : undefined}>
          <AvailabilityMatrix rows={rows} refs={scopedRefs} tests={tests} districts={districts} />
        </InsightCard>
        <InsightCard className="xl:col-span-4" eyebrow="Nearest alternative" title={s.down.length ? `Patients are referred up to ${s.maxKm} km when a test is down` : "No referral needed"} source="Source: nearest facility with the test available, road distance estimate" section="Diagnostics / Referral">
          <AlternativeList rows={rows} refs={refs} />
        </InsightCard>
      </div>
    </div>
  );
}

