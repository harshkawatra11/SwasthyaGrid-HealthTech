import Link from "next/link";
import { ArrowUpRight, Truck } from "lucide-react";
import { cn } from "@/lib/cn";
import { withScope } from "@/lib/scope";
import type { DistrictSummaryRow } from "@/lib/api/types";
import { Gauge, RISK_INDEX_SCALE, RiskMixBar } from "./kit";
import { SharedSpark } from "./LabCharts";
import { shortName, shortMedicine, type FootfallPoint, type Shortage } from "./metrics";

/**
 * One of five identical district cards (symmetric small multiples): risk gauge, risk mix bar,
 * footfall sparkline on a shared axis, top shortage and trucks in transit.
 */
export function DistrictCard({
  row,
  rank,
  series,
  axis,
  shortage,
  facilityName,
  selected,
  dimmed,
}: {
  row: DistrictSummaryRow;
  rank: number;
  series: FootfallPoint[];
  axis: { min: number; max: number };
  shortage: Shortage | null;
  /** Name of the critical facility to point at, if any. */
  facilityName?: string;
  selected?: boolean;
  dimmed?: boolean;
}) {
  const values = series.map((p) => p.actual ?? p.predicted ?? 0);
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-md border bg-surface-1 shadow-[var(--inset-highlight)] transition-opacity",
        selected ? "border-brand" : "border-border",
        dimmed && "opacity-60",
      )}
      aria-label={`${shortName(row.name)} district card`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <Link href={`/districts/${row.district_id}`} className="flex min-w-0 items-center gap-1 text-[13px] font-semibold text-text hover:text-brand">
          <span className="truncate">{shortName(row.name)}</span>
          <ArrowUpRight size={12} className="shrink-0 text-faint" aria-hidden />
        </Link>
        <span className="num shrink-0 rounded-sm bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">#{rank} of 5</span>
      </header>
      <div className="flex flex-col items-center px-3 pt-3">
        <Gauge value={row.risk_index} scale={RISK_INDEX_SCALE} label="Risk index" />
      </div>
      <div className="space-y-2 px-3 pb-2 pt-1.5">
        <div>
          <p className="eyebrow mb-1">Risk mix, {row.facilities} facilities</p>
          <RiskMixBar counts={row.risk_counts} showLegend />
        </div>
        <div>
          <p className="eyebrow mb-1">Footfall this week</p>
          <div className="flex items-end justify-between gap-2">
            <SharedSpark data={values} min={axis.min} max={axis.max} width={110} />
            <p className="num text-right text-[12px] leading-tight text-text">
              {row.footfall_tomorrow}
              <span className="block text-[10px] text-faint">tomorrow</span>
            </p>
          </div>
        </div>
        <div className="rounded-sm bg-surface-2 px-2 py-1.5 text-[12px] leading-snug">
          <p className="eyebrow mb-0.5">Top shortage</p>
          {shortage ? (
            <p className="text-text">
              {shortMedicine(shortage.medicine)} <span className="num" style={{ color: shortage.days < 3 ? "var(--risk-critical)" : "var(--text)" }}>{shortage.days.toFixed(1)}d</span>
              <span className="text-muted"> in {shortage.facilitiesBelow} facilit{shortage.facilitiesBelow === 1 ? "y" : "ies"}</span>
            </p>
          ) : (
            <p className="text-muted">No shortage</p>
          )}
          {facilityName && <p className="truncate text-[11px] text-muted">Critical: {facilityName}</p>}
        </div>
        <div className="flex items-center justify-between text-[12px] text-muted">
          <Link href={withScope("/supply", row.district_id)} className="inline-flex items-center gap-1.5 hover:text-text">
            <Truck size={13} aria-hidden />
            <span className="num text-text">{row.shipments_in_transit}</span> in transit
          </Link>
          <Link href={withScope("/recommendations", row.district_id)} className="hover:text-text">
            <span className="num text-text">{row.pending_recommendations}</span> pending
          </Link>
        </div>
      </div>
    </article>
  );
}
