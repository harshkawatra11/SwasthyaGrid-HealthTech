"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Chip } from "@/components/ds/chip";
import type { DiagnosticRow } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { diagState, shortDistrict, statusLabel, type DiagState, type FacRef } from "./derive";

export const STATE_COLOR: Record<DiagState, string> = {
  available: "var(--risk-healthy)",
  degraded: "var(--risk-monitor)",
  down: "var(--risk-critical)",
  none: "var(--text-faint)",
};

const STATE_WORD: Record<DiagState, string> = { available: "OK", degraded: "Degraded", down: "Down", none: "n/r" };

function StatePill({ state, label, test }: { state: DiagState; label: string; test: string }) {
  const c = STATE_COLOR[state];
  return (
    <span
      title={`${test}: ${label}`}
      className={cn("inline-flex h-6 w-[48px] items-center justify-center rounded-[4px] text-[10px] font-semibold", state === "none" && "border border-dashed border-border-strong")}
      style={state === "none" ? { color: c } : { backgroundColor: `color-mix(in srgb, ${c} 22%, transparent)`, color: c, border: `1px solid color-mix(in srgb, ${c} 55%, transparent)` }}
    >
      {STATE_WORD[state]}
    </span>
  );
}

/** Hero: five district columns, one row per facility, one status pill per test. */
export function AvailabilityMatrix({ rows, refs, tests, districts }: { rows: DiagnosticRow[]; refs: Map<string, FacRef>; tests: string[]; districts: string[] }) {
  const byFacility = useMemo(() => {
    const m = new Map<string, Map<string, DiagnosticRow>>();
    for (const r of rows) {
      if (!m.has(r.facility_id)) m.set(r.facility_id, new Map());
      m.get(r.facility_id)!.set(r.test_name, r);
    }
    return m;
  }, [rows]);
  const facs = useMemo(() => [...refs.values()], [refs]);
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {districts.map((d) => {
          const list = facs.filter((f) => f.districtId === d).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
          const reported = rows.filter((r) => (refs.get(r.facility_id)?.districtId ?? r.district_id) === d);
          const okN = reported.filter((r) => diagState(r.status) === "available").length;
          return (
            <div key={d} className="min-w-0 rounded-md border border-border bg-surface-2">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
                <span className="truncate text-[12px] font-semibold text-text">{shortDistrict(d)}</span>
                <span className="num text-[11px]" style={{ color: reported.length && okN < reported.length ? "var(--risk-critical)" : "var(--text-muted)" }}>
                  {reported.length ? `${okN}/${reported.length} up` : "none reported"}
                </span>
              </div>
              <div className="grid items-center gap-x-1 gap-y-1 px-2 py-2" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${tests.length}, 48px)` }}>
                <div />
                {tests.map((t) => (
                  <div key={t} className="truncate text-center text-[10px] uppercase tracking-[0.06em] text-muted">
                    {t.replace(" Test", "")}
                  </div>
                ))}
                {list.map((f) => (
                  <div key={f.id} className="contents">
                    <Link href={`/facilities/${f.id}`} className="truncate text-[12px] text-text hover:text-brand" title={f.name}>
                      {f.name}
                    </Link>
                    {tests.map((t) => {
                      const r = byFacility.get(f.id)?.get(t);
                      const st = diagState(r?.status);
                      return <StatePill key={t} state={st} test={`${f.name}, ${t}`} label={r ? statusLabel(r.status) : "not reported"} />;
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted">
        {(["available", "degraded", "down", "none"] as DiagState[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: STATE_COLOR[s], opacity: s === "none" ? 0.4 : 1 }} />
            {s === "none" ? "Not reported (n/r)" : statusLabel(s === "available" ? "available" : s)}
          </span>
        ))}
      </div>
    </div>
  );
}

type AltRow = { key: string; facility: string; facilityId: string; test: string; status: string; state: DiagState; alt: string; altId: string | null; km: number | null };

/** Compact list, top right beside the matrix: one row per affected test, sorted by referral distance. */
export function AlternativeList({ rows, refs }: { rows: DiagnosticRow[]; refs: Map<string, FacRef> }) {
  const data: AltRow[] = rows
    .filter((r) => diagState(r.status) !== "available")
    .map((r) => ({
      key: `${r.facility_id}|${r.test_name}`,
      facility: r.facility_name ?? refs.get(r.facility_id)?.name ?? "Unnamed facility",
      facilityId: r.facility_id,
      test: r.test_name,
      status: r.status,
      state: diagState(r.status),
      alt: r.nearest_alternative_facility_id ? (refs.get(r.nearest_alternative_facility_id)?.name ?? "Unnamed facility") : "None in range",
      altId: r.nearest_alternative_facility_id ?? null,
      km: r.distance_km ?? null,
    }))
    .sort((a, b) => (b.km ?? -1) - (a.km ?? -1));

  if (data.length === 0) return <p className="px-1 py-6 text-center text-[12px] text-muted">No test is down.</p>;

  return (
    <ul className="max-h-[520px] space-y-1 overflow-y-auto">
      {data.map((r) => (
        <li key={r.key} className="flex items-start justify-between gap-2 rounded-sm px-1 py-1.5">
          <div className="min-w-0">
            <Link href={`/facilities/${r.facilityId}`} className="block truncate text-[12px] font-medium text-text hover:text-brand">
              {r.facility}
            </Link>
            <p className="truncate text-[11px] text-muted">
              {r.test} down, go to {r.altId ? (
                <Link href={`/facilities/${r.altId}`} className="hover:text-brand">
                  {r.alt}
                </Link>
              ) : (
                r.alt
              )}
              {r.km !== null && ` (${r.km} km)`}
            </p>
          </div>
          <Chip label={statusLabel(r.status)} color={STATE_COLOR[r.state]} size="sm" />
        </li>
      ))}
    </ul>
  );
}
