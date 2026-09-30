/**
 * Pure functions that compute the action titles and derived numbers of the Command Centre.
 * Every title is built from live data (never a hard coded number) and is unit tested.
 */
import { heatBin, type HeatScale } from "@/lib/heat";
import type {
  Briefing,
  DistrictSummaryRow,
  FacilityMatrix,
  FootfallForecast,
  LogisticsKpis,
  MedicineMatrix,
  RecommendationV2,
  ShipmentSummary,
  StateSummary,
  VolumeSeries,
} from "@/lib/api/types";
import type { ShipmentEvent } from "@/lib/api/types";

export const RISK_SCALE: HeatScale = { thresholds: [20, 35, 50, 65], higherIsWorse: true };
export const COVER_SCALE: HeatScale = { thresholds: [21, 14, 7, 3], higherIsWorse: false };

export function shortDistrict(name: string): string {
  return name.replace(/ District$/, "");
}

/** "Anti-Rabies Vaccine (ARV)" gives "ARV"; "Adrenaline (Epinephrine)" gives "Adrenaline"; plain names stay. */
export function shortMedicine(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return name;
  return /^[A-Z]{2,5}$/.test(m[2]) ? m[2] : m[1];
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "n/a";
  return `${(v * 100).toFixed(digits)}%`;
}

export function districtLabel(summary: StateSummary, id: string): string {
  const d = summary.districts.find((x) => x.district_id === id);
  return d ? shortDistrict(d.name) : id;
}

/* ---------- situation banner (three lines) ---------- */

export type SituationLine = { tone: "risk" | "supply" | "action"; text: string };

export function situationLines(
  summary: StateSummary,
  kpis: LogisticsKpis,
  pending: RecommendationV2[],
): SituationLine[] {
  const t = summary.totals;
  const scopeName = summary.scope === "all" ? "Rajasthan" : districtLabel(summary, summary.scope);
  const worst = [...summary.districts].sort((a, b) => b.risk_index - a.risk_index)[0];
  const riskLine =
    `${scopeName}: ${t.risk_counts.critical} of ${t.facilities} facilities are critical and ${t.risk_counts.stress} under stress` +
    (worst && summary.scope === "all" ? `; ${shortDistrict(worst.name)} has the highest risk index (${worst.risk_index}).` : ".");
  const delayed = kpis.delayed_now ?? 0;
  const supplyLine =
    `${plural(t.shipments_in_transit, "shipment")} in transit, ${delayed} delayed; ` +
    `on-time rate over 7 days is ${pct(t.on_time_rate_7d)}.`;
  const crit = pending.filter((r) => r.priority === "critical");
  const top = crit[0] ?? pending[0];
  const actionLine = top
    ? `Next action: approve ${crit.length > 0 ? plural(crit.length, "critical recommendation") : plural(pending.length, "recommendation")}, starting with ${top.subject} for the facility at the top of the queue.`
    : "Next action: no recommendation is waiting for approval.";
  return [
    { tone: "risk", text: riskLine },
    { tone: "supply", text: supplyLine },
    { tone: "action", text: actionLine },
  ];
}

/* ---------- executive block (What is working / What needs action) ---------- */

export function executiveBlock(
  summary: StateSummary,
  kpis: LogisticsKpis,
  shipments: ShipmentSummary[],
): { working: string[]; action: string[] } {
  const t = summary.totals;
  const working: string[] = [];
  const action: string[] = [];
  const healthyPct = t.facilities > 0 ? Math.round((t.risk_counts.healthy / t.facilities) * 100) : 0;
  working.push(`${t.risk_counts.healthy} of ${t.facilities} facilities are healthy (${healthyPct}%).`);
  const delivered = shipments.filter((s) => s.status === "arrived" || s.status === "delivered");
  const prevented = delivered.filter((s) => s.priority === "critical").length;
  if (delivered.length > 0) working.push(`${plural(delivered.length, "shipment")} reached a facility, ${prevented} of them critical priority.`);
  if ((kpis.on_time_rate_today ?? 0) >= 0.9) working.push(`On-time rate today is ${pct(kpis.on_time_rate_today)}.`);
  const dry = summary.districts.filter((d) => d.stockout_items === 0);
  if (dry.length > 0) working.push(`${dry.map((d) => shortDistrict(d.name)).join(", ")} report no stock-out items.`);
  action.push(`${t.risk_counts.critical} facilities are critical and ${t.stockout_items} stock lines have under 3 days of cover.`);
  const delayed = kpis.delayed_now ?? 0;
  if (delayed > 0) action.push(`${plural(delayed, "shipment")} running late; 7 day on-time rate is ${pct(t.on_time_rate_7d)}.`);
  if (t.pending_recommendations > 0) action.push(`${plural(t.pending_recommendations, "recommendation")} waiting for approval.`);
  if (t.bed_next_week_avg > 75) action.push(`Bed occupancy is forecast at ${t.bed_next_week_avg.toFixed(0)}% next week.`);
  return { working: working.slice(0, 4), action: action.slice(0, 4) };
}

/* ---------- card titles ---------- */

export function mapTitle(summary: StateSummary): string {
  if (summary.districts.length === 0) return "No district data";
  const worst = [...summary.districts].sort((a, b) => b.risk_index - a.risk_index)[0];
  const t = summary.totals;
  return `${shortDistrict(worst.name)} leads on risk (index ${worst.risk_index}); ${t.risk_counts.critical} of ${t.facilities} facilities critical`;
}

export function leagueTitle(rows: DistrictSummaryRow[]): string {
  if (rows.length === 0) return "No district data";
  const sorted = [...rows].sort((a, b) => b.risk_index - a.risk_index);
  const spread = sorted[0].risk_index - sorted[sorted.length - 1].risk_index;
  return `Risk index spans ${spread} points, from ${shortDistrict(sorted[sorted.length - 1].name)} to ${shortDistrict(sorted[0].name)}`;
}

/** Number of dimensions in the two worst heat bins for one matrix row. */
export function breachCount(values: Record<string, number | null>, dims: FacilityMatrix["dimensions"]): number {
  return dims.filter((d) => {
    const bin = heatBin(values[d.id] ?? null, {
      thresholds: d.thresholds as [number, number, number, number],
      higherIsWorse: d.higher_is_worse,
    });
    return bin !== null && bin >= 3;
  }).length;
}

export function facilityMatrixTitle(m: FacilityMatrix): string {
  if (m.rows.length === 0) return "No facility data";
  const scored = m.rows.map((r) => ({ r, n: breachCount(r.values, m.dimensions) }));
  const multi = scored.filter((s) => s.n >= 2);
  const worst = [...scored].sort((a, b) => b.n - a.n)[0];
  if (multi.length === 0) return `No facility breaches two or more dimensions across ${m.rows.length} facilities`;
  return `${plural(multi.length, "facility", "facilities")} ${multi.length === 1 ? "breaches" : "breach"} two or more dimensions; ${worst.r.facility_name} breaches ${worst.n}`;
}

export type MedicineHotspot = { districtId: string; medicine: string; facilities: number; minDays: number };

export function medicineHotspot(m: MedicineMatrix): MedicineHotspot | null {
  const emergency = new Set(m.medicines.filter((x) => x.emergency).map((x) => x.name));
  const cells = m.cells.filter((c) => emergency.has(c.medicine_name) && c.facilities_below_threshold > 0);
  if (cells.length === 0) return null;
  const best = [...cells].sort(
    (a, b) => b.facilities_below_threshold - a.facilities_below_threshold || (a.min_days_remaining ?? 99) - (b.min_days_remaining ?? 99),
  )[0];
  return {
    districtId: best.district_id,
    medicine: best.medicine_name,
    facilities: best.facilities_below_threshold,
    minDays: best.min_days_remaining ?? 0,
  };
}

export function medicineTitle(m: MedicineMatrix): string {
  const h = medicineHotspot(m);
  if (!h) return "No emergency medicine is under 3 days of cover";
  const d = m.districts.find((x) => x.id === h.districtId);
  return `${d ? shortDistrict(d.name) : h.districtId} has ${plural(h.facilities, "facility", "facilities")} under 3 days of ${shortMedicine(h.medicine)}`;
}

export function riskMixTitle(rows: DistrictSummaryRow[]): string {
  if (rows.length === 0) return "No district data";
  const worst = [...rows].sort((a, b) => b.risk_counts.critical - a.risk_counts.critical)[0];
  const total = rows.reduce((s, r) => s + r.risk_counts.critical, 0);
  return `${worst.risk_counts.critical} of ${total} critical facilities sit in ${shortDistrict(worst.name)}`;
}

export type FootfallScenario = "pessimistic" | "realistic" | "optimistic";

export const SCENARIOS: Record<FootfallScenario, { label: string; factor: number; assumption: string }> = {
  pessimistic: { label: "Pessimistic", factor: 1.25, assumption: "Demand surge of +25% (outbreak or rain-driven fever cases)" },
  realistic: { label: "Realistic", factor: 1, assumption: "Baseline model forecast" },
  optimistic: { label: "Optimistic", factor: 0.9, assumption: "Demand eases by 10% (weather clears)" },
};

export type FootfallRow = { day: string; [district: string]: string | number | null };

/** Predicted footfall of each district by day, scaled by a scenario. Actuals are not projected. */
export function footfallRows(
  byDistrict: Array<{ id: string; forecast: FootfallForecast | null }>,
  scenario: FootfallScenario,
): FootfallRow[] {
  const days = byDistrict.find((d) => d.forecast)?.forecast?.series.map((s) => String(s.day)) ?? [];
  const f = SCENARIOS[scenario].factor;
  return days.map((day, i) => {
    const row: FootfallRow = { day };
    for (const d of byDistrict) {
      const point = d.forecast?.series[i];
      const p = point?.predicted;
      const isFuture = point !== undefined && typeof point.actual !== "number";
      row[d.id] = typeof p === "number" ? Math.round(p * (isFuture ? f : 1)) : null;
    }
    return row;
  });
}

export function footfallPeak(rows: FootfallRow[], ids: string[]): { day: string; id: string; value: number } | null {
  let best: { day: string; id: string; value: number } | null = null;
  for (const r of rows) {
    for (const id of ids) {
      const v = r[id];
      if (typeof v === "number" && (!best || v > best.value)) best = { day: r.day, id, value: v };
    }
  }
  return best;
}

export function footfallTitle(rows: FootfallRow[], ids: string[], names: Record<string, string>): string {
  const peak = footfallPeak(rows, ids);
  if (!peak) return "No footfall forecast available";
  return `${names[peak.id] ?? peak.id} peaks at ${peak.value} visits on ${peak.day}, the busiest day of the week`;
}

export function volumeTitle(v: VolumeSeries): string {
  const pts = v.points.filter((p) => p.avg_transit_hours !== null);
  if (pts.length < 14) return "Not enough shipment history";
  const last7 = pts.slice(-7);
  const prev7 = pts.slice(-14, -7);
  const avg = (a: typeof pts) => a.reduce((s, p) => s + p.shipments, 0) / a.length;
  const a = avg(last7);
  const b = avg(prev7);
  const change = b > 0 ? Math.round(((a - b) / b) * 100) : 0;
  const dir = change === 0 ? "flat" : change > 0 ? `up ${change}%` : `down ${Math.abs(change)}%`;
  return `Shipment volume is ${dir} on the previous week, at ${a.toFixed(1)} a day`;
}

export function peakVolumeDay(v: VolumeSeries): { date: string; shipments: number } | null {
  if (v.points.length === 0) return null;
  const best = [...v.points].sort((a, b) => b.shipments - a.shipments)[0];
  return { date: best.date, shipments: best.shipments };
}

export function watchlistTitle(top: StateSummary["top_risks"]): string {
  if (top.length === 0) return "No facility is under 3 days of cover";
  const uncovered = top.filter((r) => r.inbound_shipment_id === null).length;
  return `${plural(top.length, "facility", "facilities")} on the watchlist, ${uncovered} with no shipment on the way`;
}

export function approvalsTitle(pending: RecommendationV2[]): string {
  if (pending.length === 0) return "No recommendation is waiting for approval";
  const crit = pending.filter((r) => r.priority === "critical").length;
  return `${plural(pending.length, "decision")} waiting, ${crit} critical`;
}

export function exceptionsTitle(delayed: number, blocked: number, breaches: number): string {
  const total = delayed + blocked + breaches;
  if (total === 0) return "No supply exception right now";
  return `${plural(total, "exception")}: ${delayed} delayed, ${blocked} blocked, ${breaches} cold chain`;
}

/* ---------- KPI helpers ---------- */

export type KpiSeries = { values: number[]; caption: string };

export function districtSeries(rows: DistrictSummaryRow[], pick: (d: DistrictSummaryRow) => number): number[] {
  return rows.map(pick);
}

export function lastDays(v: VolumeSeries, n: number, pick: (p: VolumeSeries["points"][number]) => number | null): number[] {
  return v.points
    .slice(-n)
    .map(pick)
    .filter((x): x is number => x !== null);
}

/* ---------- impact panel ---------- */

export type Impact = {
  prevented: number;
  unitsDelivered: number;
  avgHoursToDelivery: number | null;
  onTimeRate: number | null;
  coldChainCompliance: number | null;
};

/** Leading integers of "ARV 120 vials, TT 80 vials" style summaries, summed. */
export function unitsInSummary(s: string): number {
  return (s.match(/\d+/g) ?? []).reduce((a, n) => a + Number(n), 0);
}

export function impact(shipments: ShipmentSummary[], kpis: LogisticsKpis): Impact {
  const done = shipments.filter((s) => s.status === "arrived" || s.status === "delivered");
  const crit = done.filter((s) => s.priority === "critical");
  const hours = done
    .filter((s) => s.eta)
    .map((s) => (new Date(s.eta as string).getTime() - new Date(s.created_at).getTime()) / 3_600_000);
  const cold = kpis.cold_chain_active ?? 0;
  const breaches = kpis.cold_chain_breaches_today ?? 0;
  const coldDone = done.filter((s) => s.cold_chain).length;
  return {
    prevented: crit.length,
    unitsDelivered: crit.reduce((a, s) => a + unitsInSummary(s.lines_summary), 0),
    avgHoursToDelivery: hours.length > 0 ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    onTimeRate: kpis.on_time_rate_7d ?? null,
    coldChainCompliance: cold + coldDone > 0 ? Math.max(0, 1 - breaches / (cold + coldDone)) : 1,
  };
}

/* ---------- timeline ---------- */

export type TimelineKind = "created" | "departed" | "arrived" | "delayed" | "risk" | "cold" | "approved" | "other";

export type TimelineItem = { key: string; at: string; kind: TimelineKind; title: string; detail: string; href?: string };

export function kindOfEvent(type: string): TimelineKind {
  if (type === "created") return "created";
  if (type === "approved" || type === "vehicle_assigned") return "approved";
  if (type === "departed" || type === "departed_pickup" || type === "loading_started") return "departed";
  if (type === "arrived" || type === "pod_confirmed") return "arrived";
  if (type === "incident_started") return "delayed";
  if (type.startsWith("cold_chain")) return "cold";
  return "other";
}

export function timelineFromShipmentEvents(events: ShipmentEvent[]): TimelineItem[] {
  return events.map((e) => ({
    key: `${e.shipment_id}-${e.type}-${e.at}`,
    at: e.at,
    kind: kindOfEvent(e.type),
    title: e.title,
    detail: e.detail,
    href: `/supply/shipments/${e.shipment_id}`,
  }));
}

/** Events derived from the shipment list, used when the live stream has produced nothing yet. */
export function timelineFromShipments(shipments: ShipmentSummary[], simNow: string): TimelineItem[] {
  const now = new Date(simNow).getTime();
  const out: TimelineItem[] = [];
  for (const s of shipments) {
    const dest = s.destination.name;
    if (new Date(s.created_at).getTime() <= now) {
      out.push({ key: `${s.id}-c`, at: s.created_at, kind: "created", title: `Shipment ${s.id} created`, detail: `${s.lines_summary} for ${dest}`, href: `/supply/shipments/${s.id}` });
    }
    if (s.planned_start && new Date(s.planned_start).getTime() <= now && s.status !== "recommended" && s.status !== "approved") {
      out.push({ key: `${s.id}-d`, at: s.planned_start, kind: "departed", title: `${s.id} left ${s.origin.name}`, detail: `Heading to ${dest}`, href: `/supply/shipments/${s.id}` });
    }
    if (s.status === "arrived" || s.status === "delivered") {
      out.push({ key: `${s.id}-a`, at: s.eta ?? s.created_at, kind: "arrived", title: `${s.id} arrived at ${dest}`, detail: s.lines_summary, href: `/supply/shipments/${s.id}` });
    }
    if (s.status === "delayed") {
      out.push({ key: `${s.id}-x`, at: s.planned_arrival ?? s.created_at, kind: "delayed", title: `${s.id} delayed ${s.delay_minutes} min`, detail: `To ${dest}`, href: `/supply/shipments/${s.id}` });
    }
  }
  return out;
}

export function lastEvents(items: TimelineItem[], limit = 20): TimelineItem[] {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
    .slice(0, limit);
}

/* ---------- briefing ---------- */

export function briefingLabel(b: Briefing | null | undefined): string {
  if (!b) return "AI briefing";
  return b.model === "template" ? "Automatic summary" : "AI briefing";
}

/* ---------- moneyshot ---------- */

export function moneyshot(summary: StateSummary): { value: string; line: string } {
  const t = summary.totals;
  const worst = [...summary.districts].sort((a, b) => b.risk_counts.critical - a.risk_counts.critical)[0];
  return {
    value: `${t.risk_counts.critical} of ${t.facilities}`,
    line:
      `facilities are critical` +
      (worst && summary.scope === "all" && worst.risk_counts.critical > 0
        ? `, most of them in ${shortDistrict(worst.name)} (${worst.risk_counts.critical})`
        : ""),
  };
}

/* ---------- risk index decomposition (plan 6.2 formula) ---------- */

export const DRIVER_KEYS = ["critical", "stress", "stockouts", "beds", "doctors"] as const;
export type DriverKey = (typeof DRIVER_KEYS)[number];
export const DRIVER_LABEL: Record<DriverKey, string> = {
  critical: "Critical share",
  stress: "Stress share",
  stockouts: "Stock-outs",
  beds: "Bed pressure",
  doctors: "Absence risk",
};

/** Points each input contributes to the (uncapped) risk index. */
export function indexDrivers(d: DistrictSummaryRow): Record<DriverKey, number> {
  const n = d.facilities || 1;
  return {
    critical: 0.4 * ((d.risk_counts.critical / n) * 100),
    stress: 0.2 * ((d.risk_counts.stress / n) * 100),
    stockouts: 2 * Math.min(d.stockout_items, 10),
    beds: 0.33 * Math.max(0, d.bed_next_week_avg - 70),
    doctors: d.doctors_high_risk > 0 ? 10 : 0,
  };
}

export function topDriver(d: DistrictSummaryRow): DriverKey {
  const v = indexDrivers(d);
  return [...DRIVER_KEYS].sort((a, b) => v[b] - v[a])[0];
}

/* ---------- facility matrix helpers ---------- */

export type BinCounts = { id: string; label: string; bins: [number, number, number, number, number]; empty: number };

export function dimensionBins(m: FacilityMatrix): BinCounts[] {
  return m.dimensions.map((d) => {
    const bins: BinCounts["bins"] = [0, 0, 0, 0, 0];
    let empty = 0;
    for (const r of m.rows) {
      const b = heatBin(r.values[d.id] ?? null, {
        thresholds: d.thresholds as [number, number, number, number],
        higherIsWorse: d.higher_is_worse,
      });
      if (b === null) empty += 1;
      else bins[b] += 1;
    }
    return { id: d.id, label: d.label, bins, empty };
  });
}

export function dimensionBinsTitle(bins: BinCounts[]): string {
  if (bins.length === 0) return "No facility data";
  const worst = [...bins].sort((a, b) => b.bins[3] + b.bins[4] - (a.bins[3] + a.bins[4]))[0];
  const n = worst.bins[3] + worst.bins[4];
  return `${worst.label} is the weakest dimension: ${plural(n, "facility", "facilities")} in the two worst bands`;
}

export function rankByBreaches(m: FacilityMatrix): Array<{ id: string; name: string; districtId: string; breaches: number; level: string }> {
  return m.rows
    .map((r) => ({ id: r.facility_id, name: r.facility_name, districtId: r.district_id, breaches: breachCount(r.values, m.dimensions), level: r.risk_level }))
    .sort((a, b) => b.breaches - a.breaches || a.name.localeCompare(b.name));
}

export const DIM_SHORT: Record<string, string> = {
  inventory: "Cover d",
  beds: "Beds wk",
  staffing: "Absence",
  diagnostics: "Diag",
  performance: "Score",
  supply: "Inbound",
};

export function formatDim(id: string, v: number): string {
  switch (id) {
    case "inventory":
      return v.toFixed(1);
    case "beds":
      return `${Math.round(v)}%`;
    case "staffing":
      return v >= 1 ? "high" : v > 0 ? v.toFixed(1) : "ok";
    case "diagnostics":
      return String(Math.round(v));
    case "performance":
      return String(Math.round(v));
    case "supply":
      return `${v.toFixed(1)}h`;
    default:
      return String(v);
  }
}

/** Mean heat band (0 best to 4 worst) per dimension over rows that have a value. */
export function meanBands(m: FacilityMatrix): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of m.dimensions) {
    const scale = { thresholds: d.thresholds as [number, number, number, number], higherIsWorse: d.higher_is_worse };
    const bands = m.rows.map((r) => heatBin(r.values[d.id] ?? null, scale)).filter((b): b is number => b !== null);
    out[d.id] = bands.length ? bands.reduce((a, b) => a + b, 0) / bands.length : 0;
  }
  return out;
}
