"use client";

import { useEntityIndex } from "@/lib/entity-index";

export interface PerformanceRow {
  facility_id: string;
  facility_name?: string;
  overall: number;
  inventory: number;
  attendance: number;
  diagnostics: number;
  patient_wait: number;
  forecast_accuracy: number;
}

const subScores: { key: keyof PerformanceRow; label: string }[] = [
  { key: "inventory", label: "Inventory" },
  { key: "attendance", label: "Attendance" },
  { key: "diagnostics", label: "Diagnostics" },
  { key: "patient_wait", label: "Patient Wait" },
  { key: "forecast_accuracy", label: "Forecast Accuracy" },
];

export function PerformanceScores({ rows }: { rows: PerformanceRow[] }) {
  const { facilityName } = useEntityIndex();
  return (
    <div className="overflow-x-auto border border-hairline">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline bg-paper-dim/60">
            <th className="text-left font-medium text-ink-soft px-4 py-3 text-xs uppercase tracking-wider">
              Facility
            </th>
            <th className="text-right font-medium text-ink-soft px-4 py-3 text-xs uppercase tracking-wider">
              Overall
            </th>
            {subScores.map((s) => (
              <th
                key={s.key}
                className="text-right font-medium text-ink-soft px-4 py-3 text-xs uppercase tracking-wider"
              >
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows
            .slice()
            .sort((a, b) => a.overall - b.overall)
            .map((f) => (
              <tr key={f.facility_id} className="border-b border-hairline last:border-0">
                <td className="px-4 py-3 text-ink font-medium">{facilityName(f.facility_id)}</td>
                <td className="px-4 py-3 text-right tabular font-serif-display text-accent-clay">
                  {f.overall}
                </td>
                {subScores.map((s) => (
                  <td key={s.key} className="px-4 py-3 text-right tabular text-ink-soft">
                    {f[s.key]}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
