import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("sticky top-14 z-20 -mx-6 mb-4 flex flex-wrap items-center gap-2 border-b border-border bg-bg/95 px-6 py-2 backdrop-blur", className)}>
      {children}
    </div>
  );
}
