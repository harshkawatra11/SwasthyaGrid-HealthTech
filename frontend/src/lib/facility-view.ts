"use client";

import { useCallback, useMemo } from "react";
import { useFacilities, usePerformance } from "@/lib/api/hooks";
import { useEntityIndex } from "@/lib/entity-index";
import type { RiskLevel } from "@/lib/domain";

export type FacilityPerf = {
  overall: number;
  inventory: number;
  attendance: number;
  diagnostics: number;
  patientWait: number;
  forecastAccuracy: number;
};

/** Facility as the existing pages render it: API row plus its performance scorecard when known. */
export type FacilityView = {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  riskLevel: RiskLevel;
  districtId: string;
  performance: FacilityPerf | null;
};

export const RISK_WEIGHT: Record<RiskLevel, number> = { critical: 0, stress: 1, monitor: 2, healthy: 3 };

/** Facilities for a scope (`all` or a district id) with performance merged in, from the SWR hooks. */
export function useLiveFacilities(scope: string): { facilities: FacilityView[]; loading: boolean } {
  const fac = useFacilities(scope);
  const perf = usePerformance(scope);
  const rows = fac.data?.facilities;
  const perfRows = perf.data?.performance;

  const facilities = useMemo(() => {
    const byId = new Map((perfRows ?? []).map((p) => [p.facility_id, p]));
    return (rows ?? [])
      .filter((f) => scope === "all" || f.district_id === scope)
      .map<FacilityView>((f) => {
        const p = byId.get(f.id);
        return {
          id: f.id,
          name: f.name,
          type: f.type,
          lat: f.lat,
          lng: f.lng,
          riskLevel: f.risk_level,
          districtId: f.district_id,
          performance: p
            ? {
                overall: p.overall,
                inventory: p.inventory,
                attendance: p.attendance,
                diagnostics: p.diagnostics,
                patientWait: p.patient_wait,
                forecastAccuracy: p.forecast_accuracy,
              }
            : null,
        };
      });
  }, [rows, perfRows, scope]);

  return { facilities, loading: fac.isLoading || rows === undefined };
}

/** Predicate: does a facility id belong to `scope`? Used for lists whose rows carry no district id. */
export function useInScope(scope: string): (facilityId: string) => boolean {
  const { facilities } = useEntityIndex();
  const districtOf = useMemo(() => new Map(facilities.map((f) => [f.id, f.districtId])), [facilities]);
  return useCallback(
    (facilityId: string) => scope === "all" || (districtOf.get(facilityId) ?? scope) === scope,
    [districtOf, scope],
  );
}
