"use client";

import * as TG from "@radix-ui/react-toggle-group";
import type { ReactNode } from "react";

export type SegmentOption<V extends string> = { value: V; label: string; icon?: ReactNode };

export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  ariaLabel = "View",
}: {
  value: V;
  onChange: (v: V) => void;
  options: SegmentOption<V>[];
  ariaLabel?: string;
}) {
  return (
    <TG.Root
      type="single"
      value={value}
      aria-label={ariaLabel}
      onValueChange={(v) => {
        if (v) onChange(v as V);
      }}
      className="inline-flex rounded-md border border-border bg-surface-2 p-0.5"
    >
      {options.map((o) => (
        <TG.Item
          key={o.value}
          value={o.value}
          className="inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:text-text data-[state=on]:bg-surface-1 data-[state=on]:text-text data-[state=on]:shadow-[var(--inset-highlight)]"
        >
          {o.icon}
          {o.label}
        </TG.Item>
      ))}
    </TG.Root>
  );
}
