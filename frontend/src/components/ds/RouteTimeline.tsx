import { cn } from "@/lib/cn";
import { fmtClock } from "@/lib/format";
import type { StepState } from "./Stepper";

export type RouteStop = { label: string; sub?: string; at?: string | null; state: StepState };

export function RouteTimeline({ stops }: { stops: RouteStop[] }) {
  return (
    <ol className="relative">
      {stops.map((s, i) => {
        const first = i === 0;
        const last = i === stops.length - 1;
        const reached = s.state === "done" || s.state === "current";
        return (
          <li key={`${s.label}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && (
              <span
                aria-hidden
                className={cn("absolute left-[5px] top-3 h-full w-px", s.state === "done" ? "bg-brand" : "bg-border-strong")}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-[1] mt-1 h-[11px] w-[11px] shrink-0 border-2",
                first || last ? "rounded-[3px]" : "rounded-full",
                reached ? "border-brand bg-brand" : "border-border-strong bg-surface-1",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className={cn("text-[13px]", reached ? "font-medium text-text" : "text-muted")}>{s.label}</p>
              {s.sub && <p className="text-[11px] text-muted">{s.sub}</p>}
            </div>
            {s.at && <span className="num text-[11px] text-muted">{fmtClock(s.at)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
