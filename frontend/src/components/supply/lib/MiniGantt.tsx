import { cn } from "@/lib/cn";
import { fmtClock } from "@/lib/format";
import type { GanttTrip } from "@/lib/api/types";
import { ganttScale, hourTicks, segmentColor, SEGMENT_LABEL } from "./gantt";

/** One-row Gantt of a vehicle or driver day (percent positioned, so it fits any card width). */
export function MiniGantt({
  trips,
  windowStart,
  windowEnd,
  nowMs,
  className,
}: {
  trips: GanttTrip[];
  windowStart: string;
  windowEnd: string;
  nowMs: number | null;
  className?: string;
}) {
  const scale = ganttScale(windowStart, windowEnd, 100);
  const ticks = hourTicks(windowStart, windowEnd).filter((_, i) => i % 3 === 0);
  const nowPct = nowMs === null ? null : scale.x(nowMs);
  return (
    <div className={cn("w-full", className)} role="img" aria-label={`Today schedule, ${trips.length} trips`}>
      <div className="relative h-7 overflow-hidden rounded-sm border border-border bg-surface-2">
        {ticks.map((t) => (
          <span
            key={t.ms}
            aria-hidden
            className="absolute inset-y-0 w-px bg-border"
            style={{ left: `${scale.x(t.ms)}%` }}
          />
        ))}
        {trips.flatMap((trip) =>
          trip.segments.map((seg, i) => {
            const a = scale.x(new Date(seg.start).getTime());
            const b = scale.x(new Date(seg.end).getTime());
            const left = Math.max(0, a);
            const right = Math.min(100, b);
            if (right <= left) return null;
            return (
              <span
                key={`${trip.shipment_id}-${i}`}
                title={`${trip.shipment_id}, ${SEGMENT_LABEL[seg.kind] ?? seg.kind}, ${fmtClock(seg.start)} to ${fmtClock(seg.end)}`}
                className="absolute top-1.5 h-4 rounded-[3px]"
                style={{
                  left: `${left}%`,
                  width: `max(2px, ${right - left}%)`,
                  background: segmentColor(seg.kind, trip.status),
                  opacity: seg.kind === "incident" ? 0.85 : 1,
                }}
              />
            );
          }),
        )}
        {nowPct !== null && nowPct >= 0 && nowPct <= 100 && (
          <span aria-hidden className="absolute inset-y-0 w-0.5 bg-red" style={{ left: `${nowPct}%` }} />
        )}
      </div>
      <div className="relative mt-0.5 h-3 text-[10px] text-faint">
        {ticks.map((t) => (
          <span key={t.ms} className="num absolute -translate-x-1/2" style={{ left: `${scale.x(t.ms)}%` }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
