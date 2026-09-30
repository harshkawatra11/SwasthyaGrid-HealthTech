"use client";

import { useMemo, useState } from "react";
import { Snowflake, Siren } from "lucide-react";
import { cn } from "@/lib/cn";
import { heatBin, heatColor, heatLegend } from "@/lib/heat";
import { COVER_SCALE, DISTRICT_ORDER, coverUnder, shortDistrict, shortMedicine, type StockRow } from "./derive";
import { HeatLegend, heatInk } from "./kit";

function fmtCover(d: number): string {
  return d < 10 ? d.toFixed(1) : String(Math.round(d));
}

/**
 * Hero of /inventory: 7 medicine rows by 40 facility columns, grouped under district bands.
 * Cell value is days of cover under the chosen demand factor.
 */
export function InventoryHeatmap({
  rows,
  facilities,
  factor,
  selectedFacility,
  onSelectFacility,
}: {
  rows: StockRow[];
  facilities: Array<{ id: string; name: string; districtId: string }>;
  factor: number;
  selectedFacility: string | null;
  onSelectFacility: (id: string | null) => void;
}) {
  const [hover, setHover] = useState<StockRow | null>(null);

  const medicines = useMemo(() => {
    const seen = new Map<string, { name: string; emergency: boolean; cold: boolean }>();
    for (const r of rows) if (!seen.has(r.medicine)) seen.set(r.medicine, { name: r.medicine, emergency: r.emergency, cold: r.coldChain });
    return [...seen.values()].sort((a, b) => Number(b.emergency) - Number(a.emergency) || a.name.localeCompare(b.name));
  }, [rows]);

  const cols = useMemo(() => {
    const present = new Set(rows.map((r) => r.facilityId));
    const list = facilities.filter((f) => present.has(f.id));
    return list.sort((a, b) => DISTRICT_ORDER.indexOf(a.districtId) - DISTRICT_ORDER.indexOf(b.districtId) || a.name.localeCompare(b.name, "en", { numeric: true }));
  }, [rows, facilities]);

  const groups = useMemo(() => {
    const g: Array<{ id: string; span: number }> = [];
    for (const c of cols) {
      const last = g[g.length - 1];
      if (last && last.id === c.districtId) last.span += 1;
      else g.push({ id: c.districtId, span: 1 });
    }
    return g;
  }, [cols]);

  const cell = useMemo(() => {
    const m = new Map<string, StockRow>();
    for (const r of rows) m.set(`${r.facilityId}|${r.medicine}`, r);
    return m;
  }, [rows]);

  const template = `150px repeat(${cols.length}, minmax(20px, 1fr))`;
  const legend = heatLegend(COVER_SCALE, (v) => `${v}d`);

  return (
    <div>
      <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-3">
        <div className="text-[12px] text-muted" aria-live="polite">
          {hover ? (
            <span>
              <span className="font-semibold text-text">{hover.facilityName}</span> ({shortDistrict(hover.districtId)}),{" "}
              <span className="text-text">{hover.medicine}</span>:{" "}
              <span className="num font-semibold text-text">{coverUnder(hover.days, factor).toFixed(1)} days</span> of cover,{" "}
              <span className="num">{hover.units}</span> {hover.unit}s on hand
            </span>
          ) : (
            "Hover or focus a cell for the facility, medicine and units on hand. Click a facility column to filter the table."
          )}
        </div>
        <HeatLegend labels={legend} empty="no stock row" />
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[980px] gap-x-[2px] gap-y-[2px]" style={{ gridTemplateColumns: template }}>
          <div />
          {groups.map((g) => (
            <div
              key={g.id}
              className="truncate rounded-[3px] border-b-2 border-border-strong px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
              style={{ gridColumn: `span ${g.span}` }}
              title={shortDistrict(g.id)}
            >
              {shortDistrict(g.id)}
            </div>
          ))}
          <div />
          {cols.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectFacility(selectedFacility === c.id ? null : c.id)}
              title={c.name}
              aria-pressed={selectedFacility === c.id}
              className={cn(
                "flex h-24 items-end justify-center rounded-[3px] pb-1 text-[10px] text-muted hover:text-text",
                selectedFacility === c.id && "bg-surface-3 text-text",
              )}
            >
              <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }} className="max-h-[88px] truncate">
                {c.name}
              </span>
            </button>
          ))}
          {medicines.map((m) => (
            <MedRow
              key={m.name}
              med={m}
              cols={cols}
              cell={cell}
              factor={factor}
              selectedFacility={selectedFacility}
              onHover={setHover}
            />
          ))}
          <div className="pr-2 text-right text-[11px] font-semibold leading-[28px] text-text">Weakest item</div>
          {cols.map((c) => {
            const mins = medicines
              .map((m) => cell.get(`${c.id}|${m.name}`))
              .filter((x): x is StockRow => !!x)
              .map((x) => coverUnder(x.days, factor));
            const min = mins.length ? Math.min(...mins) : null;
            const bin = min === null ? null : heatBin(min, COVER_SCALE);
            return (
              <div
                key={c.id}
                className="num flex h-7 items-center justify-center rounded-[3px] text-[10px] font-bold"
                style={{ backgroundColor: heatColor(min, COVER_SCALE), color: heatInk(bin), outline: "1px solid var(--border-strong)", outlineOffset: -1 }}
              >
                {min === null ? "-" : fmtCover(min)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MedRow({
  med,
  cols,
  cell,
  factor,
  selectedFacility,
  onHover,
}: {
  med: { name: string; emergency: boolean; cold: boolean };
  cols: Array<{ id: string; name: string }>;
  cell: Map<string, StockRow>;
  factor: number;
  selectedFacility: string | null;
  onHover: (r: StockRow | null) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-1.5 truncate pr-2 text-[12px] text-text" title={med.name}>
        <span className="truncate">{shortMedicine(med.name)}</span>
        {med.emergency && <Siren size={11} className="shrink-0 text-risk-stress" aria-label="Emergency medicine" />}
        {med.cold && <Snowflake size={11} className="shrink-0 text-cyan" aria-label="Cold chain" />}
      </div>
      {cols.map((c) => {
        const r = cell.get(`${c.id}|${med.name}`);
        const v = r ? coverUnder(r.days, factor) : null;
        const bin = v === null ? null : heatBin(v, COVER_SCALE);
        const dim = selectedFacility && selectedFacility !== c.id;
        return (
          <button
            key={c.id}
            type="button"
            title={r ? `${c.name}, ${med.name}: ${v?.toFixed(1)} days` : `${c.name}, ${med.name}: no stock row`}
            onMouseEnter={() => onHover(r ?? null)}
            onFocus={() => onHover(r ?? null)}
            onMouseLeave={() => onHover(null)}
            onBlur={() => onHover(null)}
            className={cn("num h-7 rounded-[3px] border-0 p-0 text-[10px] font-semibold", dim && "opacity-35")}
            style={{ backgroundColor: heatColor(v, COVER_SCALE), color: heatInk(bin) }}
          >
            {v === null ? "" : fmtCover(v)}
          </button>
        );
      })}
    </>
  );
}
