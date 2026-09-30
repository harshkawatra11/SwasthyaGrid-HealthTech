"use client";

import { useMemo } from "react";
import { KpiTile } from "@/components/ds/KpiTile";
import { Meter } from "@/components/ds/Meter";
import { Skeleton } from "@/components/ds/Skeleton";
import {
  useClock,
  useFacilities,
  useFacilityMatrix,
  useLogisticsKpis,
  useMedicineMatrix,
  useRecommendations,
  useShipments,
  useStateSummary,
  useStatusBreakdown,
  useVolumeSeries,
  useWarehouses,
} from "@/lib/api/hooks";
import type { LogisticsKpis, RecommendationV2, StateSummary, VolumeSeries } from "@/lib/api/types";
import { fmtPct } from "@/lib/format";
import { useLiveSimNow } from "@/lib/live/LiveProvider";
import { useScope } from "@/lib/scope";
import { PendingApprovalsCard, SupplyExceptionsCard, TimelineCard, WatchlistCard } from "./Actions";
import { LeagueTableCard, RiskMapCard } from "./GeoRow";
import { FacilityMatrixCard, MedicineMatrixCard } from "./Matrices";
import { FootfallCard, RiskMixCard, VolumeCard, useDistrictFootfalls } from "./Trends";
import { lastDays } from "./titles";

export function kpiTiles(summary: StateSummary, kpis: LogisticsKpis, volume: VolumeSeries | undefined, pending: RecommendationV2[]) {
  const t = summary.totals;
  const rows = summary.districts;
  const spread = (pick: (d: StateSummary["districts"][number]) => number) => rows.map(pick);
  const days = volume ? lastDays(volume, 14, (p) => p.shipments) : [];
  const pts = volume?.points ?? [];
  const yesterday = pts.length >= 3 ? pts[pts.length - 2].shipments : null;
  const before = pts.length >= 3 ? pts[pts.length - 3].shipments : null;
  const critical = pending.filter((r) => r.priority === "critical").length;
  return [
    {
      key: "critical",
      label: "Critical facilities",
      value: `${t.risk_counts.critical}/${t.facilities}`,
      href: "/facilities?risk=critical",
      sparkline: spread((d) => d.risk_counts.critical),
      hint: `${t.risk_counts.stress} more under stress`,
    },
    {
      key: "stockout",
      label: "Stock-out risk items",
      value: t.stockout_items,
      href: "/inventory?max=3",
      sparkline: spread((d) => d.stockout_items),
      hint: `under 3 days; ${t.low_cover_items} more at 3 to 7 days`,
    },
    {
      key: "beds",
      label: "Bed pressure next week",
      value: fmtPct(t.bed_next_week_avg),
      delta: {
        value: Math.round((t.bed_next_week_avg - t.bed_occupancy_avg) * 10) / 10,
        direction: (t.bed_next_week_avg >= t.bed_occupancy_avg ? "up" : "down") as "up" | "down",
        good: "down" as const,
      },
      href: "/beds",
      sparkline: spread((d) => d.bed_next_week_avg),
      hint: <Meter value={t.bed_next_week_avg} max={100} showValue={false} label="Occupancy forecast" />,
    },
    {
      key: "doctors",
      label: "Doctors at absence risk",
      value: t.doctors_high_risk,
      href: "/doctors",
      sparkline: spread((d) => d.doctors_high_risk),
      hint: `${t.diagnostics_down} diagnostics down`,
    },
    {
      key: "transit",
      label: "Shipments in transit",
      value: t.shipments_in_transit,
      href: "/supply",
      delta:
        yesterday !== null && before !== null
          ? { value: Math.abs(yesterday - before), direction: (yesterday >= before ? "up" : "down") as "up" | "down", good: "up" as const }
          : undefined,
      sparkline: days,
      hint: `${fmtPct(t.on_time_rate_7d * 100)} on time over 7 days, ${kpis.delayed_now ?? 0} delayed`,
    },
    {
      key: "pending",
      label: "Pending approvals",
      value: t.pending_recommendations,
      href: "/recommendations",
      sparkline: spread((d) => d.pending_recommendations),
      hint: `${critical} of them critical priority`,
    },
  ];
}

export function CommandCentre() {
  const { scope, setScope } = useScope();
  const districtId = scope === "all" ? undefined : scope;

  const summary = useStateSummary(scope).data ?? undefined;
  const all = useStateSummary("all").data ?? undefined;
  const matrix = useFacilityMatrix(scope).data;
  const stateMatrix = useFacilityMatrix("all").data;
  const medicine = useMedicineMatrix(scope).data;
  const kpis = useLogisticsKpis(scope).data;
  const volume = useVolumeSeries(scope, 90).data;
  const breakdown = useStatusBreakdown(scope).data;
  const shipments = useShipments({ district_id: districtId, limit: 200 }).data?.items;
  const recs = useRecommendations({ district_id: districtId }).data?.recommendations;
  const facilities = useFacilities("all").data?.facilities;
  const warehouses = useWarehouses("all").data?.items;
  const footfalls = useDistrictFootfalls();
  const clock = useClock().data;
  const liveNow = useLiveSimNow();

  const ship = useMemo(() => shipments ?? [], [shipments]);
  const pending = useMemo(() => (recs ?? []).filter((r) => r.status === "pending"), [recs]);
  const simNow = liveNow ?? clock?.sim_now ?? summary?.generated_at ?? null;

  const tiles = summary && kpis ? kpiTiles(summary, kpis, volume, pending) : null;

  return (
    <div className="mx-auto max-w-[1680px]" data-testid="command-centre" data-scope={scope}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-12 lg:grid-cols-6" data-testid="kpi-band">
          {tiles
            ? tiles.map((k) => (
                <KpiTile key={k.key} label={k.label} value={k.value} href={k.href} sparkline={k.sparkline} hint={k.hint} delta={k.delta} />
              ))
            : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[124px]" />)}
        </div>

        <RiskMapCard all={all} facilities={facilities ?? []} warehouses={warehouses ?? []} scope={scope} onScope={setScope} />
        <LeagueTableCard all={all} scope={scope} className="h-full" />

        <FacilityMatrixCard matrix={matrix} summary={summary} stateMatrix={stateMatrix} scoped={scope !== "all"} />
        <div className="lg:col-span-4">
          <MedicineMatrixCard matrix={medicine} />
        </div>

        <FootfallCard footfalls={footfalls} summary={all} scope={scope} />
        <VolumeCard volume={volume} breakdown={breakdown} />
        <RiskMixCard all={all} scope={scope} />

        <WatchlistCard summary={summary} shipments={ship} pending={pending} />
        <PendingApprovalsCard pending={recs ? pending : undefined} summary={summary} />
        <SupplyExceptionsCard shipments={ship} kpis={kpis} />
        <TimelineCard shipments={ship} simNow={simNow} scope={scope} />
      </div>
      <p className="mt-4 text-[11px] text-faint">
        Simulated operational data. Seed health data is synthetic. Routes: OpenStreetMap contributors via OSRM. Boundaries: geoBoundaries (ODbL).
      </p>
    </div>
  );
}
