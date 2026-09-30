"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { fmtInt } from "@/lib/format";
import { heatBin, heatColor, heatLegend } from "@/lib/heat";
import type { FacilityMatrix, MedicineMatrix, StateSummary } from "@/lib/api/types";
import type { RiskLevel } from "@/lib/domain";
import { HeatGrid, HeatLegend, type GridCell, type GridCol, type GridRow } from "./HeatGrid";
import { Panel, PanelSkeleton, SOURCE_SEED } from "./Panel";
import {
  COVER_SCALE,
  DIM_SHORT,
  breachCount,
  facilityMatrixTitle,
  formatDim,
  medicineHotspot,
  meanBands,
  medicineTitle,
  shortDistrict,
  shortMedicine,
} from "./titles";

const WORD_LEGEND = ["best", "good", "watch", "poor", "worst"];

export function FacilityMatrixCard({
  matrix,
  summary,
  stateMatrix,
  scoped,
}: {
  matrix: FacilityMatrix | undefined;
  summary: StateSummary | undefined;
  stateMatrix?: FacilityMatrix;
  scoped?: boolean;
}) {
  const router = useRouter();
  const view = useMemo(() => {
    if (!matrix || !summary) return null;
    const order = summary.districts.map((d) => d.district_id);
    const rows = [...matrix.rows].sort(
      (a, b) => order.indexOf(a.district_id) - order.indexOf(b.district_id),
    );
    const names = new Map(summary.districts.map((d) => [d.district_id, d]));
    const gridRows: GridRow[] = rows.map((r) => {
      const d = names.get(r.district_id);
      return {
        id: r.facility_id,
        label: r.facility_name,
        group: d ? shortDistrict(d.name) : r.district_id,
        groupNote: d ? `${d.risk_counts.critical} critical of ${d.facilities}` : undefined,
        href: `/facilities/${r.facility_id}`,
        trailing: <BreachDots n={breachCount(r.values, matrix.dimensions)} level={r.risk_level} />,
      };
    });
    const byId = new Map(rows.map((r) => [r.facility_id, r]));
    const dims = new Map(matrix.dimensions.map((d) => [d.id, d]));
    const cols: GridCol[] = matrix.dimensions.map((d) => ({ id: d.id, label: DIM_SHORT[d.id] ?? d.label, title: d.label }));
    const cell = (rowId: string, colId: string): GridCell => {
      const dim = dims.get(colId);
      const v = byId.get(rowId)?.values[colId] ?? null;
      if (!dim || v === null) return { text: "-", color: "var(--heat-empty)", tip: `${byId.get(rowId)?.facility_name}: ${dim?.label} not available` };
      const scale = { thresholds: dim.thresholds as [number, number, number, number], higherIsWorse: dim.higher_is_worse };
      return {
        text: formatDim(colId, v),
        color: heatColor(v, scale),
        tip: `${byId.get(rowId)?.facility_name}: ${dim.label} ${formatDim(colId, v)} (${dim.unit}), band ${heatBin(v, scale)} of 4`,
      };
    };
    return { gridRows, cols, cell, matrix };
  }, [matrix, summary]);

  if (!view) return <PanelSkeleton className="lg:col-span-8" lines={14} />;

  return (
    <Panel
      className="lg:col-span-8"
      eyebrow="Facility risk matrix"
      title={facilityMatrixTitle(view.matrix)}
      testId="card-facility-matrix"
      read="Read: each row is a facility, grouped by district; the dots at the right count dimensions in the two worst bands. Click a cell to open the facility."
      source={`${SOURCE_SEED}; bands per dimension threshold`}
      section="Command / Facilities"
    >
      <div className="max-h-[400px] overflow-y-auto">
        <HeatGrid
          ariaLabel="Facility risk matrix"
          rows={view.gridRows}
          cols={view.cols}
          cell={view.cell}
          onCell={(rowId) => router.push(`/facilities/${rowId}`)}
          rowHeight={16}
          labelWidth={132}
          cellWidth={54}
          trailingWidth={64}
        />
      </div>
      <HeatLegend labels={WORD_LEGEND} note="Cover is days of stock, lower is worse; other columns higher is worse except score" />
      {scoped && stateMatrix && <PeerComparison matrix={view.matrix} stateMatrix={stateMatrix} />}
    </Panel>
  );
}

function BreachDots({ n, level }: { n: number; level: RiskLevel }) {
  return (
    <span className="inline-flex items-center gap-[3px]" title={`${n} of 6 dimensions in the two worst bands`}>
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: i < n ? `var(--risk-${level === "healthy" ? "monitor" : level})` : "var(--surface-3)" }}
        />
      ))}
    </span>
  );
}

export function MedicineMatrixCard({ matrix }: { matrix: MedicineMatrix | undefined }) {
  const router = useRouter();
  const view = useMemo(() => {
    if (!matrix) return null;
    const rows: GridRow[] = matrix.medicines.map((m) => ({
      id: m.name,
      label: shortMedicine(m.name),
      sub: m.emergency ? (
        <span className="rounded-[3px] bg-surface-3 px-1 text-[9px] font-semibold uppercase text-muted" title="Emergency medicine">
          E
        </span>
      ) : null,
    }));
    const cols: GridCol[] = matrix.districts.map((d) => ({ id: d.id, label: shortDistrict(d.name).slice(0, 7), title: d.name }));
    const cells = new Map(matrix.cells.map((c) => [`${c.medicine_name}|${c.district_id}`, c]));
    const cell = (rowId: string, colId: string): GridCell => {
      const c = cells.get(`${rowId}|${colId}`);
      if (!c || c.min_days_remaining === null) return null;
      return {
        text: c.min_days_remaining.toFixed(1),
        color: heatColor(c.min_days_remaining, COVER_SCALE),
        tip: `${shortMedicine(rowId)}, ${cols.find((x) => x.id === colId)?.title}: ${c.min_days_remaining.toFixed(1)} days at the weakest facility; ${c.facilities_below_threshold} facilities under threshold; ${fmtInt(c.total_units)} units`,
        emphasis: c.facilities_below_threshold > 0 && c.min_days_remaining < 3,
      };
    };
    return { rows, cols, cell };
  }, [matrix]);

  if (!matrix || !view) return <PanelSkeleton lines={7} />;
  const hot = medicineHotspot(matrix);

  return (
    <Panel
      eyebrow="Emergency medicine cover"
      title={medicineTitle(matrix)}
      testId="card-medicine-matrix"
      read={
        hot ? (
          <>
            Read: the outlined cell is the worst case, {hot.minDays.toFixed(1)} days at its weakest facility. Cells show the minimum days of cover.
          </>
        ) : (
          "Read: cells show the minimum days of cover at the weakest facility."
        )
      }
      source={`${SOURCE_SEED}; days = units / avg daily use`}
      section="Command / Inventory"
    >
      <HeatGrid
        ariaLabel="Medicine cover by district"
        rows={view.rows}
        cols={view.cols}
        cell={view.cell}
        onCell={() => router.push("/inventory")}
        rowHeight={26}
        labelWidth={88}
        cellWidth={40}
        cellMax={72}
        radixTips
      />
      <HeatLegend labels={heatLegend(COVER_SCALE).map((l) => l.replace(">= ", ">=").replace("< ", "<"))} note="days" />
    </Panel>
  );
}

function PeerComparison({ matrix, stateMatrix }: { matrix: FacilityMatrix; stateMatrix: FacilityMatrix }) {
  const here = meanBands(matrix);
  const state = meanBands(stateMatrix);
  return (
    <div className="mt-4 border-t border-border pt-3" data-testid="peer-comparison">
      <p className="eyebrow mb-2">This district against the state, mean heat band (0 best, 4 worst)</p>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {matrix.dimensions.map((d) => (
          <div key={d.id} className="grid grid-cols-[5rem_1fr_auto] items-center gap-2 text-[11px]">
            <span className="text-muted" title={d.label}>
              {DIM_SHORT[d.id] ?? d.label}
            </span>
            <span className="relative block h-3 rounded-[3px] bg-surface-2">
              <span className="absolute inset-y-0 left-0 rounded-[3px] bg-[var(--series-1)]" style={{ width: `${((here[d.id] ?? 0) / 4) * 100}%` }} />
              <span className="absolute inset-y-[-2px] w-0.5 bg-text" style={{ left: `${((state[d.id] ?? 0) / 4) * 100}%` }} title={`State mean ${(state[d.id] ?? 0).toFixed(1)}`} />
            </span>
            <span className="num text-text">
              {(here[d.id] ?? 0).toFixed(1)} <span className="text-faint">vs {(state[d.id] ?? 0).toFixed(1)}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">Bar is this district, the white tick is the state mean. A bar past the tick is worse than the state.</p>
    </div>
  );
}
