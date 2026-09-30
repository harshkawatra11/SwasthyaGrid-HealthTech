"use client";

import useSWR, { type KeyedMutator } from "swr";
import { ApiError, fetchJson, isNetworkError, scopeQuery, toQuery } from "./base";
import { filterByDistrict, fixtureNameFor, loadFixture } from "./fixtures";
import { reportApiStatus } from "@/lib/api-health";
import type {
  Alert,
  BedForecast,
  Briefing,
  ClockState,
  DiagnosticRow,
  District,
  DoctorAttendance,
  DriverDetail,
  DriverSummary,
  Facility,
  FacilityMatrix,
  FacilityProfile,
  FleetFilters,
  FootfallForecast,
  LogisticsKpis,
  MedicineForecast,
  MedicineMatrix,
  PerformanceRow,
  RecommendationFilters,
  RecommendationV2,
  ScheduleResponse,
  ScopeArg,
  ShipmentDetail,
  ShipmentFilters,
  ShipmentSummary,
  StateSummary,
  StatusBreakdown,
  VehicleDetail,
  VehicleSummary,
  VolumeSeries,
  WarehouseDetail,
  WarehouseSummary,
} from "./types";

/** Refresh cadence in ms (plan 9.1): 30 s analytics, 10 s changing lists, none for static. */
export const REFRESH = { analytics: 30_000, lists: 10_000, clock: 15_000, none: 0 } as const;

type Payload<T> = { data: T; offline: boolean };

export type ApiResult<T> = {
  /** undefined only while the first load is in flight. */
  data: T | undefined;
  /** True when the backend was unreachable and `data` comes from fixtures. */
  offline: boolean;
  isLoading: boolean;
  error: ApiError | undefined;
  mutate: KeyedMutator<Payload<T>>;
};

type Options = {
  refreshInterval?: number;
  /** District id used to filter the `all` fixture client side. */
  scope?: string;
};

/**
 * One SWR hook per resource. Network failures resolve to the fixture for the path (typed `empty`
 * when no fixture file exists) with `offline: true`; HTTP errors (404, 409, ...) surface as `error`.
 */
export function useApi<T>(path: string | null, empty: T, { refreshInterval = 0, scope }: Options = {}): ApiResult<T> {
  const { data, error, isLoading, mutate } = useSWR<Payload<T>, ApiError>(
    path,
    async (key: string) => {
      try {
        const body = await fetchJson<T>(key);
        reportApiStatus(key, false);
        return { data: body, offline: false };
      } catch (e) {
        if (!isNetworkError(e)) {
          reportApiStatus(key, false);
          throw e;
        }
        reportApiStatus(key, true);
        const fx = await loadFixture<T>(fixtureNameFor(key), empty);
        return { data: filterByDistrict(fx, scope), offline: true };
      }
    },
    { refreshInterval, errorRetryCount: 2 },
  );
  return { data: data?.data, offline: data?.offline ?? false, isLoading, error, mutate };
}

const P = "/api/v1";

/* ---------- static and analytics ---------- */

export function useDistricts() {
  return useApi<{ districts: District[] }>(`${P}/districts`, { districts: [] });
}

export function useStateSummary(scope: ScopeArg = "all") {
  return useApi<StateSummary | null>(`${P}/insights/state-summary${scopeQuery(scope)}`, null, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function useFacilityMatrix(scope: ScopeArg = "all") {
  return useApi<FacilityMatrix>(`${P}/insights/facility-matrix${scopeQuery(scope)}`, { dimensions: [], rows: [] }, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function useMedicineMatrix(scope: ScopeArg = "all") {
  return useApi<MedicineMatrix>(`${P}/insights/medicine-matrix${scopeQuery(scope)}`, { medicines: [], districts: [], cells: [] }, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function useBriefing(scope: ScopeArg = "all") {
  return useApi<Briefing | null>(`${P}/insights/briefing${scopeQuery(scope)}`, null, {
    refreshInterval: REFRESH.analytics,
  });
}

/* ---------- district data ---------- */

export function useFacilities(scope: ScopeArg = "all") {
  return useApi<{ facilities: Facility[] }>(`${P}/facilities${scopeQuery(scope)}`, { facilities: [] }, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function useFacilityProfile(id: string | null | undefined) {
  return useApi<FacilityProfile | null>(id ? `${P}/facilities/${id}/profile` : null, null, {
    refreshInterval: REFRESH.analytics,
  });
}

export function useMedicines(scope: ScopeArg = "all") {
  return useApi<{ medicines: MedicineForecast[] }>(`${P}/medicines${scopeQuery(scope)}`, { medicines: [] }, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function useFootfall(districtId?: string) {
  return useApi<FootfallForecast | null>(`${P}/footfall/forecast${scopeQuery(districtId)}`, null, {
    refreshInterval: REFRESH.analytics,
  });
}

export function useBeds(scope: ScopeArg = "all") {
  return useApi<{ beds: BedForecast[] }>(`${P}/beds/forecast${scopeQuery(scope)}`, { beds: [] }, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function useDoctors(scope: ScopeArg = "all") {
  return useApi<{ doctors: DoctorAttendance[] }>(`${P}/doctors/attendance${scopeQuery(scope)}`, { doctors: [] }, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function useDiagnostics(scope: ScopeArg = "all") {
  return useApi<{ diagnostics: DiagnosticRow[] }>(`${P}/diagnostics${scopeQuery(scope)}`, { diagnostics: [] }, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function useAlerts(scope: ScopeArg = "all") {
  return useApi<{ alerts: Alert[] }>(`${P}/alerts${scopeQuery(scope)}`, { alerts: [] }, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function usePerformance(scope: ScopeArg = "all") {
  return useApi<{ performance: PerformanceRow[] }>(`${P}/performance${scopeQuery(scope)}`, { performance: [] }, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function useRecommendations(filters: RecommendationFilters = {}) {
  return useApi<{ recommendations: RecommendationV2[] }>(
    `${P}/recommendations${toQuery({ ...filters })}`,
    { recommendations: [] },
    { refreshInterval: REFRESH.lists, scope: filters.district_id },
  );
}

/* ---------- logistics ---------- */

export function useLogisticsKpis(scope: ScopeArg = "all") {
  return useApi<LogisticsKpis>(`${P}/logistics/kpis${scopeQuery(scope)}`, {}, { refreshInterval: REFRESH.analytics });
}

export function useVolumeSeries(scope: ScopeArg = "all", days = 90) {
  return useApi<VolumeSeries>(`${P}/logistics/series/volume${scopeQuery(scope, { days })}`, { points: [] }, {
    refreshInterval: REFRESH.analytics,
  });
}

export function useStatusBreakdown(scope: ScopeArg = "all") {
  return useApi<StatusBreakdown>(`${P}/logistics/status-breakdown${scopeQuery(scope)}`, { date: "", counts: {} }, {
    refreshInterval: REFRESH.lists,
  });
}

export function useShipments(filters: ShipmentFilters = {}) {
  return useApi<{ items: ShipmentSummary[]; total: number }>(
    `${P}/logistics/shipments${toQuery({ ...filters })}`,
    { items: [], total: 0 },
    { refreshInterval: REFRESH.lists, scope: filters.district_id },
  );
}

export function useShipment(id: string | null | undefined) {
  return useApi<ShipmentDetail | null>(id ? `${P}/logistics/shipments/${id}` : null, null, {
    refreshInterval: REFRESH.lists,
  });
}

export function useVehicles(filters: FleetFilters = {}) {
  return useApi<{ items: VehicleSummary[] }>(`${P}/logistics/vehicles${toQuery({ ...filters })}`, { items: [] }, {
    refreshInterval: REFRESH.lists,
    scope: filters.district_id,
  });
}

export function useVehicle(id: string | null | undefined) {
  return useApi<VehicleDetail | null>(id ? `${P}/logistics/vehicles/${id}` : null, null, {
    refreshInterval: REFRESH.lists,
  });
}

export function useDrivers(filters: FleetFilters = {}) {
  return useApi<{ items: DriverSummary[] }>(`${P}/logistics/drivers${toQuery({ ...filters })}`, { items: [] }, {
    refreshInterval: REFRESH.lists,
    scope: filters.district_id,
  });
}

export function useDriver(id: string | null | undefined) {
  return useApi<DriverDetail | null>(id ? `${P}/logistics/drivers/${id}` : null, null, {
    refreshInterval: REFRESH.lists,
  });
}

export function useWarehouses(scope: ScopeArg = "all") {
  return useApi<{ items: WarehouseSummary[] }>(`${P}/logistics/warehouses${scopeQuery(scope)}`, { items: [] }, {
    refreshInterval: REFRESH.analytics,
    scope,
  });
}

export function useWarehouse(id: string | null | undefined) {
  return useApi<WarehouseDetail | null>(id ? `${P}/logistics/warehouses/${id}` : null, null, {
    refreshInterval: REFRESH.analytics,
  });
}

export function useSchedule(scope: ScopeArg = "all") {
  return useApi<ScheduleResponse | null>(`${P}/logistics/schedule${scopeQuery(scope)}`, null, {
    refreshInterval: REFRESH.analytics,
  });
}

export function useClock() {
  return useApi<ClockState | null>(`${P}/logistics/clock`, null, { refreshInterval: REFRESH.clock });
}

/** Causal chain for one facility (analytics page). Empty chain when the backend has none. */
export function useCausalChain(facilityId: string | null | undefined) {
  return useApi<{ headline: string; chain: string[] }>(
    facilityId ? `${P}/analytics/causal-chain/${facilityId}` : null,
    { headline: "", chain: [] },
    { refreshInterval: REFRESH.analytics },
  );
}
