import { riskColor, riskLabel } from "@/data/district";
import type { FacilityView } from "@/lib/facility-view";

export function RiskHeatmap({ facilities }: { facilities: FacilityView[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {facilities.map((f) => (
        <div
          key={f.id}
          className="border border-hairline bg-paper-dim/50 p-4 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">{f.name}</span>
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: riskColor[f.riskLevel] }}
            />
          </div>
          <p className="text-xs text-ink-soft">{f.type}</p>
          <p
            className="text-xs font-medium tracking-wide uppercase"
            style={{ color: riskColor[f.riskLevel] }}
          >
            {riskLabel[f.riskLevel]}
          </p>
        </div>
      ))}
    </div>
  );
}
