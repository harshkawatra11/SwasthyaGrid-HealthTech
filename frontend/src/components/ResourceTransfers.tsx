"use client";

import { ArrowRightLeft } from "lucide-react";
import { useRecommendations } from "@/lib/api/hooks";
import { useEntityIndex } from "@/lib/entity-index";
import { useInScope } from "@/lib/facility-view";
import { useScope } from "@/lib/scope";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonBlock } from "@/components/ui/Skeleton";

export function ResourceTransfers() {
  const { scope } = useScope();
  const { data, isLoading } = useRecommendations({ district_id: scope });
  const inScope = useInScope(scope);
  const { facilityName, warehouseName } = useEntityIndex();
  const loading = isLoading || data === undefined;
  const approved = (data?.recommendations ?? []).filter(
    (r) =>
      (r.status === "approved" || r.status === "modified" || r.status === "dispatched" || r.status === "fulfilled") &&
      inScope(r.target_facility_id),
  );

  if (loading) return <SkeletonBlock rows={3} />;

  if (approved.length === 0) {
    return (
      <EmptyState
        icon={ArrowRightLeft}
        title="No transfers approved yet"
        detail="Resolve a recommendation to see it appear here as a district action."
      />
    );
  }

  return (
    <div className="space-y-2">
      {approved.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-center justify-between gap-2 border border-hairline bg-paper-dim/40 px-4 py-3 text-sm"
        >
          <span className="text-ink">
            {r.source_kind === "warehouse" ? warehouseName(r.source_id) : facilityName(r.source_facility_id)} →{" "}
            {facilityName(r.target_facility_id)}
          </span>
          <span className="text-ink-soft">{r.subject}</span>
          <span className="text-ink font-medium">{r.quantity_or_detail}</span>
          <span className="text-[11px] uppercase tracking-wider text-risk-healthy">
            {r.status}
          </span>
        </div>
      ))}
    </div>
  );
}
