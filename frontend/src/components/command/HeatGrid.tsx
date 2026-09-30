"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Tooltip } from "@/components/ds/Tooltip";
import { cn } from "@/lib/cn";

export type GridRow = { id: string; label: string; group?: string; groupNote?: ReactNode; href?: string; sub?: ReactNode; trailing?: ReactNode };
export type GridCol = { id: string; label: string; title?: string };
export type GridCell = { text: string; color: string; tip?: string; emphasis?: boolean } | null;

/**
 * Dense heat grid with values written inside the cells (so it reads without colour) and optional
 * group header rows. Cells are buttons when `onCell` is given, otherwise plain blocks.
 */
export function HeatGrid({
  rows,
  cols,
  cell,
  onCell,
  rowHeight = 20,
  cellWidth = 52,
  labelWidth = 150,
  radixTips = false,
  trailingWidth,
  cellMax,
  ariaLabel,
}: {
  rows: GridRow[];
  cols: GridCol[];
  cell: (rowId: string, colId: string) => GridCell;
  onCell?: (rowId: string, colId: string) => void;
  rowHeight?: number;
  cellWidth?: number;
  labelWidth?: number;
  radixTips?: boolean;
  trailingWidth?: number;
  cellMax?: number;
  ariaLabel: string;
}) {
  const template = `${labelWidth}px repeat(${cols.length}, minmax(${cellWidth}px, ${cellMax ? `${cellMax}px` : "1fr"}))${trailingWidth ? ` ${trailingWidth}px` : ""}`;
  return (
    <div className="overflow-x-auto">
      <div role="table" aria-label={ariaLabel} className="grid gap-[2px] text-[11px]" style={{ gridTemplateColumns: template, minWidth: labelWidth + cols.length * cellWidth }}>
        <div role="row" className="contents">
          <div />
          {cols.map((c) => (
            <div key={c.id} role="columnheader" title={c.title ?? c.label} className="truncate pb-1 text-center text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              {c.label}
            </div>
          ))}
          {trailingWidth ? <div /> : null}
        </div>
        {rows.map((r, idx) => {
          const showGroup = r.group !== undefined && r.group !== rows[idx - 1]?.group;
          return (
            <Fragment key={r.id}>
              {showGroup && (
                <div role="row" className="flex items-center justify-between border-b border-border pb-0.5 pt-2" style={{ gridColumn: "1 / -1" }}>
                  <span className="eyebrow">{r.group}</span>
                  {r.groupNote && <span className="text-[10px] text-faint">{r.groupNote}</span>}
                </div>
              )}
              <div role="row" className="contents">
                <div role="rowheader" className="flex min-w-0 items-center gap-1.5 pr-1 text-[12px] text-text" style={{ height: rowHeight }}>
                  {r.href ? (
                    <Link href={r.href} className="truncate hover:text-brand">
                      {r.label}
                    </Link>
                  ) : (
                    <span className="truncate">{r.label}</span>
                  )}
                  {r.sub}
                </div>
                {cols.map((c) => {
                  const v = cell(r.id, c.id);
                  const inner = (
                    <button
                      type="button"
                      tabIndex={onCell ? 0 : -1}
                      aria-label={`${r.label}, ${c.label}: ${v?.text ?? "no data"}`}
                      title={radixTips ? undefined : v?.tip ?? `${r.label}, ${c.title ?? c.label}: ${v?.text ?? "no data"}`}
                      onClick={onCell ? () => onCell(r.id, c.id) : undefined}
                      className={cn(
                        "num flex w-full items-center justify-center rounded-[3px] border-0 p-0 text-[10.5px] font-medium leading-none text-text",
                        v?.emphasis && "outline outline-1 -outline-offset-1 outline-[var(--text)]",
                        onCell ? "cursor-pointer hover:brightness-110" : "cursor-default",
                      )}
                      style={{ height: rowHeight, backgroundColor: v?.color ?? "var(--heat-empty)" }}
                    >
                      {v?.text ?? "-"}
                    </button>
                  );
                  return radixTips ? (
                    <Tooltip key={c.id} content={<span className="num">{v?.tip ?? `${r.label}, ${c.label}: ${v?.text ?? "no data"}`}</span>}>
                      {inner}
                    </Tooltip>
                  ) : (
                    <div key={c.id}>{inner}</div>
                  );
                })}
                {trailingWidth ? (
                  <div className="flex items-center justify-end" style={{ height: rowHeight }}>
                    {r.trailing}
                  </div>
                ) : null}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function HeatLegend({ labels, note }: { labels: string[]; note?: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted" aria-label="Legend">
      {labels.map((l, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: `var(--heat-${i})` }} />
          <span className="num">{l}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: "var(--heat-empty)" }} />
        none
      </span>
      {note && <span className="text-faint">{note}</span>}
    </div>
  );
}
