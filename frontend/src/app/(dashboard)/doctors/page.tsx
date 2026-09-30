"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/ds/PageHeader";
import { KpiTile } from "@/components/ds/KpiTile";
import { useDoctors } from "@/lib/api/hooks";
import { useScope } from "@/lib/scope";
import { AbsenceRanking, AttendanceCalendar, DelayBars } from "@/components/operations/DoctorsPanels";
import { Callout, InsightCard, PageSkeleton, StatPill, useFacRefs } from "@/components/operations/kit";
import { DISTRICT_ORDER, WEEKDAYS, doctorsTitle, enrichDoctors, mean, shortDistrict } from "@/components/operations/derive";

const SOURCE = "Source: SwasthyaGrid attendance seed data. Absence likelihood is modelled from the recorded pattern";

export default function DoctorsPage() {
  const { scope } = useScope();
  const { data, isLoading } = useDoctors(scope);
  const { refs } = useFacRefs(scope);

  const rows = useMemo(() => enrichDoctors(data?.doctors ?? [], refs).filter((r) => scope === "all" || r.districtKey === scope), [data, refs, scope]);

  const s = useMemo(() => {
    const high = rows.filter((r) => r.risk_level === "high");
    const perDay = WEEKDAYS.map((_, i) => rows.filter((r) => r.week[i] > 0.4).length);
    const worstDay = perDay.indexOf(Math.max(...perDay));
    const per = (fn: (rs: typeof rows) => number) => DISTRICT_ORDER.map((d) => fn(rows.filter((r) => r.districtKey === d)));
    return {
      high,
      perDay,
      worstDay,
      avgDelay: mean(rows.map((r) => r.patient_delay_pct)),
      maxDelay: Math.max(0, ...rows.map((r) => r.patient_delay_pct)),
      sparkHigh: per((rs) => rs.filter((r) => r.risk_level === "high").length),
      sparkDelay: per((rs) => mean(rs.map((r) => r.patient_delay_pct))),
      sparkN: per((rs) => rs.length),
    };
  }, [rows]);

  if (isLoading && rows.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Doctors" title="Roster and attendance" />
        <PageSkeleton />
      </div>
    );
  }
  const scopeName = scope === "all" ? "Rajasthan" : shortDistrict(scope);

  return (
    <div className="space-y-3">
      <PageHeader eyebrow="Doctors" title="Roster and attendance" description={`Attendance risk for ${rows.length} monitored doctors in ${scopeName}, by weekday.`} />

      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-md border bg-surface-1 px-5 py-4" style={{ borderColor: "color-mix(in srgb, var(--risk-critical) 45%, var(--border))" }}>
        <div className="flex items-baseline gap-3">
          <span className="num text-[48px] font-semibold leading-none" style={{ color: "var(--risk-critical)" }}>
            {s.high.length}
          </span>
          <span className="text-[13px] leading-snug text-muted">
            <span className="eyebrow block">High absence risk</span>
            of {rows.length} doctors, worst weekday {WEEKDAYS[s.worstDay]} with {s.perDay[s.worstDay]} likely absent
          </span>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <StatPill label="Avg patient delay" value={`${Math.round(s.avgDelay)}%`} tone={s.avgDelay > 20 ? "warning" : undefined} />
          <StatPill label="Worst delay" value={`${s.maxDelay}%`} tone={s.maxDelay > 30 ? "critical" : undefined} />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <InsightCard className="xl:col-span-8" eyebrow="Attendance heat calendar" title={doctorsTitle(rows)} source={SOURCE} section="Doctors / Calendar" actions={s.high[0] ? <Callout tone="critical">Watch: {s.high[0].doctor_name}</Callout> : undefined}>
          <AttendanceCalendar rows={rows} />
        </InsightCard>
        <InsightCard className="xl:col-span-4" eyebrow="Absence risk ranking" title={s.high[0] ? `${s.high[0].doctor_name} at ${s.high[0].facilityLabel} ranks first` : "No doctor is ranked at risk"} source="Source: risk level, weekday pattern and patient delay combined (0 to 100)" section="Doctors / Ranking">
          <AbsenceRanking rows={rows} />
        </InsightCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <div className="grid grid-cols-2 gap-3 xl:col-span-4">
          <KpiTile label="Doctors monitored" value={rows.length} sparkline={s.sparkN} hint="With an attendance record" />
          <KpiTile label="High risk" value={s.high.length} tone="critical" sparkline={s.sparkHigh} hint="Repeated absences on one weekday" />
          <KpiTile label="Average patient delay" value={Math.round(s.avgDelay)} unit="%" tone="warning" sparkline={s.sparkDelay} hint="Patients waiting past slot" />
          <KpiTile label="Likely absent Monday" value={s.perDay[0]} sparkline={s.perDay} hint="Doctors over 40% likelihood" />
        </div>
        <InsightCard className="xl:col-span-8" eyebrow="Patient delay" title={`Patient waits reach ${s.maxDelay}% where absence risk is high`} source={SOURCE} section="Doctors / Delay">
          <DelayBars rows={rows} />
        </InsightCard>
      </div>
    </div>
  );
}
