"use client";

import { fmtInt } from "@/lib/format";
import { seriesColor } from "./common";

export type FunnelStage = { label: string; value: number };

/** Percent of the first stage, rounded to one decimal; 0 when the first stage is 0. */
export function funnelShare(value: number, first: number): number {
  return first > 0 ? Math.round((value / first) * 1000) / 10 : 0;
}

/**
 * Horizontal funnel: one bar per stage, width proportional to the value, each stage labelled with
 * its count and its share of the first stage. Plain HTML so the labels are real text.
 */
export function FunnelBars({
  stages,
  color = seriesColor(0),
  label = "Funnel",
}: {
  stages: FunnelStage[];
  color?: string;
  label?: string;
}) {
  const first = stages[0]?.value ?? 0;
  return (
    <ol aria-label={label} className="space-y-2">
      {stages.map((s, i) => {
        const share = funnelShare(s.value, first);
        return (
          <li key={s.label} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-[12px]">
            <span className="truncate text-muted">{s.label}</span>
            <span className="block h-4 rounded-[4px] bg-surface-2" title={`${s.label}: ${fmtInt(s.value)} (${share}%)`}>
              <span
                className="block h-full rounded-[4px]"
                style={{ width: `${Math.max(share, s.value > 0 ? 1 : 0)}%`, background: color, opacity: 1 - i * 0.12 }}
              />
            </span>
            <span className="num text-text">
              {fmtInt(s.value)}
              <span className="ml-1.5 text-faint">{share}%</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
