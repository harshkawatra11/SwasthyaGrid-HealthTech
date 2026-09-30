import { cn } from "@/lib/cn";

export type LiveState = "live" | "stale" | "offline";

const COLOR: Record<LiveState, string> = {
  live: "bg-brand",
  stale: "bg-amber",
  offline: "bg-faint",
};

export function LiveDot({ state, className }: { state: LiveState; className?: string }) {
  return (
    <span
      role="img"
      aria-label={state}
      className={cn("relative inline-flex h-1.5 w-1.5 shrink-0 rounded-full", COLOR[state], className)}
    >
      {state === "live" && (
        <span className="absolute inset-0 rounded-full bg-brand opacity-60 motion-safe:animate-ping [animation-duration:1.6s]" />
      )}
    </span>
  );
}
