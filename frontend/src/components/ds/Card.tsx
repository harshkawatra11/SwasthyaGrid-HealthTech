import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { LiveDot } from "./LiveDot";

export type CardProps = {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  live?: boolean;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export function Card({ title, eyebrow, actions, live, footer, className, children }: CardProps) {
  return (
    <section
      className={cn("rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)]", className)}
    >
      {title && (
        <header className="flex h-11 items-center justify-between gap-3 border-b border-border px-4">
          <div className="flex min-w-0 items-baseline gap-2">
            {eyebrow && <span className="eyebrow shrink-0">{eyebrow}</span>}
            <h3 className="truncate text-[13px] font-semibold text-text">{title}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {live && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-[0.12em] text-brand">
                <LiveDot state="live" />
                LIVE
              </span>
            )}
            {actions}
          </div>
        </header>
      )}
      <div className="p-4">{children}</div>
      {footer && <footer className="border-t border-border px-4 py-2 text-[11px] text-faint">{footer}</footer>}
    </section>
  );
}
