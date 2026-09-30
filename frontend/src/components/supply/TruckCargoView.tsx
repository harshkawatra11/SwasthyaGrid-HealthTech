"use client";

import { useId, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import {
  cargoCounts,
  cargoLayout,
  classArt,
  medicineColor,
  medicineInitials,
  type CargoSlot,
} from "./lib/cargo";

export type { CargoSlot } from "./lib/cargo";

export type TruckCargoViewProps = {
  vehicleClass: string;
  slots: CargoSlot[];
  compact?: boolean;
  coldChain: boolean;
  /** Highlight one cell (image 2 shows a selected cell in violet). */
  selectedIndex?: number | null;
  onSelectSlot?: (index: number) => void;
  className?: string;
};

const VB_W = 640;
const VB_H = 220;
const GROUND = 204;
const CHASSIS_Y = 162;
const CAB_W = 152;
const GAP_CAB_BOX = 8;

function Snowflake({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g stroke="var(--cyan)" strokeWidth={1.3} strokeLinecap="round" aria-hidden>
      {[0, 60, 120].map((a) => (
        <line
          key={a}
          x1={cx - r * Math.cos((a * Math.PI) / 180)}
          y1={cy - r * Math.sin((a * Math.PI) / 180)}
          x2={cx + r * Math.cos((a * Math.PI) / 180)}
          y2={cy + r * Math.sin((a * Math.PI) / 180)}
        />
      ))}
    </g>
  );
}

function Wheel({ cx }: { cx: number }) {
  return (
    <g aria-hidden>
      <circle cx={cx} cy={GROUND - 19} r={19} fill="var(--bg)" stroke="var(--border-strong)" strokeWidth={2} />
      <circle cx={cx} cy={GROUND - 19} r={10} fill="var(--surface-3)" stroke="var(--text-faint)" strokeWidth={1.5} />
      <circle cx={cx} cy={GROUND - 19} r={3} fill="var(--text-faint)" />
    </g>
  );
}

/** Legend swatches, HTML so the words stay real text. */
export function CargoLegend({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted", className)} aria-label="Cargo legend">
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--series-1)" }} />
        Loaded
      </li>
      <li className="inline-flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <defs>
            <pattern id={`${uid}-lg`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="4" fill="var(--surface-3)" />
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--text-muted)" strokeWidth="1.6" />
            </pattern>
          </defs>
          <rect x="0.5" y="0.5" width="11" height="11" rx="3" fill={`url(#${uid}-lg)`} stroke="var(--border-strong)" />
        </svg>
        Reserved
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] border border-border-strong bg-surface-3" />
        Empty
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="relative h-2.5 w-2.5 rounded-[3px] border-[1.5px] bg-surface-3"
          style={{ borderColor: "var(--cyan)" }}
        />
        Cold chain
      </li>
    </ul>
  );
}

export function TruckCargoView({
  vehicleClass,
  slots,
  compact = false,
  coldChain,
  selectedIndex = null,
  onSelectSlot,
  className,
}: TruckCargoViewProps) {
  const uid = useId().replace(/:/g, "");
  const art = classArt(vehicleClass);
  const s = art.cabScale;
  const total = CAB_W * s + GAP_CAB_BOX + art.boxWidth;
  const x0 = (VB_W - total) / 2;
  const cabX = x0;
  const boxX = x0 + CAB_W * s + GAP_CAB_BOX;
  const boxBottom = CHASSIS_Y - 2;
  const boxTop = boxBottom - art.boxHeight;
  const inner = { x: boxX + 10, y: boxTop + 16, w: art.boxWidth - 20, h: art.boxHeight - 28 };
  const cells = cargoLayout(slots.length, inner, 4, 78);
  const counts = cargoCounts(slots);
  const boxStroke = coldChain ? "var(--cyan)" : "var(--border-strong)";
  const rearAxles = art.boxWidth > 250 ? [boxX + art.boxWidth - 64, boxX + art.boxWidth - 22] : [boxX + art.boxWidth - 40];
  const frontWheel = cabX + 96 * s;

  function onKey(e: KeyboardEvent, i: number) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectSlot?.(i);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role="img"
      aria-label={`${art.label} cargo bay: ${counts.loaded} loaded, ${counts.reserved} reserved, ${counts.empty} empty of ${counts.total} pallet slots${coldChain ? ", cold chain" : ""}`}
      className={cn("h-auto w-full", className)}
    >
      <defs>
        <pattern id={`${uid}-stripe`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="var(--surface-3)" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--text-faint)" strokeWidth="2.2" />
        </pattern>
      </defs>

      {/* road */}
      <line x1={12} y1={GROUND + 1} x2={VB_W - 12} y2={GROUND + 1} stroke="var(--border-strong)" strokeWidth={1.5} strokeDasharray="10 8" />

      {/* chassis */}
      <rect x={cabX + 6} y={CHASSIS_Y} width={total - 6} height={9} rx={2} fill="var(--surface-3)" stroke="var(--border-strong)" />

      {/* cab (cab-over-engine tractor, as in the reference photograph) */}
      <g transform={`translate(${cabX} ${CHASSIS_Y}) scale(${s}) translate(0 ${-CHASSIS_Y})`}>
        <path
          d="M 2 162 L 2 100 Q 2 90 11 88 L 28 85 L 40 44 Q 43 36 52 36 L 138 36 Q 150 36 150 48 L 150 162 Z"
          fill="var(--surface-3)"
          stroke="var(--border-strong)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {/* roof spoiler */}
        <path d="M 46 36 L 50 26 L 132 26 Q 140 26 140 34 L 140 36" fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth={1.5} />
        {/* windscreen and side glass */}
        <path d="M 33 84 L 43 46 L 96 46 L 96 84 Z" fill="var(--cyan)" fillOpacity={0.28} stroke="var(--border-strong)" strokeWidth={1.5} />
        <path d="M 102 46 L 140 46 L 140 84 L 102 84 Z" fill="var(--cyan)" fillOpacity={0.2} stroke="var(--border-strong)" strokeWidth={1.5} />
        <line x1={99} y1={46} x2={99} y2={162} stroke="var(--border-strong)" strokeWidth={1.5} />
        <rect x={104} y={100} width={14} height={4} rx={2} fill="var(--text-faint)" />
        {/* brand stripe and lower panel */}
        <rect x={2} y={126} width={148} height={8} fill="var(--brand)" fillOpacity={0.8} />
        <rect x={2} y={146} width={148} height={16} fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth={1} />
        {/* grille, headlight, mirror */}
        <g stroke="var(--text-faint)" strokeWidth={1.3} strokeLinecap="round">
          <line x1={9} y1={104} x2={9} y2={120} />
          <line x1={16} y1={102} x2={16} y2={120} />
          <line x1={23} y1={100} x2={23} y2={120} />
        </g>
        <rect x={3} y={137} width={13} height={7} rx={2} fill="var(--amber)" fillOpacity={0.95} />
        <rect x={28} y={58} width={7} height={22} rx={3} fill="var(--border-strong)" />
        <rect x={10} y={162} width={44} height={4} rx={2} fill="var(--border-strong)" />
      </g>

      {/* trailer box, cut away to show the bay */}
      <g>
        <rect x={boxX} y={boxTop} width={art.boxWidth} height={art.boxHeight} rx={6} fill="var(--surface-2)" stroke={boxStroke} strokeWidth={2} />
        <rect x={boxX + 6} y={boxTop + 6} width={art.boxWidth - 12} height={art.boxHeight - 12} rx={4} fill="var(--bg-elevated)" stroke="var(--border)" />
        {/* roof cut-away hatch marks */}
        <g stroke="var(--border-strong)" strokeWidth={1.2} strokeLinecap="round" aria-hidden>
          <line x1={boxX + 16} y1={boxTop + 3} x2={boxX + 36} y2={boxTop + 3} />
          <line x1={boxX + art.boxWidth - 36} y1={boxTop + 3} x2={boxX + art.boxWidth - 16} y2={boxTop + 3} />
        </g>
        {coldChain && (
          <g aria-hidden>
            <rect x={boxX + 10} y={boxTop - 14} width={54} height={14} rx={3} fill="var(--surface-3)" stroke="var(--cyan)" strokeWidth={1.5} />
            <g stroke="var(--cyan)" strokeWidth={1.2}>
              <line x1={boxX + 40} y1={boxTop - 10} x2={boxX + 58} y2={boxTop - 10} />
              <line x1={boxX + 40} y1={boxTop - 6} x2={boxX + 58} y2={boxTop - 6} />
            </g>
            <Snowflake cx={boxX + 24} cy={boxTop - 7} r={4.5} />
          </g>
        )}

        {cells.map((c) => {
          const slot = slots[c.index];
          const color = medicineColor(slot?.medicine_name);
          const selected = selectedIndex === c.index;
          const interactive = !!onSelectSlot;
          const label = `Slot ${c.index + 1}, ${slot?.state ?? "empty"}${slot?.medicine_name ? `, ${slot.medicine_name}` : ""}${slot?.cold_chain ? ", cold chain" : ""}${slot?.weight_kg ? `, ${slot.weight_kg} kg` : ""}`;
          return (
            <g
              key={c.index}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? label : undefined}
              onClick={interactive ? () => onSelectSlot?.(c.index) : undefined}
              onKeyDown={interactive ? (e) => onKey(e, c.index) : undefined}
              className={interactive ? "cursor-pointer outline-none focus-visible:opacity-80" : undefined}
            >
              <title>{label}</title>
              {slot?.state === "loaded" ? (
                <>
                  <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={4} fill={color} fillOpacity={0.92} />
                  <rect x={c.x} y={c.y + c.h - 6} width={c.w} height={6} rx={2} fill="var(--bg)" fillOpacity={0.35} />
                  {!compact && (
                    <text
                      x={c.x + c.w / 2}
                      y={c.y + c.h / 2 + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={12}
                      fontWeight={700}
                      fill="var(--surface-1)"
                      style={{ fontFamily: "var(--font-geist-mono), monospace" }}
                    >
                      {medicineInitials(slot.medicine_name)}
                    </text>
                  )}
                </>
              ) : slot?.state === "reserved" ? (
                <rect
                  x={c.x}
                  y={c.y}
                  width={c.w}
                  height={c.h}
                  rx={4}
                  fill={`url(#${uid}-stripe)`}
                  stroke={slot.medicine_name ? color : "var(--border-strong)"}
                  strokeWidth={1.5}
                />
              ) : (
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={4} fill="var(--surface-3)" stroke="var(--border-strong)" strokeWidth={1} />
              )}
              {slot?.cold_chain && (
                <>
                  <rect
                    x={c.x + 0.75}
                    y={c.y + 0.75}
                    width={c.w - 1.5}
                    height={c.h - 1.5}
                    rx={4}
                    fill="none"
                    stroke="var(--cyan)"
                    strokeWidth={1.5}
                  />
                  <rect x={c.x + c.w - 17} y={c.y + 3} width={14} height={14} rx={3} fill="var(--bg-elevated)" fillOpacity={0.85} />
                  <Snowflake cx={c.x + c.w - 10} cy={c.y + 10} r={4.5} />
                </>
              )}
              {selected && (
                <rect
                  x={c.x - 2}
                  y={c.y - 2}
                  width={c.w + 4}
                  height={c.h + 4}
                  rx={6}
                  fill="none"
                  stroke="var(--violet)"
                  strokeWidth={2.5}
                />
              )}
            </g>
          );
        })}
      </g>

      {/* wheels */}
      <Wheel cx={frontWheel} />
      {rearAxles.map((x) => (
        <Wheel key={x} cx={x} />
      ))}
    </svg>
  );
}
