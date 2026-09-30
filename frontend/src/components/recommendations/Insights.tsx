"use client";

import { ArrowRight } from "lucide-react";
import { FunnelBars } from "@/components/charts/FunnelBars";
import { HeatGrid, HeatLegend, type GridCell } from "@/components/command/HeatGrid";
import { Panel, SOURCE_SEED } from "@/components/command/Panel";
import { shortDistrict } from "@/components/command/titles";
import { cn } from "@/lib/cn";
import { useEntityIndex } from "@/lib/entity-index";
import { heatColor, type HeatScale } from "@/lib/heat";
import {
  DELAYS,
  SAVE_WINDOW,
  SHARES,
  approvalsTitle,
  funnelTitle,
  sensitivityTitle,
  whatIfTitle,
  type DistrictApprovalRow,
  type FunnelStages,
  type WhatIf,
} from "./decision-logic";

export function WhatIfStrip({ whatIf, on, onToggle }: { whatIf: WhatIf; on: boolean; onToggle: () => void }) {
  const clears = whatIf.criticalNow - whatIf.criticalAfter;
  return (
    <section
      data-testid="what-if-strip"
      className="grid gap-px overflow-hidden rounded-md border border-border bg-border shadow-[var(--inset-highlight)] md:grid-cols-[minmax(280px,1.3fr)_repeat(3,minmax(0,1fr))]"
    >
      <div className="bg-surface-1 px-4 py-3">
        <p className="eyebrow">What if</p>
        <p className="mt-0.5 text-[14px] font-semibold leading-snug text-text" data-role="action-title">
          {whatIfTitle(whatIf)}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={onToggle}
          data-testid="what-if-toggle"
          className="mt-2 inline-flex items-center gap-2 text-[12px] font-medium text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <span className={cn("relative inline-block h-4 w-7 rounded-full transition-colors", on ? "bg-brand" : "bg-surface-3")} aria-hidden>
            <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-[var(--bg)] transition-all", on ? "left-3.5" : "left-0.5")} />
          </span>
          Approve all critical
        </button>
      </div>
      <Projected label="Critical facilities" now={whatIf.criticalNow} after={whatIf.criticalAfter} on={on} note={on ? `${clears} leave the critical list` : "toggle to project"} />
      <Projected label="Stock-out lines under 3 days" now={whatIf.stockoutsNow} after={whatIf.stockoutsAfter} on={on} note={on ? `${whatIf.stockoutsNow - whatIf.stockoutsAfter} lines covered` : "toggle to project"} />
      <div className="bg-surface-1 px-4 py-3">
        <p className="eyebrow">Recommendations approved</p>
        <p className="num mt-2 text-[26px] font-semibold leading-none text-text">{on ? whatIf.approved : 0}</p>
        <p className="mt-2 text-[11px] text-muted">Critical stock recommendations only. Source: pending queue and current stock cover.</p>
      </div>
    </section>
  );
}

function Projected({ label, now, after, on, note }: { label: string; now: number; after: number; on: boolean; note: string }) {
  return (
    <div className="bg-surface-1 px-4 py-3">
      <p className="eyebrow">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="num text-[26px] font-semibold leading-none text-text">{now}</span>
        <ArrowRight size={16} className={on ? "text-brand" : "text-faint"} aria-hidden />
        <span className={cn("num text-[26px] font-semibold leading-none", on ? "text-brand" : "text-faint")} data-testid={`projected-${label.split(" ")[0].toLowerCase()}`}>
          {on ? after : "?"}
        </span>
      </div>
      <p className="mt-2 text-[11px] text-muted">{note}</p>
    </div>
  );
}

export function FunnelCard({ stages }: { stages: FunnelStages }) {
  return (
    <Panel
      eyebrow="Recommendation funnel"
      title={funnelTitle(stages)}
      testId="card-funnel"
      read="Read: each bar is a share of everything generated; the drop between bars is where decisions stall."
      source={`${SOURCE_SEED}; recommendation and shipment status`}
      section="Recommendations / Funnel"
    >
      <FunnelBars
        stages={[
          { label: "Generated", value: stages.generated },
          { label: "Approved", value: stages.approved },
          { label: "Dispatched", value: stages.dispatched },
          { label: "Fulfilled", value: stages.fulfilled },
        ]}
      />
    </Panel>
  );
}

export function ApprovalsByDistrictCard({ rows }: { rows: DistrictApprovalRow[] }) {
  const index = useEntityIndex();
  const name = (id: string) => shortDistrict(index.districtName(id));
  const max = Math.max(1, ...rows.map((r) => r.pending + r.moving + r.completed + r.closed));
  return (
    <Panel
      eyebrow="Approvals by district"
      title={approvalsTitle(rows, name)}
      testId="card-by-district"
      read="Read: bar segments are pending, moving, completed and closed; approval rate is approved over approved plus rejected."
      source={`${SOURCE_SEED}; all recommendation statuses`}
      section="Recommendations / Districts"
      bodyClassName="px-0"
    >
      <table className="w-full border-collapse text-[12px]">
        <thead className="bg-surface-2">
          <tr className="text-left text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
            <th className="py-1.5 pl-4 pr-1">District</th>
            <th className="px-1 py-1.5">Mix</th>
            <th className="px-1 py-1.5 text-right">Wait</th>
            <th className="py-1.5 pl-1 pr-4 text-right">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const seg = [
              { k: "pending", n: r.pending, c: "var(--amber)" },
              { k: "moving", n: r.moving, c: "var(--status-in-transit)" },
              { k: "completed", n: r.completed, c: "var(--green)" },
              { k: "closed", n: r.closed, c: "var(--text-faint)" },
            ];
            return (
              <tr key={r.districtId} className="border-t border-border">
                <td className="py-1.5 pl-4 pr-1 text-text">{name(r.districtId)}</td>
                <td className="px-1 py-1.5">
                  <span className="flex h-2.5 w-full min-w-24 overflow-hidden rounded-[3px] bg-surface-2">
                    {seg.map((s) =>
                      s.n > 0 ? (
                        <span key={s.k} title={`${s.k}: ${s.n}`} style={{ width: `${(s.n / max) * 100}%`, backgroundColor: s.c, borderRight: "2px solid var(--surface-1)" }} />
                      ) : null,
                    )}
                  </span>
                </td>
                <td className="num px-1 py-1.5 text-right">{r.pending}</td>
                <td className="num py-1.5 pl-1 pr-4 text-right">{r.approvalRate === null ? "n/a" : `${Math.round(r.approvalRate * 100)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2 text-[10px] text-muted">
        {[["Pending", "var(--amber)"], ["Moving", "var(--status-in-transit)"], ["Completed", "var(--green)"], ["Closed", "var(--text-faint)"]].map(([l, c]) => (
          <li key={l} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: c }} />
            {l}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const BASE = { share: 50, delay: 60 };

export function SensitivityCard({ grid, criticalNow }: { grid: number[][]; criticalNow: number }) {
  const scale: HeatScale = {
    thresholds: [0.25, 0.5, 0.75, 0.99].map((f) => f * Math.max(1, criticalNow)) as [number, number, number, number],
    higherIsWorse: true,
  };
  const rows = SHARES.map((s) => ({ id: String(s), label: `${s}% approved` }));
  const cols = DELAYS.map((d) => ({ id: String(d), label: d === 0 ? "on time" : `+${d} min`, title: `${d} minutes late` }));
  const cell = (r: string, c: string): GridCell => {
    const v = grid[SHARES.indexOf(Number(r) as (typeof SHARES)[number])]?.[DELAYS.indexOf(Number(c) as (typeof DELAYS)[number])];
    if (v === undefined) return null;
    return {
      text: String(v),
      color: heatColor(v, scale),
      tip: `${r}% of pending stock recommendations approved, trucks ${c} min late: ${v} critical facilities at day 3`,
      emphasis: Number(r) === BASE.share && Number(c) === BASE.delay,
    };
  };
  return (
    <Panel
      eyebrow="Sensitivity, critical facilities at day 3"
      title={sensitivityTitle(grid)}
      testId="card-sensitivity"
      read={`Read: rows are the share of pending recommendations approved, columns the average delivery delay. Outlined cell is the typical case (${BASE.share}% approved, ${BASE.delay} min late). Model: a truck only saves a facility if it lands within ${SAVE_WINDOW * 100}% of that facility's remaining cover.`}
      source={`${SOURCE_SEED}; illustrative model, client side`}
      section="Recommendations / Scenarios"
    >
      <HeatGrid ariaLabel="Sensitivity matrix" rows={rows} cols={cols} cell={cell} rowHeight={22} labelWidth={96} cellWidth={36} radixTips />
      <HeatLegend labels={["few", "", "", "", "many critical"]} />
    </Panel>
  );
}
