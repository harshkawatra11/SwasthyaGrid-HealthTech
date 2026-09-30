import type { ReactNode } from "react";
import { fmtInt } from "@/lib/format";

export type TooltipEntry = {
  name?: string | number;
  value?: number | string | null;
  color?: string;
  dataKey?: string | number;
  payload?: { fill?: string } & Record<string, unknown>;
};

export type ChartTooltipProps = {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
  /** Formats the heading (usually the x value). */
  labelFormatter?: (label: string | number) => ReactNode;
  /** Formats each value; default is en-IN integer grouping. */
  valueFormatter?: (value: number, name: string) => string;
  unit?: string;
};

/** Recharts `content` component: surface-2 card, strong border, 8px radius, values in mono. */
export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter, unit }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const fmt = valueFormatter ?? ((v: number) => fmtInt(v));
  return (
    <div
      role="tooltip"
      className="min-w-32 rounded-[8px] border border-border-strong bg-surface-2 px-3 py-2 text-[12px] shadow-[var(--shadow-overlay)]"
    >
      {label !== undefined && label !== "" && (
        <p className="mb-1.5 font-semibold text-text">{labelFormatter ? labelFormatter(label) : label}</p>
      )}
      <ul className="space-y-1">
        {payload.map((p, i) => {
          const name = String(p.name ?? p.dataKey ?? "");
          const swatch = p.color ?? p.payload?.fill;
          const raw = p.value;
          const text = typeof raw === "number" ? fmt(raw, name) : raw == null ? "n/a" : String(raw);
          return (
            <li key={`${name}-${i}`} className="flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: swatch }} />
              <span className="text-muted">{name}</span>
              <span className="num ml-auto pl-4 text-text">
                {text}
                {unit && typeof raw === "number" ? <span className="text-faint"> {unit}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
