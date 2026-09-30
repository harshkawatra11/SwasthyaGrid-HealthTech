"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  Activity,
  AlarmClock,
  ArrowRight,
  CheckCheck,
  FilePlus2,
  PackageCheck,
  Snowflake,
  TimerReset,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PriorityChip } from "@/components/ds/PriorityChip";
import { StatusChip } from "@/components/ds/StatusChip";
import { ApproveAction, RejectAction } from "@/components/recommendations/decision-actions";
import { useEntityIndex, type EntityIndex } from "@/lib/entity-index";
import type { LogisticsKpis, RecommendationV2, ShipmentSummary, StateSummary } from "@/lib/api/types";
import { fmtClock, fmtDuration, fmtKm, fmtRelative } from "@/lib/format";
import { useLiveEvents } from "@/lib/live/LiveProvider";
import { Panel, PanelSkeleton, SOURCE_SEED, SOURCE_SIM } from "./Panel";
import {
  approvalsTitle,
  exceptionsTitle,
  lastEvents,
  plural,
  shortDistrict,
  shortMedicine,
  timelineFromShipmentEvents,
  timelineFromShipments,
  watchlistTitle,
  type TimelineItem,
  type TimelineKind,
} from "./titles";

export function nodeName(index: EntityIndex, kind: "facility" | "warehouse", id: string): string {
  const n = kind === "warehouse" ? index.warehouseName(id) : index.facilityName(id);
  if (n !== id) return n;
  const other = kind === "warehouse" ? index.facilityName(id) : index.warehouseName(id);
  return other;
}

const PRIORITY_RANK = { critical: 0, high: 1, normal: 2 } as const;

export function sortPending(pending: RecommendationV2[]): RecommendationV2[] {
  return [...pending].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.confidence - a.confidence || a.id.localeCompare(b.id),
  );
}

type Risk = StateSummary["top_risks"][number];

export function WatchlistCard({
  summary,
  shipments,
  pending,
}: {
  summary: StateSummary | undefined;
  shipments: ShipmentSummary[];
  pending: RecommendationV2[];
}) {
  const index = useEntityIndex();
  const router = useRouter();
  const byId = useMemo(() => new Map(shipments.map((s) => [s.id, s])), [shipments]);
  if (!summary) return <PanelSkeleton className="lg:col-span-4" lines={8} />;
  const rows = summary.top_risks;

  const columns: Column<Risk>[] = [
    {
      key: "facility",
      header: "Facility | medicine",
      accessor: (r) => r.facility_name,
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/facilities/${r.facility_id}`} className="block truncate text-text hover:text-brand" onClick={(e) => e.stopPropagation()}>
            {r.facility_name}
          </Link>
          <span className="block truncate text-[11px] text-faint">{shortDistrict(index.districtName(r.district_id))} | {shortMedicine(r.medicine_name)}</span>
        </div>
      ),
    },
    {
      key: "days",
      header: "Cover",
      accessor: (r) => r.days_remaining,
      align: "right",
      sortable: true,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <span className="block h-1.5 w-10 rounded-full bg-surface-3" aria-hidden>
            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (r.days_remaining / 7) * 100)}%`, backgroundColor: r.days_remaining < 3 ? "var(--risk-critical)" : "var(--risk-monitor)" }} />
          </span>
          <span className={r.days_remaining < 3 ? "font-semibold text-red" : "text-text"}>{r.days_remaining.toFixed(1)}d</span>
        </div>
      ),
    },
    {
      key: "inbound",
      header: "Inbound",
      accessor: (r) => r.inbound_shipment_id ?? "",
      cell: (r) => {
        const s = r.inbound_shipment_id ? byId.get(r.inbound_shipment_id) : undefined;
        if (!r.inbound_shipment_id) return <span className="whitespace-nowrap text-[11px] text-faint">No shipment</span>;
        return (
          <Link href={`/supply/shipments/${r.inbound_shipment_id}`} onClick={(e) => e.stopPropagation()} className="inline-flex flex-col gap-0.5">
            {s ? <StatusChip status={s.status} size="sm" live /> : null}
            <span className="num text-[10px] text-muted">{r.inbound_shipment_id}</span>
          </Link>
        );
      },
    },
    {
      key: "act",
      header: "",
      accessor: () => "",
      align: "right",
      cell: (r) => {
        const rec = pending.find((p) => p.target_facility_id === r.facility_id && p.medicine_name === r.medicine_name);
        return (
          <Link
            href={rec ? `/recommendations#${rec.id}` : "/recommendations"}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-sm border border-border-strong px-1.5 py-0.5 text-[11px] font-medium text-text hover:border-brand hover:text-brand"
          >
            Review <ArrowRight size={10} aria-hidden />
          </Link>
        );
      },
    },
  ];

  return (
    <Panel
      className="lg:col-span-4"
      eyebrow="Critical watchlist"
      title={watchlistTitle(rows)}
      testId="card-watchlist"
      read="Read: lowest days of cover first, emergency medicines win ties. A red figure is under 3 days; the bar scales to 7 days."
      source={`${SOURCE_SEED}; days = units / avg daily use`}
      section="Command / Action"
      bodyClassName="px-0"
    >
      <DataTable columns={columns} rows={rows} rowKey={(r) => `${r.facility_id}-${r.medicine_name}`} density="compact" maxHeight={320} onRowClick={(r) => router.push(`/facilities/${r.facility_id}`)} />
    </Panel>
  );
}

export function PendingApprovalsCard({ pending, summary }: { pending: RecommendationV2[] | undefined; summary: StateSummary | undefined }) {
  const index = useEntityIndex();
  if (!pending) return <PanelSkeleton className="lg:col-span-3" lines={7} />;
  const sorted = sortPending(pending);
  const top = sorted.slice(0, 5);
  const t = summary?.totals;
  return (
    <Panel
      className="lg:col-span-3"
      eyebrow="Pending approvals"
      title={approvalsTitle(pending)}
      testId="card-approvals"
      actions={
        <Link href="/recommendations" className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline">
          Open board <ArrowRight size={11} aria-hidden />
        </Link>
      }
      read={t ? `Read: showing the top 5 of ${t.pending_recommendations} pending decisions by priority, then model confidence.` : undefined}
      source={`${SOURCE_SEED}; recommendation engine v2`}
      section="Command / Action"
      bodyClassName="max-h-[360px] overflow-y-auto px-0"
    >
      {top.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted">Nothing is waiting. New recommendations appear here as stock falls.</p>
      ) : (
        <ul>
          {top.map((r) => {
            const source = nodeName(index, r.source_kind, r.source_id);
            const target = nodeName(index, "facility", r.target_facility_id);
            return (
              <li key={r.id} data-testid={`pending-${r.id}`} className="border-t border-border px-4 py-2 first:border-t-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <PriorityChip priority={r.priority} size="sm" />
                    <span className="truncate text-[12px] font-medium text-text">{r.subject}</span>
                  </div>
                  <span className="num shrink-0 text-[11px] text-muted">{r.confidence}%</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted">
                  {source} to {target}
                  {r.distance_km !== null && `, ${fmtKm(r.distance_km)}`}
                  {r.eta_minutes !== null && `, ${fmtDuration(r.eta_minutes)}`}
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="num text-[11px] text-text">{r.quantity_or_detail}</span>
                  <div className="flex gap-1.5">
                    <RejectAction rec={r} compact />
                    <ApproveAction rec={r} sourceName={source} targetName={target} compact />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {pending.length > 0 && (
        <div className="border-t border-border px-4 py-2.5" data-testid="priority-mix">
          <p className="eyebrow mb-1.5">Queue by priority</p>
          <div className="flex h-2.5 overflow-hidden rounded-[3px] bg-surface-2">
            {(["critical", "high", "normal"] as const).map((k) => {
              const n = pending.filter((r) => r.priority === k).length;
              return n > 0 ? (
                <span key={k} title={`${k}: ${n}`} style={{ width: `${(n / pending.length) * 100}%`, backgroundColor: k === "critical" ? "var(--red)" : k === "high" ? "var(--orange)" : "var(--text-faint)", borderRight: "2px solid var(--surface-1)" }} />
              ) : null;
            })}
          </div>
          <p className="num mt-1 text-[11px] text-muted">
            {(["critical", "high", "normal"] as const).map((k) => `${pending.filter((r) => r.priority === k).length} ${k}`).join(", ")}
          </p>
        </div>
      )}
    </Panel>
  );
}

export function SupplyExceptionsCard({ shipments, kpis }: { shipments: ShipmentSummary[]; kpis: LogisticsKpis | undefined }) {
  const events = useLiveEvents({ kind: "shipment" });
  const liveBreaches = events.filter((e) => e.kind === "shipment" && e.data.event.type === "cold_chain_breach").length;
  const delayed = shipments.filter((s) => s.status === "delayed");
  const blocked = shipments.filter((s) => s.blocked_reason !== null);
  const breaches = Math.max(kpis?.cold_chain_breaches_today ?? 0, liveBreaches);
  if (!kpis) return <PanelSkeleton className="lg:col-span-2" lines={6} />;
  const items = [
    ...delayed.map((s) => ({ s, kind: "delayed" as const })),
    ...blocked.map((s) => ({ s, kind: "blocked" as const })),
  ].slice(0, 6);
  return (
    <Panel
      className="lg:col-span-2"
      eyebrow="Supply exceptions"
      title={exceptionsTitle(delayed.length, blocked.length, breaches)}
      live
      testId="card-exceptions"
      read="Read: delayed means behind plan, blocked means no vehicle or driver could be assigned yet."
      source={`${SOURCE_SIM}; live stream`}
      section="Command / Supply chain"
      bodyClassName="max-h-[360px] overflow-y-auto"
    >
      <div className="mb-2 grid grid-cols-3 gap-2 text-center">
        <Count icon={<TimerReset size={13} aria-hidden />} n={delayed.length} label="Delayed" />
        <Count icon={<TriangleAlert size={13} aria-hidden />} n={blocked.length} label="Blocked" />
        <Count icon={<Snowflake size={13} aria-hidden />} n={breaches} label="Cold chain" />
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-center text-[12px] text-muted">All shipments are on plan.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map(({ s, kind }) => (
            <li key={`${s.id}-${kind}`}>
              <Link href={`/supply/shipments/${s.id}`} className="block rounded-sm border border-border px-2 py-1.5 hover:bg-surface-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[11px] font-medium text-text">{s.id}</span>
                  {kind === "delayed" ? <span className="num text-[11px] text-red">+{s.delay_minutes} min</span> : <StatusChip status={s.status} size="sm" />}
                </div>
                <p className="truncate text-[11px] text-muted">
                  {kind === "blocked" ? s.blocked_reason : `To ${s.destination.name}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2 text-center" data-testid="fleet-stats">
        <FleetStat label="Trucks out" value={kpis.vehicles_in_transit ?? 0} />
        <FleetStat label="Available" value={kpis.vehicles_available ?? 0} />
        <FleetStat label="Delivered today" value={kpis.delivered_today ?? 0} />
      </dl>
      {delayed.length > 0 && (
        <p className="mt-2 text-[11px] text-faint">
          Longest delay {fmtDuration(Math.max(...delayed.map((s) => s.delay_minutes)))} across {plural(delayed.length, "shipment")}.
        </p>
      )}
    </Panel>
  );
}

function Count({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) {
  return (
    <div className="rounded-sm bg-surface-2 py-1.5">
      <p className="num text-[18px] font-semibold leading-none text-text">{n}</p>
      <p className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-muted">
        {icon}
        {label}
      </p>
    </div>
  );
}

function FleetStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="num text-[16px] font-semibold leading-none text-text">{value}</dd>
      <dt className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">{label}</dt>
    </div>
  );
}

const ICON: Record<TimelineKind, ReactNode> = {
  created: <FilePlus2 size={13} aria-hidden />,
  approved: <CheckCheck size={13} aria-hidden />,
  departed: <Truck size={13} aria-hidden />,
  arrived: <PackageCheck size={13} aria-hidden />,
  delayed: <AlarmClock size={13} aria-hidden />,
  risk: <Activity size={13} aria-hidden />,
  cold: <Snowflake size={13} aria-hidden />,
  other: <Activity size={13} aria-hidden />,
};

const TONE: Record<TimelineKind, string> = {
  created: "text-muted",
  approved: "text-brand",
  departed: "text-[var(--status-in-transit)]",
  arrived: "text-green",
  delayed: "text-red",
  risk: "text-amber",
  cold: "text-[var(--series-6)]",
  other: "text-muted",
};

export function TimelineCard({ shipments, simNow, scope }: { shipments: ShipmentSummary[]; simNow: string | null; scope: string }) {
  const live = useLiveEvents(scope === "all" ? {} : { district_id: scope });
  const now = simNow ?? new Date().toISOString();
  const items: TimelineItem[] = useMemo(() => {
    const fromLive: TimelineItem[] = [];
    for (const e of live) {
      if (e.kind === "shipment") fromLive.push(...timelineFromShipmentEvents([e.data.event]));
      else if (e.kind === "risk")
        fromLive.push({
          key: `risk-${e.id}`,
          at: now,
          kind: "risk",
          title: `${e.data.facility_name}: ${e.data.from} to ${e.data.to}`,
          detail: e.data.reason,
          href: `/facilities/${e.data.facility_id}`,
        });
    }
    return lastEvents([...fromLive, ...timelineFromShipments(shipments, now)], 20);
  }, [live, shipments, now]);

  return (
    <Panel
      className="lg:col-span-3"
      eyebrow="Last 20 events"
      title={items[0] ? `Latest: ${items[0].title}` : "No events yet in this run"}
      live
      testId="card-timeline"
      read="Read: newest first, times in IST. Icons: created, approved, departed, arrived, delayed, cold chain."
      source={`${SOURCE_SIM}; live stream and shipment log`}
      section="Command / Events"
      bodyClassName="max-h-[360px] overflow-y-auto"
    >
      <ol className="relative space-y-2.5 border-l border-border pl-4">
        {items.map((i) => {
          const body = (
            <>
              <span className={`absolute -left-[25px] top-0 inline-flex h-4 w-4 items-center justify-center rounded-full bg-surface-1 ${TONE[i.kind]}`}>{ICON[i.kind]}</span>
              <p className="text-[12px] leading-snug text-text">{i.title}</p>
              <p className="truncate text-[11px] text-muted">
                <span className="num">{fmtClock(i.at)}</span> | {fmtRelative(i.at, now)} | {i.detail}
              </p>
            </>
          );
          return (
            <li key={i.key} className="relative">
              {i.href ? (
                <Link href={i.href} className="block hover:opacity-80">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
