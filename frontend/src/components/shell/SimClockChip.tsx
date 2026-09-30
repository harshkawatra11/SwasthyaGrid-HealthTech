"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ds/overlays";
import { toast } from "@/components/ds/Toaster";
import { fmtClockSeconds } from "@/lib/format";
import { resetScenario, setTimeScale, TIME_SCALES } from "@/lib/logistics-admin";
import { useSimClock, useTickingSimNow } from "@/lib/sim-clock";
import { cn } from "@/lib/cn";

export function SimClockChip() {
  const clock = useSimClock();
  const tickingNow = useTickingSimNow();
  const [busy, setBusy] = useState(false);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast({ title: label, tone: "success" });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Admin request failed", tone: "warning" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Simulation clock"
        className="hidden h-8 items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 text-[12px] text-text hover:bg-surface-3 md:inline-flex"
      >
        <Clock size={13} className="text-muted" />
        {tickingNow && (
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" title="Streaming" />
        )}
        <span className="num tabular-nums" aria-live="off">
          {tickingNow ? fmtClockSeconds(tickingNow) : "--:--:--"}
        </span>
        <span className="text-[10px] text-muted">IST</span>
        {clock.scale ? (
          <span className="num rounded-sm bg-brand-soft px-1 text-[10px] text-brand">x{clock.scale}</span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="eyebrow mb-2">Simulation speed</p>
        {clock.adminEnabled ? (
          <>
            <div className="flex gap-1.5">
              {TIME_SCALES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => run(`Speed set to x${s}`, () => setTimeScale(s))}
                  className={cn(
                    "num h-7 flex-1 rounded-md border border-border text-[12px] hover:bg-surface-3 disabled:opacity-50",
                    clock.scale === s && "border-brand text-brand",
                  )}
                >
                  {s}x
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => run("Scenario reset", () => resetScenario())}
              className="mt-3 h-7 w-full rounded-md border border-border text-[12px] hover:bg-surface-3 disabled:opacity-50"
            >
              Reset scenario
            </button>
          </>
        ) : (
          <p className="text-muted">Admin controls are disabled on this deployment.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
