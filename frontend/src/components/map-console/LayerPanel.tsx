"use client";

import { RISK_LABEL, riskVar, type RiskLevel } from "@/lib/domain";
import { LAYERS, type LayerKey } from "./console";

const RISK_ORDER: RiskLevel[] = ["healthy", "monitor", "stress", "critical"];

export type JumpDistrict = { id: string; name: string; shortName: string };

/** Layer toggle panel: one checkbox per map layer, a static risk legend, and
 *  the district jump buttons (moved here from under the map so the page fits
 *  a 1920x1080 viewport without scrolling). */
export function LayerPanel({
  state,
  onToggle,
  districts,
  onJump,
}: {
  state: Record<LayerKey, boolean>;
  onToggle: (key: LayerKey) => void;
  districts: JumpDistrict[];
  onJump: (districtId: string) => void;
}) {
  return (
    <div className="flex w-[220px] shrink-0 flex-col gap-4 rounded-md border border-border bg-surface-1 p-3 shadow-[var(--inset-highlight)]">
      <div role="group" aria-label="Map layers" className="space-y-2">
        <p className="eyebrow">Layers</p>
        {LAYERS.map((l) => (
          <label key={l.key} className="flex items-center gap-2 text-[12px] text-text">
            <input
              type="checkbox"
              checked={state[l.key]}
              onChange={() => onToggle(l.key)}
              disabled={l.key === "delayedOnly" && !state.trucks && !state.routes}
              className="h-3.5 w-3.5 rounded-sm border-border-strong accent-[var(--brand)]"
            />
            {l.label}
          </label>
        ))}
      </div>
      <div aria-label="Legend">
        <p className="eyebrow mb-1.5">Risk legend</p>
        <ul className="space-y-1 text-[11px] text-muted">
          {RISK_ORDER.map((k) => (
            <li key={k} className="inline-flex w-full items-center gap-1.5">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: riskVar(k) }} />
              {RISK_LABEL[k]}
            </li>
          ))}
        </ul>
      </div>
      <div aria-label="Jump to district" className="flex flex-wrap gap-1.5">
        {districts.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onJump(d.id)}
            aria-label={`Open drawer for ${d.name}`}
            className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[11px] text-text hover:bg-surface-3"
          >
            {d.shortName}
          </button>
        ))}
      </div>
    </div>
  );
}
