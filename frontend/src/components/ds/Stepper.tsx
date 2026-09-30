import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtClock } from "@/lib/format";
import { LiveDot } from "./LiveDot";

export type StepState = "done" | "current" | "upcoming" | "skipped";
export type Step = { key: string; label: string; at?: string | null; state: StepState };

function Marker({ state }: { state: StepState }) {
  const base = "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]";
  if (state === "done")
    return (
      <span className={cn(base, "border-brand bg-brand text-bg")}>
        <Check size={12} strokeWidth={3} />
      </span>
    );
  if (state === "current")
    return (
      <span className={cn(base, "border-brand bg-brand-soft")}>
        <LiveDot state="live" />
      </span>
    );
  if (state === "skipped")
    return (
      <span className={cn(base, "border-border-strong text-faint")}>
        <Minus size={11} />
      </span>
    );
  return <span className={cn(base, "border-border-strong bg-surface-2")} />;
}

export function Stepper({
  steps,
  orientation = "horizontal",
}: {
  steps: Step[];
  orientation?: "horizontal" | "vertical";
}) {
  const vertical = orientation === "vertical";
  return (
    <ol className={cn("flex", vertical ? "flex-col gap-4" : "items-start")}>
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={s.state === "current" ? "step" : undefined}
          className={cn("relative flex", vertical ? "gap-3" : "flex-1 flex-col items-start gap-1.5")}
        >
          <div className={cn("flex items-center", vertical ? "flex-col" : "w-full")}>
            <Marker state={s.state} />
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  vertical ? "mt-1 h-full min-h-4 w-px" : "mx-2 h-px flex-1",
                  s.state === "done" ? "bg-brand" : "bg-border-strong",
                )}
              />
            )}
          </div>
          <div className="min-w-0">
            <p
              className={cn(
                "text-[12px]",
                s.state === "current" ? "font-semibold text-text" : s.state === "done" ? "text-text" : "text-faint",
                s.state === "skipped" && "line-through",
              )}
            >
              {s.label}
            </p>
            {s.at && <p className="num text-[11px] text-muted">{fmtClock(s.at)}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
