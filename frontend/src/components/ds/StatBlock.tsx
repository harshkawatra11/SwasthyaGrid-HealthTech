import { cn } from "@/lib/cn";

export type StatItem = { label: string; value: string | number; mono?: boolean };

const COLS = { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" } as const;

export function StatBlock({ items, columns = 2 }: { items: StatItem[]; columns?: 2 | 3 | 4 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", COLS[columns])}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="eyebrow">{it.label}</dt>
          <dd className={cn("mt-0.5 truncate text-[13px] text-text", it.mono && "num")}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
