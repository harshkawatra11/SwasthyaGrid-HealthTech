"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { RiskMixBar } from "@/components/districts/kit";
import { RiskChip } from "@/components/ds/RiskChip";
import { StatBlock } from "@/components/ds/StatBlock";
import { StatusChip } from "@/components/ds/StatusChip";
import { Stepper } from "@/components/ds/Stepper";
import { stepsFor } from "@/components/facilities/case";
import type { DistrictSummaryRow, Facility, ShipmentSummary } from "@/lib/api/types";
import { fmtDateTime } from "@/lib/format";
import { districtActionTitle, shipmentActionTitle, type Selection } from "./console";

/** Right drawer: shows the action-title finding and charts for whatever the map selected. */
export function SelectionDrawer({
  selection,
  districts,
  facility,
  shipment,
  onClose,
}: {
  selection: Selection;
  districts: readonly DistrictSummaryRow[];
  facility: Facility | null;
  shipment: ShipmentSummary | null;
  onClose: () => void;
}) {
  const district = selection.kind === "district" ? districts.find((d) => d.district_id === selection.id) : undefined;

  return (
    <aside aria-label="Selection details" className="flex w-[300px] shrink-0 flex-col rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)]">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="eyebrow">{selection.kind === "district" ? "District" : selection.kind === "facility" ? "Facility" : "Shipment"}</p>
          <h3 className="mt-0.5 text-[13px] font-semibold leading-snug text-text">
            {selection.kind === "district" && district ? districtActionTitle(district, districts) : null}
            {selection.kind === "district" && !district ? "Loading district…" : null}
            {selection.kind === "facility" && facility ? `${facility.name}, ${facility.type}` : null}
            {selection.kind === "facility" && !facility ? "Loading facility…" : null}
            {selection.kind === "shipment" && shipment ? shipmentActionTitle(shipment) : null}
            {selection.kind === "shipment" && !shipment ? "Loading shipment…" : null}
          </h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close drawer" className="rounded-sm p-1 text-muted hover:bg-surface-2 hover:text-text">
          <X size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {selection.kind === "district" && district && (
          <>
            <RiskMixBar counts={district.risk_counts} showLegend />
            <StatBlock
              columns={2}
              items={[
                { label: "Facilities", value: district.facilities, mono: true },
                { label: "Stock-out items", value: district.stockout_items, mono: true },
                { label: "Bed occupancy", value: `${Math.round(district.bed_occupancy_avg)}%`, mono: true },
                { label: "Doctors at risk", value: district.doctors_high_risk, mono: true },
                { label: "Recs pending", value: district.pending_recommendations, mono: true },
                { label: "Footfall tomorrow", value: district.footfall_tomorrow, mono: true },
              ]}
            />
            {district.critical_facilities.length > 0 && (
              <div>
                <p className="eyebrow mb-1">Critical facilities</p>
                <ul className="space-y-1">
                  {district.critical_facilities.map((f) => (
                    <li key={f.id}>
                      <Link href={`/facilities/${f.id}`} className="text-[12px] text-text hover:text-brand">
                        {f.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link href={`/districts/${district.district_id}`} className="inline-block text-[12px] text-brand hover:underline">
              Open the {district.name} deep dive
            </Link>
          </>
        )}

        {selection.kind === "facility" && facility && (
          <>
            <div className="flex items-center gap-2">
              <RiskChip level={facility.risk_level} />
              <span className="rounded-sm bg-surface-3 px-2 py-1 text-[12px] text-muted">{facility.type}</span>
            </div>
            <StatBlock columns={2} items={[{ label: "Beds", value: facility.beds_total, mono: true }]} />
            <Link href={`/facilities/${facility.id}`} className="inline-block text-[12px] text-brand hover:underline">
              Open the facility case file
            </Link>
          </>
        )}

        {selection.kind === "shipment" && shipment && (
          <>
            <div className="flex items-center justify-between">
              <StatusChip status={shipment.status} size="sm" live />
              {shipment.delay_minutes > 0 && <span className="num text-[12px] text-risk-stress">{shipment.delay_minutes} min late</span>}
            </div>
            <Stepper steps={stepsFor(shipment.status)} />
            <p className="text-[12px] text-muted">{shipment.lines_summary}</p>
            <p className="text-[11px] text-muted">
              {shipment.origin.name} to {shipment.destination.name}
            </p>
            {shipment.eta && <p className="num text-[11px] text-faint">ETA {fmtDateTime(shipment.eta)}</p>}
            <Link href={`/supply/shipments/${shipment.id}`} className="inline-block text-[12px] text-brand hover:underline">
              Open the shipment tracker
            </Link>
          </>
        )}
      </div>
    </aside>
  );
}
