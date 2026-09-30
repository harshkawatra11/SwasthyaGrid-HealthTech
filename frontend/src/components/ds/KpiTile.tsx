import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { Sparkline } from "./Sparkline";

export type KpiDelta = { value: number; direction: "up" | "down"; good: "up" | "down" };
export type KpiTone = "default" | "critical" | "warning" | "good";

const TONE_TEXT: Record<KpiTone, string> = {
  default: "text-text",
  critical: "text-risk-critical",
  warning: "text-risk-monitor",
  good: "text-risk-healthy",
};

const TONE_SPARK: Record<KpiTone, string> = {
  default: "var(--series-1)",
  critical: "var(--risk-critical)",
  warning: "var(--risk-monitor)",
  good: "var(--risk-healthy)",
};

export function deltaIsGood(d: KpiDelta): boolean {
  return d.direction === d.good;
}

export type KpiTileProps = {
  label: string;
  value: string | number;
  unit?: string;
  delta?: KpiDelta;
  sparkline?: number[];
  hint?: ReactNode;
  href?: string;
  tone?: KpiTone;
  className?: string;
};

export function KpiTile({ label, value, unit, delta, sparkline, hint, href, tone = "default", className }: KpiTileProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {delta && (
          <span
            className={cn(
              "num inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium",
              deltaIsGood(delta)
                ? "bg-[color-mix(in_srgb,var(--green)_14%,transparent)] text-green"
                : "bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-red",
            )}
          >
            {delta.direction === "up" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
            {Math.abs(delta.value)}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className={cn("num text-[28px] font-semibold leading-none", TONE_TEXT[tone])}>
          {value}
          {unit && <span className="ml-1 text-[13px] font-normal text-muted">{unit}</span>}
        </div>
        {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} color={TONE_SPARK[tone]} />}
      </div>
      {hint && <div className="mt-2 text-[12px] text-muted">{hint}</div>}
    </>
  );
  const cls = cn(
    "block rounded-md border border-border bg-surface-1 p-4 shadow-[var(--inset-highlight)]",
    href && "transition-colors hover:bg-surface-2",
    className,
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
