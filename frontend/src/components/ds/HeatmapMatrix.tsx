"use client";

import Link from "next/link";
import { Fragment } from "react";
import { heatColor, heatLegend, type HeatScale } from "@/lib/heat";
import { Tooltip } from "./Tooltip";

export type HeatRow = { id: string; label: string; group?: string; href?: string };
export type HeatCol = { id: string; label: string };

export type HeatmapMatrixProps = {
  rows: HeatRow[];
  cols: HeatCol[];
  value: (rowId: string, colId: string) => number | null;
  scale: HeatScale;
  format?: (v: number) => string;
  cellSize?: number;
  onCellClick?: (rowId: string, colId: string) => void;
};

export function HeatmapMatrix({ rows, cols, value, scale, format = String, cellSize = 28, onCellClick }: HeatmapMatrixProps) {
  const template = `minmax(120px, 200px) repeat(${cols.length}, ${cellSize}px)`;
  const legend = heatLegend(scale, format);

  return (
    <div className="overflow-x-auto">
      <div role="table" className="inline-grid gap-px text-[12px]" style={{ gridTemplateColumns: template }}>
        <div />
        {cols.map((c) => (
          <div key={c.id} className="truncate pb-1 text-center text-[10px] text-muted" title={c.label}>
            {c.label}
          </div>
        ))}
        {rows.map((r, idx) => {
          const showGroup = r.group !== undefined && r.group !== rows[idx - 1]?.group;
          return (
            <Fragment key={r.id}>
              {showGroup && (
                <div className="eyebrow col-span-full mt-2 pb-1" style={{ gridColumn: "1 / -1" }}>
                  {r.group}
                </div>
              )}
              <div className="truncate pr-2 leading-[inherit] text-text" style={{ height: cellSize, lineHeight: `${cellSize}px` }}>
                {r.href ? (
                  <Link href={r.href} className="hover:text-brand">
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
              </div>
              {cols.map((c) => {
                const v = value(r.id, c.id);
                const cell = (
                  <button
                    type="button"
                    aria-label={`${r.label}, ${c.label}: ${v === null ? "no data" : format(v)}`}
                    onClick={onCellClick ? () => onCellClick(r.id, c.id) : undefined}
                    className="block w-full rounded-[3px] border-0 p-0"
                    style={{ height: cellSize, backgroundColor: heatColor(v, scale), cursor: onCellClick ? "pointer" : "default" }}
                  />
                );
                return (
                  <Tooltip
                    key={c.id}
                    content={
                      <span>
                        {r.label} / {c.label}: <span className="num">{v === null ? "no data" : format(v)}</span>
                      </span>
                    }
                  >
                    {cell}
                  </Tooltip>
                );
              })}
            </Fragment>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-muted" aria-label="Legend">
        {legend.map((label, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: `var(--heat-${i})` }} />
            <span className="num">{label}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: "var(--heat-empty)" }} />
          no data
        </span>
      </div>
    </div>
  );
}
