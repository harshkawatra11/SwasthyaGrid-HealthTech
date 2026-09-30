"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { LiveDot } from "@/components/ds/LiveDot";
import { Skeleton } from "@/components/ds/Skeleton";
import { useLiveState } from "@/lib/live/LiveProvider";

export type PanelProps = {
  /** Metric name, small caps above the title. */
  eyebrow: string;
  /** Action title: a computed finding sentence. */
  title: string;
  actions?: ReactNode;
  live?: boolean;
  /** One line "Read" caption under the content. */
  read?: ReactNode;
  /** Source and method line, bottom left. */
  source?: string;
  /** Sub-section label, bottom right. */
  section?: string;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
  testId?: string;
};

/**
 * Consulting style card: eyebrow, full sentence title, body, Read caption, then a footer with the
 * source line on the left and the sub-section label on the right (consulting-grade.md rules 1, 4, 5, 9).
 */
export function Panel({
  eyebrow,
  title,
  actions,
  live,
  read,
  source,
  section,
  className,
  bodyClassName,
  children,
  testId,
}: PanelProps) {
  const liveState = useLiveState();
  return (
    <section
      data-testid={testId}
      className={cn(
        "flex min-w-0 flex-col rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)]",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <p className="eyebrow truncate">{eyebrow}</p>
          <h3 className="mt-0.5 text-[14px] font-semibold leading-snug text-text" data-role="action-title">
            {title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {live && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-medium tracking-[0.12em]",
                liveState === "live" ? "text-brand" : liveState === "stale" ? "text-amber" : "text-faint",
              )}
            >
              <LiveDot state={liveState} />
              {liveState === "live" ? "LIVE" : liveState === "stale" ? "STALE" : "OFFLINE"}
            </span>
          )}
          {actions}
        </div>
      </header>
      <div className={cn("min-h-0 flex-1 px-4 pb-2", bodyClassName)}>{children}</div>
      {read && <p className="px-4 pb-2 text-[12px] leading-snug text-muted">{read}</p>}
      {(source || section) && (
        <footer className="mt-auto flex items-center justify-between gap-3 border-t border-border px-4 py-1.5 text-[11px] text-faint">
          <span className="min-w-0 truncate" title={source}>
            {source}
          </span>
          {section && <span className="shrink-0">{section}</span>}
        </footer>
      )}
    </section>
  );
}

/** Loading placeholder with the same outer box as a Panel. */
export function PanelSkeleton({ className, lines = 6 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("rounded-md border border-border bg-surface-1 p-4", className)} aria-busy="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-4 w-3/4" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}

export const SOURCE_SEED = "Source: SwasthyaGrid seed data";
export const SOURCE_SIM = "Source: simulated operational data";

/** Small legend chip used in headers of toggles. */
export function ToggleChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        pressed ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface-2 text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
