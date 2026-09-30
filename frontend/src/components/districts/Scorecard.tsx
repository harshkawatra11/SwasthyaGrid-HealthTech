import { heatColor } from "@/lib/heat";
import { RISK_LABEL } from "@/lib/domain";
import type { DistrictSummaryRow, FacilityMatrix, RecommendationV2, StateSummary } from "@/lib/api/types";
import { shortMedicine, shortName } from "./metrics";

/**
 * One A4 page: KPIs, heatmap row per facility, top 5 risks, actions taken.
 * Hidden on screen; the print stylesheet shows only this block, in light colours.
 */
export const PRINT_CSS = `
.sg-scorecard { display: none; }
@media print {
  @page { size: A4; margin: 12mm; }
  body * { visibility: hidden !important; }
  .sg-scorecard, .sg-scorecard * { visibility: visible !important; }
  .sg-scorecard {
    display: block !important; position: absolute; left: 0; top: 0; width: 100%;
    background: #fff; color: #0f172a; font-size: 10.5px; line-height: 1.35;
    --text: #0f172a; --text-muted: #475467; --border: #e2e7ee;
    --heat-0: #d7f0e6; --heat-1: #9ad8bf; --heat-2: #f3d58c; --heat-3: #f2a27a; --heat-4: #e2626f; --heat-empty: #eef1f5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sg-scorecard table { width: 100%; border-collapse: collapse; }
  .sg-scorecard th, .sg-scorecard td { border-bottom: 1px solid #e2e7ee; padding: 3px 5px; text-align: left; }
  .sg-scorecard .num { font-variant-numeric: tabular-nums; }
}
`;

export function Scorecard({
  row,
  matrix,
  topRisks,
  actions,
  generatedAt,
  facilityName,
}: {
  row: DistrictSummaryRow;
  matrix: FacilityMatrix;
  topRisks: StateSummary["top_risks"];
  actions: RecommendationV2[];
  generatedAt: string;
  facilityName: (id: string) => string;
}) {
  const kpis: Array<[string, string]> = [
    ["Risk index", String(row.risk_index)],
    ["Critical facilities", `${row.risk_counts.critical} of ${row.facilities}`],
    ["Stock-out items", String(row.stockout_items)],
    ["Beds next week", `${Math.round(row.bed_next_week_avg)}%`],
    ["Doctors at risk", String(row.doctors_high_risk)],
    ["Diagnostics down", String(row.diagnostics_down)],
    ["Pending approvals", String(row.pending_recommendations)],
    ["In transit", String(row.shipments_in_transit)],
  ];
  const fmt = (dimId: string, v: number | null) => (v === null ? "-" : dimId === "beds" ? `${Math.round(v)}%` : dimId === "supply" ? `${v}h` : String(Math.round(v * 10) / 10));
  return (
    <div className="sg-scorecard" aria-hidden>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{shortName(row.name)} district scorecard</h1>
      <p style={{ margin: "2px 0 10px", color: "#475467" }}>SwasthyaGrid, generated {generatedAt}. Simulated operational data and seed data.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 }}>
        {kpis.map(([k, v]) => (
          <div key={k} style={{ border: "1px solid #e2e7ee", borderRadius: 4, padding: "4px 6px" }}>
            <div style={{ fontSize: 9, textTransform: "uppercase", color: "#475467" }}>{k}</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      <h2 style={{ fontSize: 12, fontWeight: 700, margin: "0 0 4px" }}>Facility heatmap row</h2>
      <table>
        <thead>
          <tr>
            <th>Facility</th>
            <th>Risk</th>
            {matrix.dimensions.map((d) => (
              <th key={d.id}>{d.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((r) => (
            <tr key={r.facility_id}>
              <td>{r.facility_name}</td>
              <td>{RISK_LABEL[r.risk_level]}</td>
              {matrix.dimensions.map((d) => {
                const v = r.values[d.id] ?? null;
                return (
                  <td key={d.id} className="num" style={{ background: heatColor(v, { thresholds: d.thresholds as [number, number, number, number], higherIsWorse: d.higher_is_worse }) }}>
                    {fmt(d.id, v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <h2 style={{ fontSize: 12, fontWeight: 700, margin: "10px 0 4px" }}>Top 5 risks</h2>
      <table>
        <tbody>
          {topRisks.slice(0, 5).map((t) => (
            <tr key={`${t.facility_id}-${t.medicine_name}`}>
              <td>{t.facility_name}</td>
              <td>{shortMedicine(t.medicine_name)}</td>
              <td className="num">{t.days_remaining.toFixed(1)} days of cover</td>
              <td>{t.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 style={{ fontSize: 12, fontWeight: 700, margin: "10px 0 4px" }}>Actions taken</h2>
      {actions.length === 0 ? (
        <p>No approved or completed actions yet.</p>
      ) : (
        <table>
          <tbody>
            {actions.slice(0, 6).map((a) => (
              <tr key={a.id}>
                <td>{a.subject}</td>
                <td>{facilityName(a.target_facility_id)}</td>
                <td>{a.status}</td>
                <td>{a.resolved_by ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
