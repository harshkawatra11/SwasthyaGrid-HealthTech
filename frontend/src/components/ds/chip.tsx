import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { tint } from "@/lib/domain";

export function Chip({
  label,
  color,
  size = "md",
  pulse,
  dot = true,
  className,
}: {
  label: string;
  color: string;
  size?: "sm" | "md";
  pulse?: boolean;
  dot?: boolean;
  className?: string;
}) {
  const style: CSSProperties = { backgroundColor: tint(color), color };
  return (
    <span
      style={style}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm font-medium",
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-[12px]",
        className,
      )}
    >
      {dot && (
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }}>
          {pulse && (
            <span
              className="absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping"
              style={{ backgroundColor: color }}
            />
          )}
        </span>
      )}
      {label}
    </span>
  );
}
