"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { fmtClock } from "@/lib/format";
import type { GanttTrip, ScheduleResponse } from "@/lib/api/types";
import { ganttScale, hourTicks, segmentBar, segmentColor, SEGMENT_LABEL } from "../lib/gantt";
import { useElementWidth } from "../lib/useElementWidth";
import { depotLabel } from "../lib/parts";

type Row = ScheduleResponse["rows"][number];

const LABEL_W = 156;
const ROW_H = 26;
const GROUP_H = 22;
const AXIS_H = 26;
const BAR_H = 14;

type Line = { kind: "group"; id: string; label: string; count: number } | { kind: "row"; row: Row };

/** Group rows by home depot, keeping the incoming depot order stable (central first). */
export function groupRows(rows: readonly Row[], depotName: (id: string) => string): Line[] {
  const order: string[] = [];
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.vehicle.home_warehouse_id;
    if (!by.has(k)) {
      by.set(k, []);
      order.push(k);
    }
    by.get(k)!.push(r);
  }
  order.sort((a, b) => (a === "wh_central" ? -1 : b === "wh_central" ? 1 : depotName(a).localeCompare(depotName(b))));
  const out: Line[] = [];
  for (const k of order) {
    const rs = by.get(k)!.sort((a, b) => a.vehicle.registration.localeCompare(b.vehicle.registration));
    out.push({ kind: "group", id: k, label: depotName(k), count: rs.length });
    for (const r of rs) out.push({ kind: "row", row: r });
  }
  return out;
}

type Hover = { trip: GanttTrip; kind: string; start: string; end: string; reg: string; x: number; y: number };

/**
 * Fleet Gantt in plain SVG: rows are vehicles grouped by depot, x is the sim day 05:00 to 23:00 IST.
 * Bars: load cyan, drive by trip status, dwell violet, incident orange hatched. Red now line.
 */
export function FleetGantt({
  rows,
  windowStart,
  windowEnd,
  nowMs,
  maxHeight = 560,
  selectedVehicleId,
  onSelectVehicle,
  depotName,
}: {
  rows: readonly Row[];
  windowStart: string;
  windowEnd: string;
  nowMs: number | null;
  maxHeight?: number;
  selectedVehicleId?: string | null;
  onSelectVehicle?: (vehicleId: string) => void;
  depotName: (depotId: string) => string;
}) {
  const router = useRouter();
  const uid = useId().replace(/:/g, "");
  const [ref, width] = useElementWidth(900);
  const [hover, setHover] = useState<Hover | null>(null);
  const plotW = Math.max(200, width - LABEL_W - 12);
  const scale = useMemo(() => ganttScale(windowStart, windowEnd, plotW), [windowStart, windowEnd, plotW]);
  const ticks = useMemo(() => hourTicks(windowStart, windowEnd), [windowStart, windowEnd]);
  const lines = useMemo(() => groupRows(rows, depotName), [rows, depotName]);

  const heights = lines.map((l) => (l.kind === "group" ? GROUP_H : ROW_H));
  const placed = lines.map((l, i) => ({ l, top: heights.slice(0, i).reduce((acc, h) => acc + h, 0) }));
  const bodyH = heights.reduce((acc, h) => acc + h, 0);
  const nowX = nowMs !== null && nowMs >= scale.startMs && nowMs <= scale.endMs ? scale.x(nowMs) : null;

  return (
    <div ref={ref} className="relative w-full">
      <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted" aria-label="Gantt legend">
        <li className="inline-flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-[3px]" style={{ background: "var(--cyan)" }} />Load</li>
        <li className="inline-flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-[3px]" style={{ background: "var(--status-in-transit)" }} />Drive, in transit</li>
        <li className="inline-flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-[3px]" style={{ background: "var(--status-arrived)" }} />Drive, arrived</li>
        <li className="inline-flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-[3px]" style={{ background: "var(--violet)" }} />Dwell</li>
        <li className="inline-flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-[3px]" style={{ background: "repeating-linear-gradient(45deg, var(--orange) 0 3px, transparent 3px 6px)", border: "1px solid var(--orange)" }} />Incident</li>
        <li className="inline-flex items-center gap-1.5"><i className="h-3 w-0.5 bg-red" />Now</li>
      </ul>

      <svg width={width} height={AXIS_H} className="block" aria-hidden>
        <g transform={`translate(${LABEL_W} 0)`}>
          {ticks.map((t) => (
            <text key={t.ms} x={scale.x(t.ms)} y={16} textAnchor="middle" fontSize={10} fill="var(--text-faint)" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
              {t.label}
            </text>
          ))}
          {nowX !== null && nowMs !== null && (
            <g>
              <rect x={nowX - 20} y={2} width={40} height={13} rx={3} fill="var(--red)" />
              <text x={nowX} y={12} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--surface-1)" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
                {fmtClock(new Date(nowMs).toISOString())}
              </text>
            </g>
          )}
        </g>
      </svg>

      <div className="overflow-y-auto rounded-sm border border-border bg-surface-1" style={{ maxHeight }}>
        <svg width={width} height={bodyH} className="block" role="img" aria-label="Fleet schedule for the simulated day">
          <defs>
            <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--orange)" fillOpacity={0.25} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--orange)" strokeWidth="2.5" />
            </pattern>
          </defs>
          <g transform={`translate(${LABEL_W} 0)`}>
            {ticks.map((t) => (
              <line key={t.ms} x1={scale.x(t.ms)} x2={scale.x(t.ms)} y1={0} y2={bodyH} stroke="var(--border)" strokeDasharray="2 4" />
            ))}
          </g>
          {placed.map(({ l, top }) => {
            if (l.kind === "group") {
              return (
                <g key={`g-${l.id}`}>
                  <rect x={0} y={top} width={width} height={GROUP_H} fill="var(--surface-2)" />
                  <text x={8} y={top + 15} fontSize={11} fontWeight={600} fill="var(--text)">
                    {depotLabel(l.label)}
                  </text>
                  <text x={LABEL_W - 8} y={top + 15} fontSize={10} textAnchor="end" fill="var(--text-faint)" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
                    {l.count}
                  </text>
                </g>
              );
            }
            const { vehicle, trips } = l.row;
            const selected = selectedVehicleId === vehicle.id;
            return (
              <g key={vehicle.id}>
                {selected && <rect x={0} y={top} width={width} height={ROW_H} fill="var(--brand-soft)" />}
                <line x1={0} x2={width} y1={top + ROW_H} y2={top + ROW_H} stroke="var(--border)" />
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Vehicle ${vehicle.registration}`}
                  className="cursor-pointer outline-none"
                  onClick={() => onSelectVehicle?.(vehicle.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSelectVehicle?.(vehicle.id);
                  }}
                >
                  <rect x={0} y={top} width={LABEL_W} height={ROW_H} fill="transparent" />
                  <text x={8} y={top + 12} fontSize={11} fontWeight={600} fill="var(--text)" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
                    {vehicle.registration}
                  </text>
                  <text x={8} y={top + 23} fontSize={9} fill="var(--text-faint)">
                    {vehicle.label.replace(/ \(.*/, "")}
                  </text>
                </g>
                <g transform={`translate(${LABEL_W} ${top})`}>
                  {trips.map((trip) => {
                    const first = trip.segments.find((s) => segmentBar(scale, s.start, s.end));
                    const firstBar = first ? segmentBar(scale, first.start, first.end) : null;
                    const total = trip.segments.reduce((acc, s) => {
                      const b = segmentBar(scale, s.start, s.end);
                      return acc + (b?.w ?? 0);
                    }, 0);
                    return (
                      <g
                        key={trip.shipment_id}
                        role="link"
                        tabIndex={0}
                        aria-label={`Trip ${trip.shipment_id}: ${trip.label}`}
                        className="cursor-pointer outline-none focus-visible:opacity-80"
                        onClick={() => router.push(`/supply/shipments/${trip.shipment_id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") router.push(`/supply/shipments/${trip.shipment_id}`);
                        }}
                      >
                        {trip.segments.map((seg, i) => {
                          const b = segmentBar(scale, seg.start, seg.end);
                          if (!b) return null;
                          const color = segmentColor(seg.kind, trip.status);
                          return (
                            <rect
                              key={i}
                              x={b.x}
                              y={(ROW_H - BAR_H) / 2}
                              width={Math.max(1, b.w - 1)}
                              height={BAR_H}
                              rx={3}
                              fill={seg.kind === "incident" ? `url(#${uid}-hatch)` : color}
                              stroke={seg.kind === "incident" ? "var(--orange)" : "none"}
                              onMouseEnter={(e) => {
                                const box = (e.currentTarget.ownerSVGElement?.parentElement?.parentElement ?? e.currentTarget).getBoundingClientRect();
                                setHover({ trip, kind: seg.kind, start: seg.start, end: seg.end, reg: vehicle.registration, x: e.clientX - box.left, y: e.clientY - box.top });
                              }}
                              onMouseMove={(e) => {
                                const box = (e.currentTarget.ownerSVGElement?.parentElement?.parentElement ?? e.currentTarget).getBoundingClientRect();
                                setHover((h) => (h ? { ...h, x: e.clientX - box.left, y: e.clientY - box.top } : h));
                              }}
                              onMouseLeave={() => setHover(null)}
                            />
                          );
                        })}
                        {firstBar && total > 70 && (
                          <text x={firstBar.x + 5} y={ROW_H / 2 + 3.5} fontSize={9.5} fontWeight={600} fill="var(--bg)" pointerEvents="none" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
                            {trip.shipment_id}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              </g>
            );
          })}
          {nowX !== null && (
            <g transform={`translate(${LABEL_W} 0)`} pointerEvents="none">
              <line x1={nowX} x2={nowX} y1={0} y2={bodyH} stroke="var(--red)" strokeWidth={2} />
            </g>
          )}
        </svg>
      </div>

      {hover && (
        <div
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-20 max-w-[260px] rounded-md border border-border-strong bg-surface-2 px-2.5 py-2 text-[11px] text-text shadow-[var(--shadow-overlay)]",
          )}
          style={{ left: Math.min(Math.max(8, hover.x + 12), Math.max(8, width - 270)), top: hover.y + 16 }}
        >
          <p className="num font-semibold">{hover.trip.shipment_id}</p>
          <p className="text-muted">{hover.trip.label}</p>
          <p className="mt-1">
            {SEGMENT_LABEL[hover.kind] ?? hover.kind}, <span className="num">{fmtClock(hover.start)} to {fmtClock(hover.end)}</span>
          </p>
          <p className="text-faint">{hover.reg}</p>
        </div>
      )}
    </div>
  );
}
