"use client";

import { useMemo } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { useMedicines } from "@/lib/api/hooks";
import type { FacilityView } from "@/lib/facility-view";
import { riskColor, riskLabel } from "@/data/district";

export function FacilityDrawer({
  facility,
  onClose,
}: {
  facility: FacilityView | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useMedicines("all");
  const id = facility?.id;
  const stock = useMemo(() => (data?.medicines ?? []).filter((m) => m.facility_id === id), [data, id]);
  const loading = !!facility && (isLoading || data === undefined);

  return (
    <Drawer
      open={!!facility}
      onClose={onClose}
      eyebrow={facility?.type}
      title={facility?.name ?? ""}
    >
      {facility && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: riskColor[facility.riskLevel] }}
            />
            <span className="text-sm font-medium" style={{ color: riskColor[facility.riskLevel] }}>
              {riskLabel[facility.riskLevel]}
            </span>
          </div>

          {facility.performance && (
          <div>
            <p className="text-[11px] tracking-[0.14em] uppercase text-ink-soft mb-2">
              Performance Scorecard
            </p>
            <div className="grid grid-cols-3 gap-2 text-sm">
              {Object.entries(facility.performance).map(([key, value]) => (
                <div key={key} className="border border-hairline px-3 py-2">
                  <p className="text-[10px] uppercase text-ink-soft tracking-wider">
                    {key.replace(/([A-Z])/g, " $1")}
                  </p>
                  <p className="font-serif-display text-lg tabular text-ink">{value}</p>
                </div>
              ))}
            </div>
          </div>
          )}

          {loading && <SkeletonBlock rows={4} />}

          {!loading && stock.length > 0 && (
            <div>
              <p className="text-[11px] tracking-[0.14em] uppercase text-ink-soft mb-2">
                Medicine Stock
              </p>
              <div className="space-y-2">
                {stock.map((m) => (
                  <div key={m.medicine_name} className="border border-hairline px-3 py-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-ink font-medium">{m.medicine_name}</span>
                      <span className="text-ink-soft">{m.days_remaining} days left</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && stock.length === 0 && (
            <p className="text-xs text-ink-soft italic">
              No medicine stock data for this facility yet.
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}
