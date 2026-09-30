import { cn } from "@/lib/cn";
import { riskVar, type RiskLevel } from "@/lib/domain";

/** under 70 good, 70 to 90 warning, over 90 critical */
export function meterAutoColor(pct: number): string {
  if (pct > 90) return "var(--risk-critical)";
  if (pct >= 70) return "var(--risk-monitor)";
  return "var(--risk-healthy)";
}

export function Meter({
  value,
  max,
  tone = "auto",
  label,
  showValue = true,
  className,
}: {
  value: number;
  max: number;
  tone?: "auto" | RiskLevel;
  label?: string;
  showValue?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = tone === "auto" ? meterAutoColor(pct) : riskVar(tone);
  return (
    <div className={cn("w-full", className)}>
      {(label || showValue) && (
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
          <span>{label}</span>
          {showValue && <span className="num">{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label ?? "Meter"}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
