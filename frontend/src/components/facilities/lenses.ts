import type { FacilityMatrix, RiskLevel } from "@/lib/api/types";
import { heatColor, type HeatScale } from "@/lib/heat";
import { riskVar } from "@/lib/domain";

export type Lens = "risk" | "stock" | "beds" | "staffing" | "performance";
export const LENSES: Lens[] = ["risk", "stock", "beds", "staffing", "performance"];

export type FacilityRow = FacilityMatrix["rows"][number];

export const RISK_ORDER: Record<RiskLevel, number> = { healthy: 0, monitor: 1, stress: 2, critical: 3 };

type LensDef = {
  label: string;
  /** Column header for the lens metric. */
  metric: string;
  /** Numeric value used for ranking, null when missing. */
  value: (r: FacilityRow) => number | null;
  /** True when a larger value is worse (ranking puts it first). */
  higherIsWorse: boolean;
  scale?: HeatScale;
  format: (v: number) => string;
  max: number;
};

export const LENS_DEFS: Record<Lens, LensDef> = {
  risk: {
    label: "Risk",
    metric: "Risk level",
    value: (r) => RISK_ORDER[r.risk_level],
    higherIsWorse: true,
    format: (v) => ["Healthy", "Monitor", "Stress", "Critical"][v] ?? String(v),
    max: 3,
  },
  stock: {
    label: "Stock",
    metric: "Min days of cover",
    value: (r) => r.values.inventory ?? null,
    higherIsWorse: false,
    scale: { thresholds: [21, 14, 7, 3], higherIsWorse: false },
    format: (v) => `${v}d`,
    max: 21,
  },
  beds: {
    label: "Beds",
    metric: "Beds next week",
    value: (r) => r.values.beds ?? null,
    higherIsWorse: true,
    scale: { thresholds: [60, 75, 85, 95], higherIsWorse: true },
    format: (v) => `${Math.round(v)}%`,
    max: 100,
  },
  staffing: {
    label: "Staffing",
    metric: "Doctor absence risk",
    value: (r) => r.values.staffing ?? null,
    higherIsWorse: true,
    scale: { thresholds: [0, 0.25, 0.5, 0.75], higherIsWorse: true },
    format: (v) => (v > 0 ? "At risk" : "Covered"),
    max: 1,
  },
  performance: {
    label: "Performance",
    metric: "Performance score",
    value: (r) => r.values.performance ?? null,
    higherIsWorse: false,
    scale: { thresholds: [90, 80, 70, 60], higherIsWorse: false },
    format: (v) => String(Math.round(v)),
    max: 100,
  },
};

export function isLens(v: string | null | undefined): v is Lens {
  return !!v && (LENSES as string[]).includes(v);
}

/** Tile and bar colour for a row under a lens. */
export function lensColor(lens: Lens, r: FacilityRow): string {
  if (lens === "risk") return riskVar(r.risk_level);
  const def = LENS_DEFS[lens];
  return heatColor(def.value(r), def.scale as HeatScale);
}

/** Worst first: a positive number sorts later. */
export function lensRank(lens: Lens, r: FacilityRow): number {
  const def = LENS_DEFS[lens];
  const v = def.value(r);
  if (v === null) return Number.NEGATIVE_INFINITY;
  return def.higherIsWorse ? v : -v;
}

export function rankByLens(lens: Lens, rows: FacilityRow[]): FacilityRow[] {
  return [...rows].sort((a, b) => lensRank(lens, b) - lensRank(lens, a) || a.facility_name.localeCompare(b.facility_name));
}

/** "PHC Kota-4" -> "Kota-4" for tiles. */
export function tileName(name: string): string {
  return name.replace(/^(PHC|CHC)\s+/i, "");
}

export type Filters = { risks: RiskLevel[]; type: "" | "PHC" | "CHC"; q: string };

const RISKS: RiskLevel[] = ["healthy", "monitor", "stress", "critical"];

export function parseFilters(get: (k: string) => string | null): Filters {
  const risks = (get("risk") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is RiskLevel => (RISKS as string[]).includes(s));
  const t = (get("type") ?? "").toUpperCase();
  return { risks, type: t === "PHC" || t === "CHC" ? t : "", q: (get("q") ?? "").trim() };
}

export function matchesFilters(r: FacilityRow, type: string, f: Filters): boolean {
  if (f.risks.length > 0 && !f.risks.includes(r.risk_level)) return false;
  if (f.type && type.toUpperCase() !== f.type) return false;
  if (f.q && !r.facility_name.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}

/** Bin performance scores into 10 point buckets from 40 to 100. */
export function histogram(values: number[], start = 40, end = 100, step = 10): Array<{ label: string; count: number; from: number }> {
  const out: Array<{ label: string; count: number; from: number }> = [];
  for (let lo = start; lo < end; lo += step) {
    const hi = lo + step;
    const count = values.filter((v) => (lo === start ? v < hi : v >= lo && (hi === end ? v <= hi : v < hi))).length;
    out.push({ label: `${lo}-${hi}`, count, from: lo });
  }
  return out;
}

/** Action title for the lens (computed from the rows). */
export function lensTitle(lens: Lens, rows: FacilityRow[]): string {
  const n = rows.length;
  if (n === 0) return "No facilities match the filters";
  const worst = rankByLens(lens, rows)[0];
  const w = LENS_DEFS[lens].value(worst);
  switch (lens) {
    case "risk": {
      const c = rows.filter((r) => r.risk_level === "critical").length;
      return `${c} of ${n} facilities are critical, ${worst.facility_name} first in line`;
    }
    case "stock": {
      const c = rows.filter((r) => (r.values.inventory ?? 99) < 3).length;
      return `${c} of ${n} facilities hold under 3 days of some medicine, ${worst.facility_name} lowest at ${w}d`;
    }
    case "beds": {
      const c = rows.filter((r) => (r.values.beds ?? 0) > 90).length;
      return `${c} of ${n} facilities will be above 90% bed occupancy next week, ${worst.facility_name} at ${Math.round(w ?? 0)}%`;
    }
    case "staffing": {
      const c = rows.filter((r) => (r.values.staffing ?? 0) > 0).length;
      return `${c} of ${n} facilities have a doctor at high absence risk`;
    }
    case "performance": {
      const c = rows.filter((r) => (r.values.performance ?? 100) < 70).length;
      return `${c} of ${n} facilities score under 70, ${worst.facility_name} lowest at ${Math.round(w ?? 0)}`;
    }
  }
}
