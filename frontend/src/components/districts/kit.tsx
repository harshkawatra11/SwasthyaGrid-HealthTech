import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { RISK_LABEL, riskVar, type RiskLevel } from "@/lib/domain";
import { heatColor, type HeatScale } from "@/lib/heat";

export const SOURCE_DEFAULT = "Source: SwasthyaGrid seed data, days of cover = units / average daily use";

/**
 * Card with an action title (a finding with a number), the metric name as eyebrow, an optional
 * "Read" caption, and a footer carrying the source (left) and the sub-section label (right).
 */
export function InsightCard({
  eyebrow,
  title,
  section,
  source = SOURCE_DEFAULT,
  read,
  actions,
  className,
  bodyClassName,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  section: string;
  source?: string;
  read?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)]",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h3 className="mt-0.5 text-[13px] font-semibold leading-snug text-text">{title}</h3>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("min-h-0 flex-1 p-4", bodyClassName)}>
        {children}
        {read && (
          <p className="mt-3 border-l-2 border-border-strong pl-2 text-[12px] leading-snug text-muted">
            <span className="font-semibold text-text">Read: </span>
            {read}
          </p>
        )}
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-1.5 text-[11px] text-faint">
        <span className="truncate">{source}</span>
        <span className="shrink-0">{section}</span>
      </footer>
    </section>
  );
}

/** Annotation callout: a small labelled note pinned to a specific data point. */
export function Callout({ tone = "default", children, className }: { tone?: "default" | "critical" | "good"; children: ReactNode; className?: string }) {
  const color = tone === "critical" ? "var(--risk-critical)" : tone === "good" ? "var(--risk-healthy)" : "var(--text-muted)";
  return (
    <span
      className={cn("inline-flex items-start gap-1.5 rounded-sm border bg-surface-2 px-2 py-1 text-[11px] leading-snug text-text", className)}
      style={{ borderColor: `color-mix(in srgb, ${color} 55%, transparent)` }}
    >
      <span aria-hidden className="mt-[3px] inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span>{children}</span>
    </span>
  );
}

/** The one hero number of a page, in the strongest colour, linking to the rows that prove it. */
export function Moneyshot({
  value,
  unit,
  label,
  href,
  tone = "critical",
}: {
  value: string | number;
  unit?: string;
  label: string;
  href?: string;
  tone?: "critical" | "brand";
}) {
  const color = tone === "critical" ? "var(--risk-critical)" : "var(--brand)";
  const inner = (
    <div className="flex items-center gap-3 rounded-md border px-4 py-2" style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)` }}>
      <span className="num text-[34px] font-semibold leading-none" style={{ color }}>
        {value}
        {unit && <span className="ml-1 text-[14px] font-normal text-muted">{unit}</span>}
      </span>
      <span className="max-w-[210px] text-[12px] leading-snug text-muted">{label}</span>
      {href && <ArrowUpRight size={14} className="shrink-0 text-muted" aria-hidden />}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** Semicircle gauge 0 to 100 (risk index style: higher is worse, coloured by heat bin). */
export function Gauge({
  value,
  scale,
  label,
  size = 120,
}: {
  value: number;
  scale: HeatScale;
  label: string;
  size?: number;
}) {
  const r = 46;
  const cx = 60;
  const cy = 60;
  const clamped = Math.min(100, Math.max(0, value));
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from / 100);
    const a1 = Math.PI * (1 - to / 100);
    const p = (a: number) => `${cx + r * Math.cos(a)} ${cy - r * Math.sin(a)}`;
    return `M ${p(a0)} A ${r} ${r} 0 ${to - from > 50 ? 1 : 0} 1 ${p(a1)}`;
  };
  const color = heatColor(clamped, scale);
  const needle = Math.PI * (1 - clamped / 100);
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 120 74" role="img" aria-label={`${label}: ${Math.round(value)} of 100`}>
      <path d={arc(0, 100)} fill="none" stroke="var(--surface-3)" strokeWidth={9} strokeLinecap="round" />
      {clamped > 0 && <path d={arc(0, clamped)} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />}
      <line
        x1={cx + (r - 14) * Math.cos(needle)}
        y1={cy - (r - 14) * Math.sin(needle)}
        x2={cx + (r + 6) * Math.cos(needle)}
        y2={cy - (r + 6) * Math.sin(needle)}
        stroke="var(--text)"
        strokeWidth={1.5}
      />
      <text x={cx} y={cy - 2} textAnchor="middle" className="num" fontSize={26} fontWeight={600} fill="var(--text)">
        {Math.round(value)}
      </text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize={9} fill="var(--text-faint)" letterSpacing="0.1em">
        {label.toUpperCase()}
      </text>
    </svg>
  );
}

const ORDER: RiskLevel[] = ["critical", "stress", "monitor", "healthy"];

/** Horizontal stacked bar of facility counts by risk level (critical first), with a 2px gap. */
export function RiskMixBar({ counts, height = 10, showLegend = false }: { counts: Record<RiskLevel, number>; height?: number; showLegend?: boolean }) {
  const total = ORDER.reduce((a, k) => a + counts[k], 0);
  return (
    <div>
      <div
        role="img"
        aria-label={ORDER.map((k) => `${counts[k]} ${RISK_LABEL[k]}`).join(", ")}
        className="flex w-full gap-0.5 overflow-hidden rounded-full"
        style={{ height }}
      >
        {total === 0 && <span className="h-full w-full bg-surface-3" />}
        {ORDER.filter((k) => counts[k] > 0).map((k) => (
          <span key={k} className="h-full" style={{ width: `${(counts[k] / total) * 100}%`, backgroundColor: riskVar(k) }} />
        ))}
      </div>
      {showLegend && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
          {ORDER.map((k) => (
            <li key={k} className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: riskVar(k) }} />
              {RISK_LABEL[k]} <span className="num text-text">{counts[k]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inline bar for a table cell: value on a 0..max track, coloured by token. */
export function InlineBar({
  value,
  max,
  color = "var(--series-1)",
  label,
  width = 64,
  labelWidth = 36,
}: {
  value: number | null;
  max: number;
  color?: string;
  label: ReactNode;
  width?: number;
  labelWidth?: number;
}) {
  const pct = value === null || max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="num text-right text-text" style={{ width: labelWidth }}>{label}</span>
      <span className="inline-block h-1.5 overflow-hidden rounded-full bg-surface-3" style={{ width }}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
    </span>
  );
}

export const RISK_INDEX_SCALE: HeatScale = { thresholds: [15, 25, 35, 50], higherIsWorse: true };
export const COVER_SCALE: HeatScale = { thresholds: [21, 14, 7, 3], higherIsWorse: false };
export const BEDS_SCALE: HeatScale = { thresholds: [60, 75, 85, 95], higherIsWorse: true };
export const PERF_SCALE: HeatScale = { thresholds: [90, 80, 70, 60], higherIsWorse: false };

export function CoverText({ days }: { days: number | null }) {
  if (days === null) return <span className="text-faint">-</span>;
  return <span className="num">{days.toFixed(1)}d</span>;
}

/** Connected flow of causes ending in the observed effect (nodes joined by arrows). */
export function CausalChain({ headline, steps, effect }: { headline?: string; steps: string[]; effect?: string }) {
  const nodes = effect ? [...steps, effect] : steps;
  return (
    <div>
      {headline && <p className="mb-3 text-[12px] text-muted">{headline}</p>}
      <ol className="flex flex-wrap items-stretch gap-y-3">
        {nodes.map((n, i) => {
          const last = i === nodes.length - 1 && !!effect;
          return (
            <li key={`${i}-${n}`} className="flex min-w-0 items-center">
              <div
                className="flex h-full min-w-[128px] max-w-[190px] items-center rounded-md border px-3 py-2 text-[12px] leading-snug text-text"
                style={{
                  borderColor: last ? "var(--risk-critical)" : "var(--border-strong)",
                  backgroundColor: last ? "color-mix(in srgb, var(--risk-critical) 10%, transparent)" : "var(--surface-2)",
                }}
              >
                <span className="num mr-2 shrink-0 text-[10px] text-faint">{i + 1}</span>
                {n}
              </div>
              {i < nodes.length - 1 && (
                <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden className="shrink-0 text-faint">
                  <path d="M1 6h21M17 1.5 22.5 6 17 10.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Tone for days of cover: under 3 critical, under 7 stress, under 14 monitor. */
export function coverTone(days: number): "critical" | "stress" | "monitor" | "healthy" {
  return days < 3 ? "critical" : days < 7 ? "stress" : days < 14 ? "monitor" : "healthy";
}
