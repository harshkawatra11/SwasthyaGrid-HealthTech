"use client";

import Link from "next/link";
import { ArrowRight, Check, Siren, Truck, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ds/Skeleton";
import type { SituationLine } from "./titles";

const ICON = { risk: Siren, supply: Truck, action: Zap } as const;
const LABEL = { risk: "Risk", supply: "Supply", action: "Next action" } as const;

/** Three line Situation banner with the page's one moneyshot number (consulting-grade rules 8 and 3). */
export function SituationBanner({
  lines,
  moneyshot,
  scopeLabel,
  live,
}: {
  lines: SituationLine[] | null;
  moneyshot: { value: string; line: string } | null;
  scopeLabel: string;
  live: boolean;
}) {
  return (
    <section
      aria-label="Situation"
      data-testid="situation-banner"
      className="grid overflow-hidden rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)] md:grid-cols-[minmax(240px,300px)_1fr]"
    >
      <div className="border-b border-border bg-surface-2 px-5 py-4 md:border-b-0 md:border-r">
        <p className="eyebrow">Situation, {scopeLabel}</p>
        {moneyshot ? (
          <>
            <p className="num mt-1 text-[40px] font-semibold leading-none text-red" data-testid="moneyshot">
              {moneyshot.value}
            </p>
            <p className="mt-2 text-[13px] leading-snug text-text">{moneyshot.line}</p>
          </>
        ) : (
          <Skeleton className="mt-3 h-10 w-32" />
        )}
        <p className="mt-3 text-[11px] text-faint">{live ? "Updated live from the stream" : "Refreshed every 30 s"}</p>
        <Link
          href="/recommendations"
          className="mt-3 inline-flex items-center gap-1 rounded-sm border border-brand bg-brand-soft px-2.5 py-1.5 text-[12px] font-medium text-brand hover:bg-brand hover:text-[var(--bg)]"
        >
          Review approvals <ArrowRight size={12} aria-hidden />
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {(lines ?? [null, null, null]).map((l, i) => {
          if (!l) {
            return (
              <li key={i} className="px-5 py-3">
                <Skeleton className="h-4 w-4/5" />
              </li>
            );
          }
          const Icon = ICON[l.tone];
          return (
            <li key={l.tone} className="flex items-start gap-3 px-5 py-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-surface-3 text-muted">
                <Icon size={14} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="eyebrow">{LABEL[l.tone]}</p>
                <p className="text-[13px] leading-snug text-text">{l.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Two column executive block: What is working (green ticks) and What needs action (red). */
export function ExecutiveBlock({ working, action }: { working: string[] | null; action: string[] | null }) {
  return (
    <section
      aria-label="Executive summary"
      data-testid="executive-block"
      className="grid overflow-hidden rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)] sm:grid-cols-2"
    >
      <Column title="What is working" tone="good" items={working} />
      <Column title="What needs action" tone="bad" items={action} />
    </section>
  );
}

function Column({ title, tone, items }: { title: string; tone: "good" | "bad"; items: string[] | null }) {
  return (
    <div className={cn("px-4 py-3", tone === "good" ? "sm:border-r sm:border-border" : "")}>
      <p className={cn("eyebrow mb-2", tone === "good" ? "text-green" : "text-red")}>{title}</p>
      <ul className="space-y-1.5">
        {(items ?? [null, null, null]).map((t, i) =>
          t === null ? (
            <li key={i}>
              <Skeleton className="h-4 w-full" />
            </li>
          ) : (
            <li key={t} className="flex items-start gap-2 text-[12px] leading-snug text-text">
              {tone === "good" ? (
                <Check size={13} className="mt-0.5 shrink-0 text-green" aria-hidden />
              ) : (
                <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-red" aria-hidden />
              )}
              <span>{t}</span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
