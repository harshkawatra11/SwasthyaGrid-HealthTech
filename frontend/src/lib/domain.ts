export type RiskLevel = "healthy" | "monitor" | "stress" | "critical";

export type ShipmentStatus =
  | "recommended"
  | "approved"
  | "loading"
  | "in_transit"
  | "delayed"
  | "arrived"
  | "delivered"
  | "cancelled";

export type Priority = "critical" | "high" | "normal";

export const RISK_LABEL: Record<RiskLevel, string> = {
  healthy: "Healthy",
  monitor: "Monitor",
  stress: "Stress",
  critical: "Critical",
};

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  recommended: "Recommended",
  approved: "Approved",
  loading: "Loading",
  in_transit: "In transit",
  delayed: "Delayed",
  arrived: "Arrived",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
};

/** Raw CSS token strings for JS and SVG use (never the --color-* names). */
export function riskVar(level: RiskLevel): string {
  return `var(--risk-${level})`;
}

/** in_transit maps to --status-in-transit. */
export function statusVar(status: ShipmentStatus): string {
  return `var(--status-${status.replace(/_/g, "-")})`;
}

export function priorityVar(p: Priority): string {
  return p === "critical" ? "var(--red)" : p === "high" ? "var(--orange)" : "var(--text-muted)";
}

/** Solid fill on a 12% tint of the same colour. */
export function tint(colorVar: string, pct = 12): string {
  return `color-mix(in srgb, ${colorVar} ${pct}%, transparent)`;
}
