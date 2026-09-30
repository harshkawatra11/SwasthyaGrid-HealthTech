import { cn } from "@/lib/cn";

/**
 * Simple reusable truck side view (cab on the right, box trailer on the left, facing right).
 * Pure SVG in tokens, so it works in both themes. `accent` tints the cab stripe and the
 * reefer unit; pass a `var(--status-...)` token to colour it by state.
 */
export function TruckSilhouette({
  className,
  accent = "var(--brand)",
  coldChain = false,
  label,
}: {
  className?: string;
  accent?: string;
  coldChain?: boolean;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 320 130"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("h-auto w-full", className)}
    >
      <defs>
        <linearGradient id="ts-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--surface-3)" />
          <stop offset="100%" stopColor="var(--surface-2)" />
        </linearGradient>
      </defs>
      {/* trailer box */}
      <rect x="6" y="14" width="208" height="84" rx="6" fill="url(#ts-body)" stroke="var(--border-strong)" strokeWidth="1.5" />
      <path d="M6 76h208" stroke="var(--border-strong)" strokeWidth="1" />
      <path d="M52 14v84M98 14v84M144 14v84M190 14v84" stroke="var(--border)" strokeWidth="1" />
      {coldChain && (
        <g>
          <rect x="16" y="24" width="30" height="22" rx="3" fill="none" stroke={accent} strokeWidth="1.5" />
          <path d="M31 28v14M24 35h14M26 30l10 10M36 30L26 40" stroke={accent} strokeWidth="1" strokeLinecap="round" />
        </g>
      )}
      <rect x="6" y="80" width="208" height="4" fill={accent} opacity="0.85" />
      {/* cab */}
      <path
        d="M222 30h40c6 0 10 2 13 7l25 32c2 3 3 5 3 9v20c0 3-2 5-5 5h-76z"
        fill="url(#ts-body)"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      <path d="M262 38l24 30h-52V38z" fill="var(--bg-elevated)" stroke="var(--border-strong)" strokeWidth="1" />
      <rect x="222" y="86" width="90" height="4" fill={accent} opacity="0.85" />
      <rect x="305" y="92" width="8" height="8" rx="2" fill="var(--amber)" opacity="0.9" />
      {/* chassis */}
      <rect x="6" y="98" width="306" height="8" rx="2" fill="var(--surface-3)" stroke="var(--border-strong)" strokeWidth="1" />
      {/* wheels */}
      {[52, 92, 262].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="108" r="16" fill="var(--bg)" stroke="var(--border-strong)" strokeWidth="2" />
          <circle cx={cx} cy="108" r="6" fill="var(--surface-3)" stroke="var(--text-faint)" strokeWidth="1" />
        </g>
      ))}
    </svg>
  );
}
