import type { ReactNode } from "react";

/** Series colours come from tokens only, in fixed order. */
export const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export const AXIS_TICK = { fontSize: 11, fill: "var(--text-faint)" } as const;
export const GRID_PROPS = { stroke: "var(--border)", strokeDasharray: "2 4", vertical: false } as const;
export const CURSOR_LINE = { stroke: "var(--border-strong)", strokeWidth: 1 } as const;
export const CURSOR_BAND = { fill: "var(--surface-3)", fillOpacity: 0.5 } as const;
export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;

export type LegendItem = { label: string; color: string; dashed?: boolean };

/** HTML legend: the swatch carries identity, the text stays in text tokens. Shown for two or more series. */
export function ChartLegend({ items }: { items: LegendItem[] }): ReactNode {
  if (items.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-0.5 w-3.5 rounded-full"
            style={{
              background: it.dashed ? "transparent" : it.color,
              borderTop: it.dashed ? `2px dashed ${it.color}` : undefined,
              height: it.dashed ? 0 : undefined,
            }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure role="group" aria-label={label} className="m-0">
      {children}
    </figure>
  );
}

export type Series = { key: string; name: string; color?: string; dashed?: boolean };
