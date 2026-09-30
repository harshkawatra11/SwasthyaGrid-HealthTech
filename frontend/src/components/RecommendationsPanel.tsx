"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ListChecks } from "lucide-react";
import { useRecommendations } from "@/lib/api/hooks";
import { approveRecommendation, modifyRecommendation, rejectRecommendation } from "@/lib/api/mutations";
import type { RecommendationV2 } from "@/lib/api/types";
import { useEntityIndex } from "@/lib/entity-index";
import { useInScope } from "@/lib/facility-view";
import { useScope } from "@/lib/scope";
import { useRole, roleCapabilities } from "@/lib/roleContext";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

type Recommendation = RecommendationV2;

const typeLabel: Record<Recommendation["type"], string> = {
  replenishment: "Replenishment",
  stock_transfer: "Stock Transfer",
  staff_transfer: "Staff Transfer",
  bed_redirect: "Bed Redirect",
  diagnostic_redirect: "Diagnostic Redirect",
};

function ConfidenceRing({ value }: { value: number }) {
  return (
    <div className="flex flex-col items-end shrink-0">
      <span className="font-serif-display text-2xl tabular text-accent-clay">
        {value}%
      </span>
      <span className="text-[10px] tracking-[0.14em] uppercase text-ink-soft">
        Confidence
      </span>
    </div>
  );
}

function RecommendationCard({
  rec,
  onResolve,
  canApprove,
}: {
  rec: Recommendation;
  onResolve: (id: string, status: "approved" | "rejected" | "modified", qty?: string) => void;
  canApprove: boolean;
}) {
  const { facilityName, warehouseName } = useEntityIndex();
  const sourceName =
    rec.source_kind === "warehouse" ? warehouseName(rec.source_id) : facilityName(rec.source_facility_id);
  const targetName = facilityName(rec.target_facility_id);
  const [qty, setQty] = useState(rec.quantity_or_detail);
  const [editing, setEditing] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="border border-hairline bg-paper-dim/50 p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.14em] uppercase text-ink-soft mb-1">
            {typeLabel[rec.type] ?? rec.type}
          </p>
          <h3 className="font-serif-display text-lg text-ink">
            {sourceName} → {targetName}
          </h3>
          <p className="text-sm text-ink-soft mt-1">
            {rec.subject} · <span className="text-ink">{qty}</span>
          </p>
        </div>
        <ConfidenceRing value={rec.confidence} />
      </div>

      <ul className="mt-4 space-y-1.5">
        {rec.reasons.map((r, i) => (
          <li key={i} className="text-sm text-ink-soft flex gap-2">
            <span className="text-accent-brass">—</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>

      {rec.status === "pending" ? (
        canApprove ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {editing && (
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="border border-hairline bg-paper px-2 py-1.5 text-sm text-ink w-40 mr-auto"
              />
            )}
            <button
              onClick={() => onResolve(rec.id, "approved")}
              className="px-4 py-1.5 text-sm font-medium bg-accent-clay text-paper hover:brightness-110 transition"
            >
              Approve
            </button>
            <button
              onClick={() => {
                if (editing) onResolve(rec.id, "modified", qty);
                else setEditing(true);
              }}
              className="px-4 py-1.5 text-sm font-medium border border-accent-brass text-accent-brass hover:bg-accent-brass hover:text-paper transition"
            >
              {editing ? "Save & Approve" : "Modify"}
            </button>
            <button
              onClick={() => onResolve(rec.id, "rejected")}
              className="px-4 py-1.5 text-sm font-medium text-ink-soft hover:text-risk-critical transition"
            >
              Reject
            </button>
          </div>
        ) : (
          <p className="mt-5 text-xs tracking-[0.14em] uppercase font-medium text-ink-soft">
            Pending district administrator review
          </p>
        )
      ) : (
        <p
          className="mt-5 text-xs tracking-[0.14em] uppercase font-medium"
          style={{
            color:
              rec.status === "approved" ||
              rec.status === "modified" ||
              rec.status === "dispatched" ||
              rec.status === "fulfilled"
                ? "var(--color-risk-healthy)"
                : "var(--color-risk-critical)",
          }}
        >
          {rec.status}
        </p>
      )}
    </motion.div>
  );
}

export function RecommendationsPanel({
  filterType,
  limit,
  columns = 2,
}: {
  filterType?: Recommendation["type"];
  limit?: number;
  columns?: 1 | 2;
}) {
  const { scope } = useScope();
  const { data, isLoading } = useRecommendations({ district_id: scope });
  const inScope = useInScope(scope);
  const { role } = useRole();
  const canApprove = roleCapabilities[role].canApprove;
  const loading = isLoading || data === undefined;

  const resolve = (id: string, status: "approved" | "rejected" | "modified", qty?: string) => {
    if (status === "approved") void approveRecommendation(id);
    else if (status === "rejected") void rejectRecommendation(id);
    else void modifyRecommendation(id, { quantity_override: qty ?? "" });
  };

  const scoped = (data?.recommendations ?? []).filter((r) => inScope(r.target_facility_id));
  let recs = filterType ? scoped.filter((r) => r.type === filterType) : scoped;
  if (limit) recs = recs.slice(0, limit);

  const gridClass = columns === 1 ? "grid gap-4" : "grid gap-4 md:grid-cols-2";

  if (loading) {
    return (
      <div className={gridClass}>
        <SkeletonBlock rows={5} />
        {columns === 2 && <SkeletonBlock rows={5} />}
      </div>
    );
  }

  if (recs.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No recommendations here"
        detail="SwasthyaGrid will surface a recommendation as soon as it detects a risk in this category."
      />
    );
  }

  return (
    <div className={gridClass}>
      <AnimatePresence initial={false}>
        {recs.map((rec) => (
          <RecommendationCard key={rec.id} rec={rec} onResolve={resolve} canApprove={canApprove} />
        ))}
      </AnimatePresence>
    </div>
  );
}
