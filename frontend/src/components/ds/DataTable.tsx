"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { sortRows, type SortDir } from "@/lib/sort";

export type Column<T> = {
  key: string;
  header: string;
  accessor: (r: T) => unknown;
  cell?: (r: T) => ReactNode;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  width?: number | string;
  mono?: boolean;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  initialSort?: { key: string; dir: SortDir };
  density?: "compact" | "normal";
  stickyHeader?: boolean;
  empty?: ReactNode;
  maxHeight?: number;
};

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

/** Pure helper used by the component and its tests. */
export function sortByColumn<T>(rows: T[], columns: Column<T>[], sort: { key: string; dir: SortDir } | null): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col) return rows;
  return sortRows(rows, col.accessor, sort.dir);
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  initialSort,
  density = "normal",
  stickyHeader = true,
  empty,
  maxHeight,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);
  const sorted = useMemo(() => sortByColumn(rows, columns, sort), [rows, columns, sort]);
  const pad = density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";

  function toggle(col: Column<T>) {
    if (!col.sortable) return;
    setSort((s) =>
      s && s.key === col.key ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: col.key, dir: "asc" },
    );
  }

  return (
    <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-[13px]">
        <thead className={cn("bg-surface-2", stickyHeader && "sticky top-0 z-10")}>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const ariaSort = active ? (sort?.dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  style={c.width !== undefined ? { width: c.width } : undefined}
                  className={cn(
                    "border-b border-border text-[11px] font-medium uppercase tracking-[0.12em] text-muted",
                    pad,
                    ALIGN[c.align ?? "left"],
                  )}
                >
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      className={cn(
                        "inline-flex items-center gap-1 uppercase tracking-[0.12em] hover:text-text",
                        c.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {c.header}
                      {active ? (
                        sort?.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                      ) : (
                        <ChevronsUpDown size={11} className="text-faint" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={rowKey(r)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter") onRowClick(r);
                    }
                  : undefined
              }
              className={cn("border-b border-border last:border-b-0 hover:bg-surface-3", onRowClick && "cursor-pointer")}
            >
              {columns.map((c) => {
                return (
                  <td
                    key={c.key}
                    className={cn(pad, ALIGN[c.align ?? "left"], (c.mono || c.align === "right") && "num")}
                  >
                    {c.cell ? c.cell(r) : String(c.accessor(r) ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && (empty ?? <p className="px-4 py-8 text-center text-[12px] text-muted">No rows.</p>)}
    </div>
  );
}
