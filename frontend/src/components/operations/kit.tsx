"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFacilities } from "@/lib/api/hooks";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { Tooltip } from "@/components/ds/Tooltip";
import { Skeleton } from "@/components/ds/Skeleton";
import { DEMAND_SCENARIOS, facilityRefs, scenarioOf, type FacRef, type ScenarioId } from "./derive";

/** Facility id to name, district and beds, joined from /facilities so no page shows a raw id. */
export function useFacRefs(scope: string): { refs: Map<string, FacRef>; loading: boolean } {
  const { data, isLoading } = useFacilities(scope);
  const refs = useMemo(() => facilityRefs(data?.facilities), [data]);
  return { refs, loading: isLoading };
}

/**
 * Analytic card with the consulting structure: eyebrow (metric), action title (finding),
 * body, then a source line (left) and sub-section label (right).
 */
export function InsightCard({
  eyebrow,
  title,
  actions,
  source,
  section,
  children,
  className,
  bodyClassName,
}: {
  eyebrow: string;
  title: ReactNode;
  actions?: ReactNode;
  source?: string;
  section?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)]", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h3 className="mt-1 text-[14px] font-semibold leading-snug text-text">{title}</h3>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("min-h-0 flex-1 p-3", bodyClassName)}>{children}</div>
      {(source || section) && (
        <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11px] text-faint">
          <span className="min-w-0 truncate" title={source}>
            {source}
          </span>
          {section && <span className="shrink-0">{section}</span>}
        </footer>
      )}
    </section>
  );
}

/** The one hero number of a page: the only place the top-severity colour is used outside chips. */
export function Moneyshot({
  value,
  unit,
  label,
  note,
  tone = "critical",
  href,
  className,
}: {
  value: string | number;
  unit?: string;
  label: string;
  note: ReactNode;
  tone?: "critical" | "brand" | "warning";
  href?: string;
  className?: string;
}) {
  const color = tone === "critical" ? "var(--risk-critical)" : tone === "warning" ? "var(--risk-monitor)" : "var(--brand)";
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="num mt-2 text-[44px] font-semibold leading-none" style={{ color }}>
        {value}
        {unit && <span className="ml-2 text-[16px] font-normal text-muted">{unit}</span>}
      </p>
      <p className="mt-3 text-[12px] leading-snug text-muted">{note}</p>
    </>
  );
  const cls = cn("block rounded-md border bg-surface-1 p-4", className);
  const style = { borderColor: `color-mix(in srgb, ${color} 45%, var(--border))` };
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:bg-surface-2")} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

/** Annotation pointing at a specific data point, with what it means. */
export function Callout({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "critical" | "good"; className?: string }) {
  const color = tone === "critical" ? "var(--risk-critical)" : tone === "good" ? "var(--risk-healthy)" : "var(--text-muted)";
  return (
    <p
      className={cn("inline-flex items-start gap-1.5 rounded-sm border-l-2 bg-surface-2 px-2 py-1 text-[11px] leading-snug text-muted", className)}
      style={{ borderLeftColor: color }}
    >
      <Info size={11} className="mt-px shrink-0" style={{ color }} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function ScenarioSwitch({
  value,
  onChange,
  label = "Scenario",
}: {
  value: ScenarioId;
  onChange: (v: ScenarioId) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl
        value={value}
        onChange={onChange}
        ariaLabel={label}
        options={DEMAND_SCENARIOS.map((s) => ({ value: s.id, label: s.label }))}
      />
      <span className="text-[11px] text-muted">
        <span className="font-medium text-text">Assumption:</span> {scenarioOf(value).assumption}
      </span>
    </div>
  );
}

/** Three named assumptions under a chart, the active one highlighted. */
export function AssumptionRow({ active }: { active: ScenarioId }) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {DEMAND_SCENARIOS.map((s) => (
        <div
          key={s.id}
          className={cn("rounded-sm border px-2 py-1.5 text-[11px]", s.id === active ? "border-border-strong bg-surface-2 text-text" : "border-border text-muted")}
        >
          <span className="block font-semibold">
            {s.label} <span className="num font-normal text-faint">x{s.factor}</span>
          </span>
          <span className="block leading-snug">{s.assumption}</span>
        </div>
      ))}
    </div>
  );
}

export function StatPill({ label, value, tone }: { label: string; value: ReactNode; tone?: "critical" | "warning" | "good" }) {
  const color = tone === "critical" ? "var(--risk-critical)" : tone === "warning" ? "var(--risk-monitor)" : tone === "good" ? "var(--risk-healthy)" : "var(--text)";
  return (
    <div className="rounded-sm border border-border bg-surface-2 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="num text-[15px] font-semibold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

export function Hint({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip content={children}>
      <span className="inline-flex cursor-help items-center text-faint" aria-label={label} tabIndex={0}>
        <Info size={12} />
      </span>
    </Tooltip>
  );
}

export function PageSkeleton({ blocks = 4 }: { blocks?: number }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-24 w-full" />
      {Array.from({ length: blocks }).map((_, i) => (
        <Skeleton key={i} className="h-48 w-full" />
      ))}
    </div>
  );
}

/** Legend row of the five heat stops with labels, for hand-built matrices. */
export function HeatLegend({ labels, empty = "no data" }: { labels: string[]; empty?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted" aria-label="Legend">
      {labels.map((l, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: `var(--heat-${i})` }} />
          <span className="num">{l}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: "var(--heat-empty)" }} />
        {empty}
      </span>
    </div>
  );
}

/** Text colour on a heat cell: theme text token, which stays readable on both palettes. */
export function heatInk(bin: number | null): string {
  return bin === null ? "var(--text-faint)" : "var(--text)";
}
