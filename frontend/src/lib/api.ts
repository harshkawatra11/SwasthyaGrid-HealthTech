import {
  facilities as mockFacilities,
  recommendations as mockRecommendations,
  alerts as mockAlerts,
  footfallForecast as mockFootfallForecast,
  footfallBreakdown as mockFootfallBreakdown,
  causalChain as mockCausalChain,
  districtKpis as mockDistrictKpis,
  type Facility,
  type Recommendation,
  type Alert,
} from "@/data/district";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

async function safeFetch<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${path} responded ${res.status}`);
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

function riskFromApi(level: string): Facility["riskLevel"] {
  if (level === "critical" || level === "stress" || level === "monitor" || level === "healthy") {
    return level;
  }
  return "healthy";
}

export async function getFacilities(): Promise<Facility[]> {
  const data = await safeFetch<{ facilities: Array<Record<string, unknown>> }>(
    "/api/v1/facilities",
    { facilities: [] }
  );
  if (!data.facilities.length) return mockFacilities;

  return data.facilities.map((f) => {
    const perf = (f.performance as Facility["performance"] | undefined) ?? undefined;
    const mockMatch = mockFacilities.find((m) => m.id === f.id);
    return {
      id: f.id as string,
      name: f.name as string,
      type: f.type as Facility["type"],
      lat: f.lat as number,
      lng: f.lng as number,
      riskLevel: riskFromApi(f.risk_level as string),
      performance: perf ?? mockMatch?.performance ?? {
        overall: 0,
        inventory: 0,
        attendance: 0,
        diagnostics: 0,
        patientWait: 0,
        forecastAccuracy: 0,
      },
    };
  });
}

export async function getPerformanceScores() {
  const data = await safeFetch<{ performance: Array<Record<string, unknown>> }>(
    "/api/v1/performance",
    { performance: [] }
  );
  if (!data.performance.length) {
    return mockFacilities.map((f) => ({
      facility_id: f.id,
      facility_name: f.name,
      overall: f.performance.overall,
      inventory: f.performance.inventory,
      attendance: f.performance.attendance,
      diagnostics: f.performance.diagnostics,
      patient_wait: f.performance.patientWait,
      forecast_accuracy: f.performance.forecastAccuracy,
    }));
  }
  return data.performance as Array<{
    facility_id: string;
    facility_name: string;
    overall: number;
    inventory: number;
    attendance: number;
    diagnostics: number;
    patient_wait: number;
    forecast_accuracy: number;
  }>;
}

export async function getRecommendations(): Promise<Recommendation[]> {
  const data = await safeFetch<{ recommendations: Array<Record<string, unknown>> }>(
    "/api/v1/recommendations",
    { recommendations: [] }
  );
  if (!data.recommendations.length) return mockRecommendations;
  return data.recommendations.map((r) => ({
    id: r.id as string,
    type: r.type as Recommendation["type"],
    sourceFacilityId: r.source_facility_id as string,
    targetFacilityId: r.target_facility_id as string,
    subject: r.subject as string,
    quantityOrDetail: r.quantity_or_detail as string,
    confidence: r.confidence as number,
    reasons: r.reasons as string[],
    status: r.status as Recommendation["status"],
  }));
}

export async function resolveRecommendation(
  id: string,
  action: "approve" | "reject" | "modify",
  quantityOverride?: string
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/recommendations/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity_override: quantityOverride ?? null }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getAlerts(): Promise<Alert[]> {
  const data = await safeFetch<{ alerts: Array<Record<string, unknown>> }>(
    "/api/v1/alerts",
    { alerts: [] }
  );
  if (!data.alerts.length) return mockAlerts;
  return data.alerts.map((a) => ({
    id: a.id as string,
    facilityId: a.facility_id as string,
    severity: a.severity as Alert["severity"],
    title: a.title as string,
    detail: (a.detail as string) ?? "",
  }));
}

export async function getFootfallForecast() {
  const data = await safeFetch<{
    series?: typeof mockFootfallForecast;
    tomorrow_breakdown?: Record<string, number>;
    confidence?: number;
    factors?: string[];
  }>("/api/v1/footfall/forecast", {});

  return {
    series: data.series?.length ? data.series : mockFootfallForecast,
    breakdown: data.tomorrow_breakdown
      ? Object.entries(data.tomorrow_breakdown).map(([label, value]) => ({
          label: label.charAt(0).toUpperCase() + label.slice(1),
          value,
        }))
      : mockFootfallBreakdown,
    confidence: data.confidence ?? 91,
    factors: data.factors ?? [
      "Seasonality",
      "Historical footfall trend",
      "Nearby disease cluster signals",
      "Weather forecast",
    ],
  };
}

export async function getCausalChain(facilityId: string) {
  return safeFetch(`/api/v1/analytics/causal-chain/${facilityId}`, mockCausalChain);
}

export async function getDistrictKpis() {
  const data = await safeFetch<{
    risk_counts?: Record<string, number>;
  }>("/api/v1/district", {});

  if (!data.risk_counts) return mockDistrictKpis;

  const criticalCount = data.risk_counts.critical ?? 0;
  return {
    ...mockDistrictKpis,
    todaysRisk: {
      value: `${criticalCount} Critical`,
      detail: mockDistrictKpis.todaysRisk.detail,
    },
  };
}

export interface FacilityDetail {
  id: string;
  name: string;
  type: string;
  risk_level: string;
  medicine_stock: Array<{
    medicine_name: string;
    units_remaining: number;
    days_remaining: number;
    risk: string;
    confidence: number;
    factors: string[];
  }>;
  bed_forecast: Record<string, unknown>;
  doctors: Array<Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
}

export async function getFacilityDetail(id: string): Promise<FacilityDetail | null> {
  const mock = mockFacilities.find((f) => f.id === id);
  const fallback: FacilityDetail | null = mock
    ? {
        id: mock.id,
        name: mock.name,
        type: mock.type,
        risk_level: mock.riskLevel,
        medicine_stock: [],
        bed_forecast: {},
        doctors: [],
        diagnostics: [],
      }
    : null;
  if (!fallback) return null;
  return safeFetch<FacilityDetail>(`/api/v1/facilities/${id}`, fallback);
}

export async function getMedicineForecast() {
  return safeFetch<{ medicines: Array<Record<string, unknown>> }>(
    "/api/v1/medicines",
    { medicines: [] }
  );
}

export async function getBedsForecast() {
  return safeFetch<{ beds: Array<Record<string, unknown>> }>("/api/v1/beds/forecast", {
    beds: [],
  });
}

export async function getDoctorAttendance() {
  return safeFetch<{ doctors: Array<Record<string, unknown>> }>(
    "/api/v1/doctors/attendance",
    { doctors: [] }
  );
}

export async function get<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API GET request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getDiagnostics() {
  return safeFetch<{ diagnostics: Array<Record<string, unknown>> }>(
    "/api/v1/diagnostics",
    { diagnostics: [] }
  );
}

export async function askSwasthyaGrid(message: string) {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.detail || `ask responded ${res.status}`);
  }
  return (await res.json()) as { answer: string; confidence?: number };
}

export { API_BASE };
