"use client";

import * as RT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <RT.Provider delayDuration={120}>
      <RT.Root>
        <RT.Trigger asChild>{children}</RT.Trigger>
        <RT.Portal>
          <RT.Content
            side={side}
            sideOffset={6}
            className="z-50 rounded-md border border-border-strong bg-surface-2 px-2.5 py-1.5 text-[12px] text-text shadow-[var(--shadow-overlay)]"
          >
            {content}
            <RT.Arrow className="fill-[var(--border-strong)]" />
          </RT.Content>
        </RT.Portal>
      </RT.Root>
    </RT.Provider>
  );
}
