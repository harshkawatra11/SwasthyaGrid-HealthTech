"use client";

import * as RS from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string; dot?: string };

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <RS.Root value={value} onValueChange={onValueChange}>
      <RS.Trigger
        aria-label={ariaLabel}
        className="inline-flex h-8 items-center justify-between gap-2 rounded-md border border-border bg-surface-1 px-2.5 text-[12px] text-text hover:bg-surface-2 data-[placeholder]:text-muted"
      >
        <RS.Value placeholder={placeholder} />
        <RS.Icon>
          <ChevronDown size={13} className="text-muted" />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border-strong bg-surface-2 shadow-[var(--shadow-overlay)]"
        >
          <RS.Viewport className="p-1">
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-7 pr-3 text-[12px] text-text outline-none data-[highlighted]:bg-surface-3"
              >
                <RS.ItemIndicator className="absolute left-2">
                  <Check size={12} className="text-brand" />
                </RS.ItemIndicator>
                <RS.ItemText>
                  <span className="inline-flex items-center gap-2">
                    {o.dot && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: o.dot }} />}
                    {o.label}
                  </span>
                </RS.ItemText>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
