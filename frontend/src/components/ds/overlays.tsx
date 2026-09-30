"use client";

import * as RD from "@radix-ui/react-dialog";
import * as RDM from "@radix-ui/react-dropdown-menu";
import * as RP from "@radix-ui/react-popover";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export { Tooltip } from "./Tooltip";

const overlayCls = "fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in";

export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RD.Portal>
      <RD.Overlay className={overlayCls} />
      <RD.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-strong bg-surface-1 p-5 shadow-[var(--shadow-overlay)]",
          className,
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <RD.Title className="text-[15px] font-semibold text-text">{title}</RD.Title>
            {description ? (
              <RD.Description className="mt-1 text-[12px] text-muted">{description}</RD.Description>
            ) : (
              <RD.Description className="sr-only">{title}</RD.Description>
            )}
          </div>
          <RD.Close aria-label="Close" className="rounded-sm p-1 text-muted hover:bg-surface-3 hover:text-text">
            <X size={16} />
          </RD.Close>
        </div>
        {children}
      </RD.Content>
    </RD.Portal>
  );
}

export const Sheet = RD.Root;
export const SheetTrigger = RD.Trigger;
export const SheetClose = RD.Close;

export function SheetContent({
  title,
  side = "right",
  children,
  className,
}: {
  title: string;
  side?: "left" | "right";
  children: ReactNode;
  className?: string;
}) {
  return (
    <RD.Portal>
      <RD.Overlay className={overlayCls} />
      <RD.Content
        className={cn(
          "fixed top-0 z-50 flex h-full w-[min(88vw,380px)] flex-col border-border-strong bg-surface-1 shadow-[var(--shadow-overlay)]",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          className,
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <RD.Title className="text-[15px] font-semibold text-text">{title}</RD.Title>
          <RD.Close aria-label="Close" className="rounded-sm p-1 text-muted hover:bg-surface-3 hover:text-text">
            <X size={16} />
          </RD.Close>
        </div>
        <RD.Description className="sr-only">{title}</RD.Description>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </RD.Content>
    </RD.Portal>
  );
}

export const DropdownMenu = RDM.Root;
export const DropdownMenuTrigger = RDM.Trigger;

export function DropdownMenuContent({ children, align = "end" }: { children: ReactNode; align?: "start" | "center" | "end" }) {
  return (
    <RDM.Portal>
      <RDM.Content
        align={align}
        sideOffset={6}
        className="z-50 min-w-40 rounded-md border border-border-strong bg-surface-2 p-1 shadow-[var(--shadow-overlay)]"
      >
        {children}
      </RDM.Content>
    </RDM.Portal>
  );
}

export function DropdownMenuItem({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) {
  return (
    <RDM.Item
      onSelect={onSelect}
      className="flex cursor-default select-none items-center gap-2 rounded-sm px-2.5 py-1.5 text-[12px] text-text outline-none data-[highlighted]:bg-surface-3"
    >
      {children}
    </RDM.Item>
  );
}

export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;

export function PopoverContent({ children, className, align = "start" }: { children: ReactNode; className?: string; align?: "start" | "center" | "end" }) {
  return (
    <RP.Portal>
      <RP.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 w-72 rounded-md border border-border-strong bg-surface-2 p-3 text-[12px] text-text shadow-[var(--shadow-overlay)]",
          className,
        )}
      >
        {children}
      </RP.Content>
    </RP.Portal>
  );
}
