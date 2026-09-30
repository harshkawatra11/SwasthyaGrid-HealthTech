import type { DistrictSummaryRow, FacilityMatrix, MedicineMatrix, RiskLevel, StateSummary } from "@/lib/api/types";

/** Short district label: "Jaipur Rural District" -> "Jaipur Rural". */
export function shortName(name: string): string {
  return name.replace(/\s+District$/i, "");
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** District stock cover: median over medicines of the lowest days of cover among that district's facilities. */
export function districtCover(matrix: MedicineMatrix, districtId: string): number | null {
  const vals = matrix.cells
    .filter((c) => c.district_id === districtId && c.min_days_remaining !== null)
    .map((c) => c.min_days_remaining as number);
  return median(vals);
}

export type Shortage = { medicine: string; days: number; facilitiesBelow: number };

/** The medicine with the lowest cover in a district. */
export function topShortage(matrix: MedicineMatrix, districtId: string): Shortage | null {
  let best: Shortage | null = null;
  for (const c of matrix.cells) {
    if (c.district_id !== districtId || c.min_days_remaining === null) continue;
    if (!best || c.min_days_remaining < best.days) {
      best = { medicine: c.medicine_name, days: c.min_days_remaining, facilitiesBelow: c.facilities_below_threshold };
    }
  }
  return best;
}

/** "Anti-Rabies Vaccine (ARV)" -> "ARV"; "Paracetamol" unchanged. */
export function shortMedicine(name: string): string {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : name;
}

export type QuadrantPoint = {
  id: string;
  name: string;
  cover: number;
  pressure: number;
  footfall: number;
  danger: boolean;
};

export const COVER_LINE = 7;
export const PRESSURE_LINE = 75;

export function quadrantPoints(summary: StateSummary, matrix: MedicineMatrix): QuadrantPoint[] {
  const out: QuadrantPoint[] = [];
  for (const d of summary.districts) {
    const cover = districtCover(matrix, d.district_id);
    if (cover === null) continue;
    out.push({
      id: d.district_id,
      name: shortName(d.name),
      cover,
      pressure: d.bed_next_week_avg,
      footfall: d.footfall_tomorrow,
      danger: cover < COVER_LINE && d.bed_next_week_avg > PRESSURE_LINE,
    });
  }
  return out;
}

/* ---------- action titles (pure, unit tested) ---------- */

export function leagueTitle(rows: DistrictSummaryRow[]): string {
  if (rows.length < 2) return rows[0] ? `${shortName(rows[0].name)} has a risk index of ${rows[0].risk_index}` : "No district data yet";
  const s = [...rows].sort((a, b) => b.risk_index - a.risk_index);
  const hi = s[0];
  const lo = s[s.length - 1];
  return `${shortName(hi.name)} carries the highest risk index (${hi.risk_index}), ${hi.risk_index - lo.risk_index} points above ${shortName(lo.name)}`;
}

export function quadrantTitle(points: QuadrantPoint[]): string {
  const bad = points.filter((p) => p.danger);
  if (points.length === 0) return "Stock cover and bed pressure are not available yet";
  if (bad.length === 0) return "No district combines thin stock cover with high bed pressure";
  const names = bad.map((p) => p.name).join(" and ");
  return `${names} ${bad.length === 1 ? "combines" : "combine"} under ${COVER_LINE} days of cover with beds above ${PRESSURE_LINE}% next week`;
}

export function stockoutTitle(rows: DistrictSummaryRow[]): string {
  if (rows.length === 0) return "No stock-out data yet";
  const total = rows.reduce((a, r) => a + r.stockout_items, 0);
  const pending = rows.reduce((a, r) => a + r.pending_recommendations, 0);
  const worst = [...rows].sort((a, b) => b.pending_recommendations - a.pending_recommendations)[0];
  return `${total} stock-out items wait on ${pending} pending approvals, ${shortName(worst.name)} holds ${worst.pending_recommendations}`;
}

export function mixTitle(rows: DistrictSummaryRow[]): string {
  const crit = rows.reduce((a, r) => a + r.risk_counts.critical, 0);
  const total = rows.reduce((a, r) => a + r.facilities, 0);
  if (total === 0) return "No facility risk data yet";
  const worst = [...rows].sort((a, b) => b.risk_counts.critical - a.risk_counts.critical)[0];
  return `${crit} of ${total} facilities are critical, ${worst.risk_counts.critical} of them in ${shortName(worst.name)}`;
}

export function heatTitle(matrix: MedicineMatrix): string {
  const worst = matrix.cells
    .filter((c) => c.min_days_remaining !== null)
    .sort((a, b) => (a.min_days_remaining as number) - (b.min_days_remaining as number))[0];
  if (!worst) return "No medicine cover data yet";
  const d = matrix.districts.find((x) => x.id === worst.district_id);
  return `${shortMedicine(worst.medicine_name)} in ${shortName(d?.name ?? "")} is the tightest cell at ${worst.min_days_remaining} days`;
}

export function footfallTitle(peak: { name: string; day: string; value: number } | null): string {
  if (!peak) return "Footfall forecast is not available yet";
  return `${peak.name} peaks at ${peak.value} visits on ${peak.day}, the highest of the five districts this week`;
}

/* ---------- district detail ---------- */

export type FacilityRow = FacilityMatrix["rows"][number];

export function districtHeadline(rows: FacilityRow[], name: string): string {
  const crit = rows.filter((r) => r.risk_level === "critical").length;
  if (rows.length === 0) return `${name} has no facility data yet`;
  return `${crit} of ${rows.length} facilities in ${name} are critical`;
}

export function riskCountsOf(rows: Array<{ risk_level: RiskLevel }>): Record<RiskLevel, number> {
  const c: Record<RiskLevel, number> = { healthy: 0, monitor: 0, stress: 0, critical: 0 };
  for (const r of rows) c[r.risk_level] += 1;
  return c;
}

export type Scenario = "pessimistic" | "realistic" | "optimistic";

export const SCENARIOS: Record<Scenario, { label: string; factor: number; assumption: string }> = {
  pessimistic: { label: "Pessimistic", factor: 1.25, assumption: "Demand surge of 25% from rain and dengue signals" },
  realistic: { label: "Realistic", factor: 1, assumption: "Model forecast as published" },
  optimistic: { label: "Optimistic", factor: 0.9, assumption: "Demand 10% below forecast as the weather clears" },
};

export type FootfallPoint = { day: string; actual?: number; predicted?: number };

/** Scale only the forecast (days with no actual). */
export function applyScenario(series: FootfallPoint[], scenario: Scenario): FootfallPoint[] {
  const f = SCENARIOS[scenario].factor;
  return series.map((p) =>
    p.actual === undefined && p.predicted !== undefined ? { ...p, predicted: Math.round(p.predicted * f) } : p,
  );
}

export function peakDay(series: FootfallPoint[]): { day: string; value: number } | null {
  let best: { day: string; value: number } | null = null;
  for (const p of series) {
    const v = p.actual ?? p.predicted;
    if (v === undefined) continue;
    if (!best || v > best.value) best = { day: p.day, value: v };
  }
  return best;
}

/** Percent of `part` in `whole`, 0 when whole is 0. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
