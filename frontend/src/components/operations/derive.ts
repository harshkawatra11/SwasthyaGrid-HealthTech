/**
 * Pure derivations for the operations pages (inventory, footfall, beds, doctors, diagnostics).
 * Everything here is computed from the raw endpoints so the pages work with or without the insight
 * endpoints, and so card titles are computed findings rather than hard coded numbers.
 */
import type {
  BedForecast,
  DiagnosticRow,
  DoctorAttendance,
  Facility,
  FootfallForecast,
  MedicineForecast,
} from "@/lib/api/types";
import type { HeatScale } from "@/lib/heat";

/* ---------- names ---------- */

export const DISTRICT_SHORT: Record<string, string> = {
  district_jaipur_rural: "Jaipur Rural",
  district_alwar: "Alwar",
  district_bikaner: "Bikaner",
  district_udaipur: "Udaipur",
  district_kota: "Kota",
};

export const DISTRICT_ORDER = Object.keys(DISTRICT_SHORT);

export function shortDistrict(id: string | undefined): string {
  return (id && DISTRICT_SHORT[id]) || "Unknown district";
}

/** Short medicine label for narrow columns. */
export function shortMedicine(name: string): string {
  const m = name.match(/\(([^)]+)\)/);
  return m ? m[1] : name;
}

/** Medicine properties that older payloads do not carry (matches backend/data/medicine_catalog.json). */
export const MEDICINE_META: Record<string, { emergency: boolean; cold_chain: boolean; unit: string }> = {
  Paracetamol: { emergency: false, cold_chain: false, unit: "strip" },
  ORS: { emergency: false, cold_chain: false, unit: "sachet" },
  "Anti-Snake Venom (ASV)": { emergency: true, cold_chain: false, unit: "vial" },
  "Anti-Rabies Vaccine (ARV)": { emergency: true, cold_chain: true, unit: "vial" },
  Oxytocin: { emergency: true, cold_chain: true, unit: "ampoule" },
  "Tetanus Toxoid (TT)": { emergency: true, cold_chain: true, unit: "dose" },
  "Adrenaline (Epinephrine)": { emergency: true, cold_chain: false, unit: "ampoule" },
};

export type FacRef = { id: string; name: string; districtId: string; type: string; beds: number; risk: string };

export function facilityRefs(facilities: Facility[] | undefined): Map<string, FacRef> {
  const map = new Map<string, FacRef>();
  for (const f of facilities ?? []) {
    map.set(f.id, { id: f.id, name: f.name, districtId: f.district_id, type: f.type, beds: f.beds_total, risk: f.risk_level });
  }
  return map;
}

/* ---------- scenarios (client side, from the series) ---------- */

export type ScenarioId = "pessimistic" | "realistic" | "optimistic";

export type Scenario = { id: ScenarioId; label: string; factor: number; assumption: string };

export const DEMAND_SCENARIOS: Scenario[] = [
  { id: "pessimistic", label: "Pessimistic", factor: 1.25, assumption: "Demand surge of 25% (heat and monsoon fever cases)" },
  { id: "realistic", label: "Realistic", factor: 1, assumption: "Baseline demand, model forecast unchanged" },
  { id: "optimistic", label: "Optimistic", factor: 0.9, assumption: "Demand eases by 10% (outreach and referrals work)" },
];

export function scenarioOf(id: ScenarioId): Scenario {
  return DEMAND_SCENARIOS.find((s) => s.id === id) ?? DEMAND_SCENARIOS[1];
}

/* ---------- inventory ---------- */

export type StockRow = {
  key: string;
  facilityId: string;
  facilityName: string;
  districtId: string;
  medicine: string;
  units: number;
  days: number;
  emergency: boolean;
  coldChain: boolean;
  unit: string;
  confidence: number;
};

export function enrichMedicines(rows: MedicineForecast[], facs: Map<string, FacRef>): StockRow[] {
  return rows.map((r) => {
    const f = facs.get(r.facility_id);
    const meta = MEDICINE_META[r.medicine_name];
    return {
      key: `${r.facility_id}|${r.medicine_name}`,
      facilityId: r.facility_id,
      facilityName: r.facility_name ?? f?.name ?? "Unnamed facility",
      districtId: r.district_id ?? f?.districtId ?? "",
      medicine: r.medicine_name,
      units: r.units_remaining,
      days: r.days_remaining,
      emergency: r.emergency ?? meta?.emergency ?? false,
      coldChain: r.cold_chain ?? meta?.cold_chain ?? false,
      unit: r.unit ?? meta?.unit ?? "unit",
      confidence: r.confidence,
    };
  });
}

/** Days of cover under a demand factor: higher demand shortens cover. */
export function coverUnder(days: number, factor: number): number {
  return factor > 0 ? days / factor : days;
}

export const STOCKOUT_DAYS = 3;
export const LOW_DAYS = 7;

export function countBelow(rows: StockRow[], limit: number, factor = 1): number {
  return rows.filter((r) => coverUnder(r.days, factor) < limit).length;
}

export const COVER_SCALE: HeatScale = { thresholds: [21, 14, 7, 3], higherIsWorse: false };

export function minCoverByFacility(rows: StockRow[]): Array<{ facilityId: string; name: string; districtId: string; min: number; medicine: string; below3: number }> {
  const map = new Map<string, { facilityId: string; name: string; districtId: string; min: number; medicine: string; below3: number }>();
  for (const r of rows) {
    const cur = map.get(r.facilityId);
    if (!cur) {
      map.set(r.facilityId, { facilityId: r.facilityId, name: r.facilityName, districtId: r.districtId, min: r.days, medicine: r.medicine, below3: r.days < STOCKOUT_DAYS ? 1 : 0 });
    } else {
      if (r.days < cur.min) {
        cur.min = r.days;
        cur.medicine = r.medicine;
      }
      if (r.days < STOCKOUT_DAYS) cur.below3 += 1;
    }
  }
  return [...map.values()].sort((a, b) => a.min - b.min);
}

/** Minimum days of cover for a (medicine, district) cell, or null when the district holds none. */
export function medicineDistrictMin(rows: StockRow[], medicine: string, districtId: string): number | null {
  let min: number | null = null;
  for (const r of rows) {
    if (r.medicine !== medicine || r.districtId !== districtId) continue;
    if (min === null || r.days < min) min = r.days;
  }
  return min;
}

export function medicineStats(rows: StockRow[]): Array<{ medicine: string; emergency: boolean; coldChain: boolean; avg: number; min: number; worstFacility: string; below3: number; below7: number; n: number }> {
  const names = [...new Set(rows.map((r) => r.medicine))];
  return names.map((m) => {
    const rs = rows.filter((r) => r.medicine === m);
    const worst = rs.reduce((a, b) => (b.days < a.days ? b : a), rs[0]);
    return {
      medicine: m,
      emergency: rs[0].emergency,
      coldChain: rs[0].coldChain,
      avg: rs.reduce((s, r) => s + r.days, 0) / rs.length,
      min: worst.days,
      worstFacility: worst.facilityName,
      below3: rs.filter((r) => r.days < STOCKOUT_DAYS).length,
      below7: rs.filter((r) => r.days < LOW_DAYS).length,
      n: rs.length,
    };
  });
}

export function stockoutTitle(count: number, facilities: number, factor: number): string {
  if (count === 0) return "No facility item is inside 3 days of cover";
  return `${count} stock-out${count === 1 ? "" : "s"} inside 3 days across ${facilities} facilit${facilities === 1 ? "y" : "ies"}${factor > 1 ? " if demand surges 25%" : ""}`;
}

export function emergencyTitle(rows: StockRow[]): string {
  const em = rows.filter((r) => r.emergency && r.days < 7);
  if (em.length === 0) return "Emergency medicines hold at least 7 days everywhere";
  const byMed = new Map<string, number>();
  for (const r of em) byMed.set(r.medicine, (byMed.get(r.medicine) ?? 0) + 1);
  const [name, n] = [...byMed.entries()].sort((a, b) => b[1] - a[1])[0];
  const dist = new Map<string, number>();
  for (const r of em.filter((x) => x.medicine === name)) dist.set(r.districtId, (dist.get(r.districtId) ?? 0) + 1);
  const worstD = [...dist.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return `${shortDistrict(worstD)} leads ${n} facilities under 7 days of ${shortMedicine(name)}`;
}

/* ---------- footfall ---------- */

export type FootfallPoint = { day: string; actual: number | null; predicted: number | null };

export function footfallPoints(f: FootfallForecast | null | undefined): FootfallPoint[] {
  return (f?.series ?? []).map((s) => ({
    day: String(s.day ?? ""),
    actual: typeof s.actual === "number" ? s.actual : null,
    predicted: typeof s.predicted === "number" ? s.predicted : null,
  }));
}

export type FanPoint = { day: string; actual: number | null; predicted: number | null; lo: number | null; band: number | null; hi: number | null };

/** Fan chart rows: the band widens with the horizon, its base width follows (100 - confidence)%. */
export function fanSeries(points: FootfallPoint[], confidence: number, factor: number): FanPoint[] {
  const firstForecast = points.findIndex((p) => p.actual === null);
  const spread = Math.max(0.04, (100 - confidence) / 100);
  return points.map((p, i) => {
    const isFuture = firstForecast >= 0 && i >= firstForecast;
    const base = p.predicted;
    const predicted = base === null ? null : Math.round(isFuture ? base * factor : base);
    const horizon = isFuture ? i - firstForecast + 1 : 0;
    const half = predicted === null ? 0 : predicted * spread * (0.6 + 0.35 * horizon) * (isFuture ? 1 : 0.5);
    const lo = predicted === null ? null : Math.max(0, Math.round(predicted - half));
    const hi = predicted === null ? null : Math.round(predicted + half);
    return { day: p.day, actual: p.actual, predicted, lo, band: lo === null || hi === null ? null : hi - lo, hi };
  });
}

export function forecastStart(points: FootfallPoint[]): number {
  const i = points.findIndex((p) => p.actual === null);
  return i < 0 ? points.length : i;
}

export function footfallTotal(points: FootfallPoint[], from: number, factor = 1): number {
  return Math.round(points.slice(from).reduce((s, p) => s + (p.predicted ?? 0), 0) * factor);
}

export function peakDay(points: FootfallPoint[], from: number): FootfallPoint | null {
  const fut = points.slice(from).filter((p) => p.predicted !== null);
  if (fut.length === 0) return null;
  return fut.reduce((a, b) => ((b.predicted ?? 0) > (a.predicted ?? 0) ? b : a));
}

export function footfallTitle(name: string, points: FootfallPoint[], peer: number | null): string {
  const from = forecastStart(points);
  const peak = peakDay(points, from);
  if (!peak) return `${name} has no forecast yet`;
  const vs = peer && peer > 0 ? `, ${Math.round(((peak.predicted ?? 0) / peer - 1) * 100)}% ${(peak.predicted ?? 0) >= peer ? "above" : "below"} the state day average` : "";
  return `${name} peaks on ${peak.day} at ${peak.predicted} visits${vs}`;
}

/** Deterministic stand-in used only when the backend is offline and every district would repeat one fixture. */
export function deriveFootfall(base: FootfallForecast, districtId: string, facilityCount: number): FootfallForecast {
  if (base.district_id === districtId) return base;
  const idx = Math.max(0, DISTRICT_ORDER.indexOf(districtId));
  const scale = 0.75 + 0.06 * idx + facilityCount * 0.004;
  const wobble = (i: number) => 1 + 0.03 * Math.sin(i * 1.7 + idx);
  return {
    ...base,
    district_id: districtId,
    series: base.series.map((s, i) => ({
      ...s,
      actual: typeof s.actual === "number" ? Math.round(s.actual * scale * wobble(i)) : s.actual,
      predicted: typeof s.predicted === "number" ? Math.round(s.predicted * scale * wobble(i)) : s.predicted,
    })),
    tomorrow_breakdown: Object.fromEntries(Object.entries(base.tomorrow_breakdown).map(([k, v]) => [k, Math.round(v * scale)])),
  };
}

export const FOOTFALL_SCALE: HeatScale = { thresholds: [140, 170, 200, 230], higherIsWorse: true };

/* ---------- beds ---------- */

export type BedRow = {
  facilityId: string;
  name: string;
  districtId: string;
  total: number;
  occupied: number;
  now: number;
  tomorrow: number;
  week: number;
  confidence: number;
  factors: string[];
};

export const BED_SCALE: HeatScale = { thresholds: [60, 75, 85, 95], higherIsWorse: true };

export function enrichBeds(rows: BedForecast[], facs: Map<string, FacRef>): BedRow[] {
  const out: BedRow[] = [];
  for (const b of rows) {
    if (!b.facility_id) continue;
    const f = facs.get(b.facility_id);
    const total = f?.beds ?? (b.occupied && b.occupancy_pct ? Math.round((b.occupied / b.occupancy_pct) * 100) : 0);
    out.push({
      facilityId: b.facility_id,
      name: f?.name ?? "Unnamed facility",
      districtId: f?.districtId ?? "",
      total,
      occupied: b.occupied ?? Math.round((total * (b.occupancy_pct ?? 0)) / 100),
      now: b.occupancy_pct ?? 0,
      tomorrow: b.predicted_tomorrow_pct ?? b.occupancy_pct ?? 0,
      week: b.predicted_next_week_pct ?? b.occupancy_pct ?? 0,
      confidence: b.confidence ?? 0,
      factors: b.factors ?? [],
    });
  }
  return out;
}

/** Scenario pressure: next-week occupancy scaled by the demand factor, capped at 100. */
export function weekUnder(r: BedRow, factor: number): number {
  return Math.min(100, Math.round(r.week * factor));
}

export type Waterfall = { total: number; occupied: number; extra: number; free: number; overflow: number };

export function capacityWaterfall(rows: BedRow[], factor: number): Waterfall {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const occupied = rows.reduce((s, r) => s + r.occupied, 0);
  const projected = rows.reduce((s, r) => s + Math.min(r.total, (r.total * weekUnder(r, factor)) / 100), 0);
  const overflow = rows.reduce((s, r) => s + Math.max(0, (r.total * r.week * factor) / 100 - r.total), 0);
  const extra = Math.max(0, Math.round(projected - occupied));
  return { total, occupied, extra, free: Math.max(0, Math.round(total - occupied - extra)), overflow: Math.round(overflow) };
}

export function bedsTitle(rows: BedRow[], factor: number): string {
  const over = rows.filter((r) => weekUnder(r, factor) > 90);
  if (over.length === 0) return "No facility is forecast above 90% occupancy next week";
  const worst = over.reduce((a, b) => (weekUnder(b, factor) > weekUnder(a, factor) ? b : a));
  return `${over.length} facilit${over.length === 1 ? "y" : "ies"} pass 90% next week, worst is ${worst.name} at ${weekUnder(worst, factor)}%`;
}

/* ---------- doctors ---------- */

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const FULL_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/**
 * Absence likelihood (0 to 1) by weekday. Base rate follows the risk level; a weekday named in the
 * recorded absence pattern is raised to a high likelihood. This is a model output, not a roster.
 */
export function absenceByWeekday(d: DoctorAttendance): number[] {
  const base = d.risk_level === "high" ? 0.22 : d.risk_level === "medium" ? 0.12 : 0.04;
  const pattern = (d.absence_pattern ?? "").toLowerCase();
  return FULL_DAYS.map((day, i) => {
    const named = pattern.includes(day) || pattern.includes(day.slice(0, 3) + "day") ? 1 : 0;
    const wobble = ((i * 7 + d.doctor_name.length) % 5) * 0.01;
    return Math.min(0.95, named ? (d.risk_level === "high" ? 0.86 : 0.6) : base + wobble);
  });
}

export const ABSENCE_SCALE: HeatScale = { thresholds: [0.08, 0.2, 0.4, 0.7], higherIsWorse: true };

export type DoctorRow = DoctorAttendance & { facilityLabel: string; districtKey: string; score: number; week: number[] };

export function enrichDoctors(rows: DoctorAttendance[], facs: Map<string, FacRef>): DoctorRow[] {
  return rows.map((d) => {
    const f = facs.get(d.facility_id);
    const week = absenceByWeekday(d);
    const risk = d.risk_level === "high" ? 60 : d.risk_level === "medium" ? 30 : 5;
    return {
      ...d,
      facilityLabel: d.facility_name ?? f?.name ?? "Unnamed facility",
      districtKey: d.district_id ?? f?.districtId ?? "",
      week,
      score: Math.min(100, Math.round(risk + d.patient_delay_pct * 0.6 + Math.max(...week) * 10)),
    };
  });
}

export function doctorsTitle(rows: DoctorRow[]): string {
  const high = rows.filter((r) => r.risk_level === "high");
  if (high.length === 0) return "No doctor is flagged as a high absence risk";
  const days = new Map<number, number>();
  for (const r of high) {
    const m = Math.max(...r.week);
    days.set(r.week.indexOf(m), (days.get(r.week.indexOf(m)) ?? 0) + 1);
  }
  const [dayIdx, n] = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
  return `${high.length} of ${rows.length} doctors are high absence risk, ${n} of them cluster on ${WEEKDAYS[dayIdx]}`;
}

/* ---------- diagnostics ---------- */

export type DiagState = "available" | "degraded" | "down" | "none";

export function diagState(status: string | undefined): DiagState {
  if (!status) return "none";
  if (status === "available") return "available";
  if (/degrad|slow|partial|calib/i.test(status)) return "degraded";
  return "down";
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function diagnosticsTitle(rows: DiagnosticRow[]): string {
  const down = rows.filter((r) => diagState(r.status) !== "available");
  if (down.length === 0) return "Every reported diagnostic is available";
  const byTest = new Map<string, number>();
  for (const r of down) byTest.set(r.test_name, (byTest.get(r.test_name) ?? 0) + 1);
  const [t, n] = [...byTest.entries()].sort((a, b) => b[1] - a[1])[0];
  return `${down.length} of ${rows.length} reported tests are down, ${n} of them ${t}`;
}

/* ---------- generic ---------- */

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

export function histogram(values: number[], edges: number[]): Array<{ label: string; from: number; to: number; count: number }> {
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i];
    const to = edges[i + 1];
    const last = i === edges.length - 2;
    out.push({
      label: `${from}-${to}`,
      from,
      to,
      count: values.filter((v) => v >= from && (last ? v <= to : v < to)).length,
    });
  }
  return out;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
