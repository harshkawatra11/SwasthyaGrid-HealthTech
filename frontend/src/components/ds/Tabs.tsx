"use client";

import * as RTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Tabs = RTabs.Root;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <RTabs.List className={cn("flex gap-4 border-b border-border", className)}>{children}</RTabs.List>;
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RTabs.Trigger
      value={value}
      className="-mb-px border-b-2 border-transparent px-1 pb-2 text-[13px] font-medium text-muted transition-colors hover:text-text data-[state=active]:border-brand data-[state=active]:text-text"
    >
      {children}
    </RTabs.Trigger>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RTabs.Content value={value} className={cn("pt-4", className)}>
      {children}
    </RTabs.Content>
  );
}
