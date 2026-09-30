"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Minus, Snowflake, X } from "lucide-react";
import { Meter } from "@/components/ds/Meter";
import { PriorityChip } from "@/components/ds/PriorityChip";
import { StatusChip } from "@/components/ds/StatusChip";
import { Chip } from "@/components/ds/chip";
import { nodeName } from "@/components/command/Actions";
import { useEntityIndex } from "@/lib/entity-index";
import type { Facility, MedicineForecast, RecommendationV2, ShipmentSummary, WarehouseSummary } from "@/lib/api/types";
import { fmtDateTime, fmtDuration, fmtKm } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ApproveAction, ModifyAction, RejectAction } from "./decision-actions";
import { COLUMNS, chosenReason, optionsFor, plural, type ColumnId, type ConsideredOption } from "./decision-logic";

const TYPE_LABEL: Record<RecommendationV2["type"], string> = {
  replenishment: "Replenishment",
  stock_transfer: "Stock transfer",
  bed_redirect: "Bed redirect",
  staff_transfer: "Staff transfer",
  diagnostic_redirect: "Diagnostic redirect",
};

export type BoardContext = {
  facilities: Facility[];
  warehouses: WarehouseSummary[];
  medicines: MedicineForecast[];
  shipments: ShipmentSummary[];
};

export function DecisionBoard({ columns, ctx }: { columns: Record<ColumnId, RecommendationV2[]>; ctx: BoardContext }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="decision-board">
      {COLUMNS.map((c) => (
        <section key={c.id} aria-label={c.label} data-testid={`column-${c.id}`} className="flex min-h-0 min-w-0 flex-col rounded-md border border-border bg-surface-2">
          <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-text">{c.label}</h3>
              <p className="truncate text-[11px] text-muted">{c.hint}</p>
            </div>
            <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[12px] font-semibold text-text" data-testid={`count-${c.id}`}>
              {columns[c.id].length}
            </span>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {columns[c.id].length === 0 ? (
              <p className="px-2 py-8 text-center text-[12px] text-muted">{emptyText(c.id)}</p>
            ) : (
              columns[c.id].map((r) => <RecommendationCard key={r.id} rec={r} ctx={ctx} column={c.id} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function emptyText(id: ColumnId): string {
  switch (id) {
    case "pending":
      return "Nothing is waiting. New recommendations appear as stock falls.";
    case "moving":
      return "No approved recommendation is in progress. Approve one from Pending to start a shipment.";
    case "completed":
      return "No delivery has been confirmed yet in this run.";
    default:
      return "Nothing has been rejected or has expired.";
  }
}

function RecommendationCard({ rec, ctx, column }: { rec: RecommendationV2; ctx: BoardContext; column: ColumnId }) {
  const index = useEntityIndex();
  const [showAll, setShowAll] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const source = nodeName(index, rec.source_kind, rec.source_id);
  const target = nodeName(index, "facility", rec.target_facility_id);
  const shipment = rec.shipment_id ? ctx.shipments.find((s) => s.id === rec.shipment_id) : undefined;
  const reasons = showAll ? rec.reasons : rec.reasons.slice(0, 1);
  const stock = rec.type === "replenishment" || rec.type === "stock_transfer";

  return (
    <article id={rec.id} data-testid={`rec-${rec.id}`} className="scroll-mt-24 rounded-md border border-border bg-surface-1 p-2.5 shadow-[var(--inset-highlight)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <PriorityChip priority={rec.priority} size="sm" />
          <Chip label={TYPE_LABEL[rec.type]} color="var(--text-muted)" size="sm" dot={false} />
        </div>
        <span className="num text-[11px] text-muted" title="Model confidence">
          {rec.confidence}%
        </span>
      </div>
      <h4 className="mt-1.5 text-[13px] font-semibold leading-snug text-text">{rec.subject}</h4>
      <p className="mt-0.5 text-[12px] leading-snug text-muted">
        {source} to {target}
      </p>
      <div className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text">
        <span>{rec.quantity_or_detail}</span>
        {rec.distance_km !== null && <span className="text-muted">{fmtKm(rec.distance_km)}</span>}
        {rec.eta_minutes !== null && <span className="text-muted">ETA {fmtDuration(rec.eta_minutes)}</span>}
      </div>
      <div className="mt-2">
        <Meter value={rec.confidence} max={100} tone="healthy" label="Confidence" />
      </div>

      <ul className="mt-2 space-y-1">
        {reasons.map((r) => (
          <li key={r} className="flex gap-1.5 text-[11.5px] leading-snug text-muted">
            <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden />
            {r}
          </li>
        ))}
      </ul>
      {rec.reasons.length > 1 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-[11px] font-medium text-brand hover:underline">
          {showAll ? "Show fewer" : `${rec.reasons.length - 1} more`}
        </button>
      )}

      {rec.shipment_id && (
        <Link
          href={`/supply/shipments/${rec.shipment_id}`}
          className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-border-strong px-1.5 py-1 text-[11px] hover:border-brand"
        >
          <span className="num text-text">{rec.shipment_id}</span>
          {shipment && <StatusChip status={shipment.status} size="sm" live />}
        </Link>
      )}

      {column === "pending" ? (
        <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-border pt-2">
          <RejectAction rec={rec} />
          <ModifyAction rec={rec} sourceName={source} targetName={target} />
          <ApproveAction rec={rec} sourceName={source} targetName={target} />
        </div>
      ) : (
        <p className="mt-2 border-t border-border pt-2 text-[11px] leading-snug text-muted">
          {rec.status === "fulfilled" ? "Delivered" : rec.status.charAt(0).toUpperCase() + rec.status.slice(1)}
          {rec.resolved_at && <> {fmtDateTime(rec.resolved_at)} IST</>}
          {rec.resolved_by && <> by {rec.resolved_by}</>}
          {rec.resolution_note && <>. {rec.resolution_note}</>}
        </p>
      )}

      {stock && (
        <>
          <button
            type="button"
            aria-expanded={showOptions}
            onClick={() => setShowOptions((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted hover:text-text"
          >
            {showOptions ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
            Options considered
          </button>
          {showOptions && <OptionsTable rec={rec} ctx={ctx} />}
        </>
      )}
    </article>
  );
}

function Tick({ v }: { v: boolean | null }) {
  if (v === null) return <Minus size={12} className="mx-auto text-faint" aria-label="Not evaluated" />;
  return v ? <Check size={12} className="mx-auto text-green" aria-label="Yes" /> : <X size={12} className="mx-auto text-red" aria-label="No" />;
}

function OptionsTable({ rec, ctx }: { rec: RecommendationV2; ctx: BoardContext }) {
  const opts: ConsideredOption[] = optionsFor(rec, ctx.facilities, ctx.warehouses, ctx.medicines);
  if (opts.length === 0) return <p className="mt-1 text-[11px] text-muted">Options are not available for this recommendation.</p>;
  return (
    <div className="mt-1.5 overflow-x-auto" data-testid={`options-${rec.id}`}>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-muted">
            <th className="py-1 pr-2 font-medium">Option</th>
            <th className="px-1 py-1 text-center font-medium" title="Within range">Range</th>
            <th className="px-1 py-1 text-center font-medium" title="Stock available">Stock</th>
            <th className="px-1 py-1 text-center font-medium" title="Cold chain capable"><Snowflake size={11} className="mx-auto" aria-label="Cold chain" /></th>
            <th className="px-1 py-1 text-center font-medium" title="ETA under threshold">ETA</th>
          </tr>
        </thead>
        <tbody>
          {opts.map((o) => (
            <tr key={o.kind} className={cn("border-t border-border", o.chosen && "bg-brand-soft")}>
              <td className="py-1.5 pr-2 align-top">
                <p className={cn("leading-snug", o.chosen ? "font-semibold text-text" : "text-muted")}>
                  {o.label}
                  {o.chosen && <span className="ml-1 text-brand">chosen</span>}
                </p>
                <p className="num text-[10px] text-faint">
                  {o.km === null || o.etaMin === null
                    ? "No candidate"
                    : `${fmtKm(o.km)}, ${fmtDuration(o.etaMin)}${o.unitsUsedWhileWaiting !== null ? `, ${o.unitsUsedWhileWaiting} used while waiting` : ""}`}
                </p>
              </td>
              <td className="px-1"><Tick v={o.criteria.inRange} /></td>
              <td className="px-1"><Tick v={o.criteria.stock} /></td>
              <td className="px-1"><Tick v={o.criteria.coldChain} /></td>
              <td className="px-1"><Tick v={o.criteria.etaOk} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10.5px] text-faint">
        {chosenReason(opts)} {plural(opts.filter((o) => o.km !== null).length, "option")} evaluated with straight line distance times 1.3 and 40 km/h.
      </p>
    </div>
  );
}
