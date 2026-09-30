"use client";

import { heatBin, type HeatScale } from "@/lib/heat";

export const SCORE_SCALE: HeatScale = { thresholds: [90, 80, 70, 60], higherIsWorse: false };

export type TreeLeaf = { label: string; value: string };
export type TreeBranch = { id: string; label: string; score: number | null; unit?: string; state: string | null; leaves: TreeLeaf[] };
export type TreeRoot = { label: string; score: number | null; sub: string };

function binColor(v: number | null): string {
  const b = v === null ? null : heatBin(v, SCORE_SCALE);
  return b === null ? "var(--border-strong)" : `var(--heat-${b})`;
}

const W = 980;
const ROW = 84;

/**
 * KPI tree as a connected node diagram: performance score on the left, its four components in the
 * middle, and the measured drivers of each component on the right. State averages sit under values.
 */
export function KpiTree({ root, branches }: { root: TreeRoot; branches: TreeBranch[] }) {
  const H = branches.length * ROW + 16;
  const rootY = H / 2;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Performance KPI tree" className="min-w-[560px]" style={{ width: "100%", height: "auto" }}>
        {/* root to branches */}
        {branches.map((b, i) => {
          const y = 8 + i * ROW + ROW / 2 - 4;
          return (
            <path
              key={`rb-${b.id}`}
              d={`M 200 ${rootY} C 250 ${rootY}, 250 ${y}, 300 ${y}`}
              fill="none"
              stroke={binColor(b.score)}
              strokeWidth={2}
              opacity={0.9}
            />
          );
        })}
        {/* branches to leaves */}
        {branches.map((b, i) => {
          const y = 8 + i * ROW + ROW / 2 - 4;
          return b.leaves.map((l, j) => {
            const ly = 8 + i * ROW + 6 + j * 34 + 15;
            return <path key={`bl-${b.id}-${j}`} d={`M 520 ${y} C 560 ${y}, 560 ${ly}, 600 ${ly}`} fill="none" stroke="var(--border-strong)" strokeWidth={1.5} />;
          });
        })}
        {/* root */}
        <g>
          <rect x={10} y={rootY - 46} width={190} height={92} rx={10} fill="var(--surface-2)" stroke={binColor(root.score)} strokeWidth={2} />
          <text x={26} y={rootY - 22} fontSize={10} fill="var(--text-muted)" letterSpacing="0.1em">
            {root.label.toUpperCase()}
          </text>
          <text x={26} y={rootY + 14} fontSize={34} fontWeight={600} fill="var(--text)" fontFamily="var(--font-geist-mono)">
            {root.score === null ? "n/a" : Math.round(root.score)}
          </text>
          <text x={26} y={rootY + 34} fontSize={10} fill="var(--text-muted)">
            {root.sub}
          </text>
        </g>
        {branches.map((b, i) => {
          const y0 = 8 + i * ROW;
          const y = y0 + ROW / 2 - 4;
          return (
            <g key={b.id}>
              <rect x={300} y={y - 30} width={220} height={60} rx={8} fill="var(--surface-2)" stroke={binColor(b.score)} strokeWidth={1.5} />
              <rect x={300} y={y - 30} width={6} height={60} rx={3} fill={binColor(b.score)} />
              <text x={320} y={y - 10} fontSize={11} fill="var(--text-muted)">
                {b.label}
              </text>
              <text x={320} y={y + 18} fontSize={22} fontWeight={600} fill="var(--text)" fontFamily="var(--font-geist-mono)">
                {b.score === null ? "n/a" : Math.round(b.score)}
                <tspan fontSize={11} fill="var(--text-muted)" fontWeight={400}>
                  {b.unit ?? ""}
                </tspan>
              </text>
              {b.state && (
                <text x={508} y={y + 18} fontSize={10} textAnchor="end" fill="var(--text-faint)">
                  {b.state}
                </text>
              )}
              {b.leaves.map((l, j) => {
                const ly = y0 + 6 + j * 34;
                return (
                  <g key={l.label}>
                    <rect x={600} y={ly} width={370} height={30} rx={6} fill="var(--surface-1)" stroke="var(--border)" />
                    <text x={614} y={ly + 19} fontSize={11} fill="var(--text-muted)">
                      {l.label}
                    </text>
                    <text x={956} y={ly + 19} fontSize={12} fontWeight={600} textAnchor="end" fill="var(--text)" fontFamily="var(--font-geist-mono)">
                      {l.value}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
