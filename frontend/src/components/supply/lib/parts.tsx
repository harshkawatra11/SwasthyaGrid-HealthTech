import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Chip } from "@/components/ds/chip";
import { cn } from "@/lib/cn";
import type { DriverLiveStatus, VehicleLiveStatus } from "@/lib/api/types";

/** Source line (left) and sub-section label (right), bottom edge of every analytic card. */
export function SourceFooter({ source, section }: { source: string; section: string }) {
  return (
    <span className="flex items-center justify-between gap-3">
      <span className="truncate">Source: {source}</span>
      <span className="shrink-0">{section}</span>
    </span>
  );
}

/** One line "Read" caption under a chart: the so-what, with an accent rule. */
export function Callout({ children, tone = "brand", className }: { children: ReactNode; tone?: "brand" | "amber" | "red" | "violet"; className?: string }) {
  const color = { brand: "var(--brand)", amber: "var(--amber)", red: "var(--red)", violet: "var(--violet)" }[tone];
  return (
    <p
      className={cn("flex items-start gap-2 rounded-sm bg-surface-2 py-1.5 pl-2.5 pr-3 text-[12px] leading-snug text-muted", className)}
      style={{ borderLeft: `2px solid ${color}` }}
    >
      <Info size={13} aria-hidden className="mt-px shrink-0 text-faint" />
      <span>{children}</span>
    </p>
  );
}

const VEHICLE_STATUS: Record<VehicleLiveStatus, { label: string; color: string }> = {
  available: { label: "Available", color: "var(--green)" },
  scheduled: { label: "Scheduled", color: "var(--violet)" },
  loading: { label: "Loading", color: "var(--status-loading)" },
  in_transit: { label: "In transit", color: "var(--status-in-transit)" },
  delayed: { label: "Delayed", color: "var(--status-delayed)" },
  returning: { label: "Returning", color: "var(--series-1)" },
  maintenance: { label: "Maintenance", color: "var(--red)" },
};

export function VehicleStatusChip({ status, size = "sm" }: { status: VehicleLiveStatus; size?: "sm" | "md" }) {
  const s = VEHICLE_STATUS[status] ?? { label: status, color: "var(--text-muted)" };
  return <Chip label={s.label} color={s.color} size={size} />;
}

export function vehicleStatusColor(status: VehicleLiveStatus): string {
  return VEHICLE_STATUS[status]?.color ?? "var(--text-muted)";
}

const DRIVER_STATUS: Record<DriverLiveStatus, { label: string; color: string }> = {
  off_shift: { label: "Off shift", color: "var(--text-muted)" },
  available: { label: "Available", color: "var(--green)" },
  assigned: { label: "Assigned", color: "var(--violet)" },
  driving: { label: "Driving", color: "var(--status-in-transit)" },
  resting: { label: "Resting", color: "var(--series-1)" },
};

export function DriverStatusChip({ status, size = "sm" }: { status: DriverLiveStatus; size?: "sm" | "md" }) {
  const s = DRIVER_STATUS[status] ?? { label: status, color: "var(--text-muted)" };
  return <Chip label={s.label} color={s.color} size={size} />;
}

/** Small donut (SVG) with a centre label; used by the metric tiles under the truck. */
export function MiniDonut({ pct, color = "var(--brand)", size = 34 }: { pct: number; color?: string; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, pct));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(p)} percent`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={`${(p / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** Icon + label + value tile, as the six tiles under the truck in reference image 1. */
export function MetricTile({
  icon,
  label,
  value,
  sub,
  aside,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-md border border-border bg-surface-2 px-2.5 py-2">
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-3 text-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] uppercase tracking-[0.1em] text-muted">{label}</p>
        <p className="num truncate text-[13px] font-semibold text-text">{value}</p>
        {sub && <p className="truncate text-[10px] text-faint">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

/** Short depot label: "Central, Jaipur" or the district name for a DDW. */
export function depotLabel(name: string): string {
  if (name.startsWith("State Central Drug Warehouse")) return "Central, " + name.split(", ").slice(1).join(", ");
  return name.replace(/^District Drug Warehouse, /, "");
}

/**
 * Column wrapper whose child fills the row height set by a taller sibling column instead of
 * stretching the row (the child scrolls inside).
 */
export function FillColumn({ children, minHeight = 560, className }: { children: ReactNode; minHeight?: number; className?: string }) {
  return (
    <div className={cn("relative", className)} style={{ minHeight }}>
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}

/** Card whose body scrolls: header 44px, flexible body, footer. Used by the list columns. */
export function PanelCard({
  eyebrow,
  title,
  actions,
  footer,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex h-full min-h-0 flex-col rounded-md border border-border bg-surface-1 shadow-[var(--inset-highlight)]", className)}>
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-baseline gap-2">
          {eyebrow && <span className="eyebrow shrink-0">{eyebrow}</span>}
          <h3 className="truncate text-[13px] font-semibold text-text">{title}</h3>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {footer && <footer className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-faint">{footer}</footer>}
    </section>
  );
}
