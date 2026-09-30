"use client";

import { useFootfall } from "@/lib/api/hooks";
import type { FootfallForecast } from "@/lib/api/types";
import { DISTRICT_IDS } from "@/lib/scope";
import bundled from "./footfall-by-district.json";
import type { FootfallPoint } from "./metrics";

const OFFLINE = bundled as unknown as Record<string, FootfallForecast>;

export function toSeries(f: FootfallForecast | null | undefined): FootfallPoint[] {
  return ((f?.series ?? []) as Array<Record<string, unknown>>).map((p) => ({
    day: String(p.day),
    actual: typeof p.actual === "number" ? p.actual : undefined,
    predicted: typeof p.predicted === "number" ? p.predicted : undefined,
  }));
}

/** Footfall forecast of every district (fixed hook count). Offline, each district uses its bundled series. */
export function useDistrictFootfalls(): Record<string, FootfallForecast | null> {
  const a = useFootfall(DISTRICT_IDS[0]);
  const b = useFootfall(DISTRICT_IDS[1]);
  const c = useFootfall(DISTRICT_IDS[2]);
  const d = useFootfall(DISTRICT_IDS[3]);
  const e = useFootfall(DISTRICT_IDS[4]);
  const all = [a, b, c, d, e];
  const out: Record<string, FootfallForecast | null> = {};
  DISTRICT_IDS.forEach((id, i) => {
    const r = all[i];
    out[id] = r.offline ? (OFFLINE[id] ?? null) : (r.data ?? null);
  });
  return out;
}

/** Single district footfall with the same offline behaviour. */
export function useOneFootfall(districtId: string): FootfallForecast | null {
  const r = useFootfall(districtId);
  return r.offline ? (OFFLINE[districtId] ?? null) : (r.data ?? null);
}
