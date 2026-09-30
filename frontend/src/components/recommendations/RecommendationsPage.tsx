"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ds/PageHeader";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { Skeleton } from "@/components/ds/Skeleton";
import { useFacilities, useMedicines, useRecommendations, useShipments, useWarehouses } from "@/lib/api/hooks";
import type { RecommendationV2 } from "@/lib/api/types";
import { DISTRICT_IDS, useScope } from "@/lib/scope";
import { DecisionBoard } from "./Board";
import { ApprovalsByDistrictCard, FunnelCard, SensitivityCard, WhatIfStrip } from "./Insights";
import { approvalsByDistrict, boardTitle, byColumn, funnel, sensitivityGrid, whatIf } from "./decision-logic";

type TypeFilter = "all" | RecommendationV2["type"];
type PriorityFilter = "all" | RecommendationV2["priority"];

const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All types" },
  { value: "replenishment", label: "Replenishment" },
  { value: "stock_transfer", label: "Transfer" },
  { value: "bed_redirect", label: "Beds" },
  { value: "staff_transfer", label: "Staff" },
];

const PRIORITY_OPTIONS: Array<{ value: PriorityFilter; label: string }> = [
  { value: "all", label: "All priorities" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
];

export function RecommendationsPage() {
  const { scope } = useScope();
  const [type, setType] = useState<TypeFilter>("all");
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [projectOn, setProjectOn] = useState(false);

  const recsData = useRecommendations({}).data?.recommendations;
  const facilities = useFacilities("all").data?.facilities;
  const medicines = useMedicines("all").data?.medicines;
  const warehouses = useWarehouses("all").data?.items;
  const shipments = useShipments({ limit: 200 }).data?.items;

  const scoped = useMemo(() => (recsData ?? []).filter((r) => scope === "all" || r.district_id === scope), [recsData, scope]);
  const visible = useMemo(
    () => scoped.filter((r) => (type === "all" || r.type === type) && (priority === "all" || r.priority === priority)),
    [scoped, type, priority],
  );
  const columns = useMemo(() => byColumn(visible), [visible]);
  const fac = useMemo(() => (facilities ?? []).filter((f) => scope === "all" || f.district_id === scope), [facilities, scope]);
  const meds = useMemo(() => (medicines ?? []).filter((m) => scope === "all" || m.district_id === scope || fac.some((f) => f.id === m.facility_id)), [medicines, fac, scope]);
  const pendingScoped = useMemo(() => scoped.filter((r) => r.status === "pending"), [scoped]);

  const stages = useMemo(() => funnel(scoped), [scoped]);
  const byDistrict = useMemo(() => approvalsByDistrict(recsData ?? [], [...DISTRICT_IDS]), [recsData]);
  const projection = useMemo(() => whatIf(fac, meds, pendingScoped), [fac, meds, pendingScoped]);
  const grid = useMemo(() => sensitivityGrid(fac, meds, pendingScoped), [fac, meds, pendingScoped]);

  const ready = recsData !== undefined && facilities !== undefined;
  const title = ready ? boardTitle(byColumn(scoped)) : "Loading recommendations";

  const filters = (
    <div className="flex flex-wrap items-center gap-3" data-testid="rec-filters">
      <SegmentedControl ariaLabel="Type" value={type} onChange={setType} options={TYPE_OPTIONS} />
      <SegmentedControl ariaLabel="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
      <span className="num text-[12px] text-muted">
        Showing {visible.length} of {scoped.length}
      </span>
    </div>
  );

  return (
    <div
      className="mx-auto flex max-w-[1680px] flex-col gap-3 lg:h-[calc(100dvh-136px)] lg:overflow-hidden"
      data-testid="recommendations-page"
      data-scope={scope}
    >
      <PageHeader eyebrow="Decision desk" title={title} actions={filters} className="mb-0" />

      {!ready ? (
        <div className="grid gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[420px]" />
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <WhatIfStrip whatIf={projection} on={projectOn} onToggle={() => setProjectOn((v) => !v)} />
          <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-12">
            <div className="h-full min-h-0 xl:col-span-9">
              <DecisionBoard
                columns={columns}
                ctx={{ facilities: facilities ?? [], warehouses: warehouses ?? [], medicines: medicines ?? [], shipments: shipments ?? [] }}
              />
            </div>
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto xl:col-span-3">
              <FunnelCard stages={stages} />
              <ApprovalsByDistrictCard rows={byDistrict} />
              <SensitivityCard grid={grid} criticalNow={projection.criticalNow} />
            </div>
          </div>
          <p className="text-[11px] text-faint">
            Simulated operational data. Recommendations are generated from seed health data; projections are illustrative and computed in the browser.
          </p>
        </div>
      )}
    </div>
  );
}
