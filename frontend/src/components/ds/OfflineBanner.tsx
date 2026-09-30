"use client";

import { WifiOff } from "lucide-react";
import { useApiHealth } from "@/lib/api-health";

export function OfflineBanner() {
  const { offline } = useApiHealth();
  if (!offline) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] px-6 py-2 text-[12px] font-medium text-amber"
    >
      <WifiOff size={14} aria-hidden />
      Backend offline. Showing sample data.
    </div>
  );
}
