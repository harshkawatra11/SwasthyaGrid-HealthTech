import Link from "next/link";
import type { ReactNode } from "react";
import { RiskChip } from "@/components/ds/RiskChip";
import { StatusChip } from "@/components/ds/StatusChip";
import { Stepper, type Step } from "@/components/ds/Stepper";
import { fmtClock, fmtDuration, fmtInt } from "@/lib/format";
import { STATUS_LABEL, type RiskLevel, type ShipmentStatus } from "@/lib/domain";
import type { FactCard as FactCardData } from "@/lib/voice/protocol";

const RISK_LEVELS: readonly string[] = ["healthy", "monitor", "stress", "critical"];

function asRisk(v: string | null | undefined): RiskLevel | null {
  return v && RISK_LEVELS.includes(v) ? (v as RiskLevel) : null;
}

function asStatus(v: string): ShipmentStatus | null {
  return v in STATUS_LABEL ? (v as ShipmentStatus) : null;
}

/** ETA arrives as minutes from now (number) or an ISO timestamp (string). */
export function formatEta(eta: string | number | null | undefined): string | null {
  if (eta === null || eta === undefined || eta === "") return null;
  if (typeof eta === "number") return eta <= 0 ? "Arriving now" : `in ${fmtDuration(eta)}`;
  return /^\d{4}-\d{2}-\d{2}T/.test(eta) ? fmtClock(eta) : eta;
}

const RISK_ORDER: RiskLevel[] = ["critical", "stress", "monitor", "healthy"];

const SHIPMENT_STEPS: { key: ShipmentStatus; label: string }[] = [
  { key: "loading", label: "Loading" },
  { key: "in_transit", label: "In transit" },
  { key: "arrived", label: "Arrived" },
  { key: "delivered", label: "Delivered" },
];

export function shipmentSteps(status: string): Step[] {
  // Delayed is an in-transit shipment; earlier states (recommended, approved) sit before loading.
  const effective = status === "delayed" ? "in_transit" : status;
  const idx = SHIPMENT_STEPS.findIndex((s) => s.key === effective);
  return SHIPMENT_STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    state: idx === -1 ? "upcoming" : i < idx ? "done" : i === idx ? (effective === "delivered" ? "done" : "current") : "upcoming",
  }));
}

function Shell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      data-testid="fact-card"
      aria-label={label}
      className="rounded-md border border-border bg-surface-2 p-3 text-[12px] shadow-[var(--inset-highlight)]"
    >
      <p className="eyebrow mb-2">{label}</p>
      {children}
    </section>
  );
}

const linkCls = "text-text underline-offset-2 hover:text-brand hover:underline";

export function FactCard({ card }: { card: FactCardData }) {
  switch (card.type) {
    case "district_summary":
      return (
        <Shell label="District summary">
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/districts/${card.district_id}`} className={`${linkCls} text-[13px] font-semibold`}>
              {card.name}
            </Link>
            {card.risk_index !== null && card.risk_index !== undefined && (
              <span className="text-muted">
                Risk index <span className="num text-text">{Math.round(card.risk_index)}</span>
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {RISK_ORDER.map((level) => {
              const n = card.risk_counts[level];
              return n ? (
                <span key={level} className="inline-flex items-center gap-1">
                  <RiskChip level={level} size="sm" />
                  <span className="num text-muted">{fmtInt(n)}</span>
                </span>
              ) : null;
            })}
          </div>
          {card.critical.length > 0 && (
            <div className="mt-2">
              <p className="text-muted">Critical facilities</p>
              <ul className="mt-1 space-y-0.5">
                {card.critical.map((f) => (
                  <li key={f.id}>
                    <Link href={`/facilities/${f.id}`} className={linkCls}>
                      {f.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Shell>
      );

    case "facility": {
      const level = asRisk(card.risk);
      return (
        <Shell label="Facility">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/facilities/${card.facility_id}`} className={`${linkCls} block truncate text-[13px] font-semibold`}>
                {card.name}
              </Link>
              {card.district_name && <p className="text-muted">{card.district_name}</p>}
            </div>
            {level && <RiskChip level={level} size="sm" />}
          </div>
          {card.medicines.length > 0 && (
            <table className="mt-2 w-full">
              <thead>
                <tr className="text-left text-[11px] text-muted">
                  <th className="py-0.5 font-medium">Medicine</th>
                  <th className="py-0.5 text-right font-medium">Days</th>
                  <th className="py-0.5 text-right font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {card.medicines.map((m) => {
                  const r = asRisk(m.risk);
                  return (
                    <tr key={m.name} className="border-t border-border">
                      <td className="py-1 pr-2">{m.name}</td>
                      <td className="num py-1 text-right">{m.days === null ? "-" : m.days.toFixed(1)}</td>
                      <td className="py-1 text-right">{r ? <RiskChip level={r} size="sm" /> : m.risk}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {card.beds_next_week !== null && card.beds_next_week !== undefined && (
            <p className="mt-2 text-muted">
              Beds next week <span className="num text-text">{Math.round(card.beds_next_week)}%</span>
            </p>
          )}
        </Shell>
      );
    }

    case "shortages":
      return (
        <Shell label="Shortages">
          {card.rows.length === 0 ? (
            <p className="text-muted">No shortages found.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] text-muted">
                  <th className="py-0.5 font-medium">Facility</th>
                  <th className="py-0.5 font-medium">Medicine</th>
                  <th className="py-0.5 text-right font-medium">Days</th>
                </tr>
              </thead>
              <tbody>
                {card.rows.map((r, i) => (
                  <tr key={`${r.facility_id}-${r.medicine}-${i}`} className="border-t border-border">
                    <td className="py-1 pr-2">
                      <Link href={`/facilities/${r.facility_id}`} className={linkCls}>
                        {r.facility}
                      </Link>
                      <span className="block text-[11px] text-muted">{r.district}</span>
                    </td>
                    <td className="py-1 pr-2">{r.medicine}</td>
                    <td className="num py-1 text-right">{r.days === null ? "-" : r.days.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Shell>
      );

    case "ranking": {
      const max = Math.max(...card.rows.map((r) => Math.abs(r.value)), 0);
      return (
        <Shell label={`Ranking: ${card.metric.replace(/_/g, " ")}`}>
          <ul className="space-y-1.5">
            {card.rows.map((r) => (
              <li key={r.district_id}>
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/districts/${r.district_id}`} className={linkCls}>
                    {r.name}
                  </Link>
                  <span className="num text-text">
                    {Number.isInteger(r.value) ? fmtInt(r.value) : r.value.toFixed(1)}
                    {card.unit && <span className="ml-1 text-muted">{card.unit}</span>}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${max > 0 ? Math.max(4, (Math.abs(r.value) / max) * 100) : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Shell>
      );
    }

    case "shipments":
      return (
        <Shell label="Shipments">
          {card.rows.length === 0 ? (
            <p className="text-muted">No shipments found.</p>
          ) : (
            <ul className="space-y-1.5">
              {card.rows.map((r) => {
                const status = asStatus(r.status);
                const eta = formatEta(r.eta);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/supply/shipments/${r.id}`} className={`${linkCls} num`}>
                        {r.id}
                      </Link>
                      <p className="truncate text-[11px] text-muted">{r.destination}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      {status ? <StatusChip status={status} size="sm" /> : <span>{r.status}</span>}
                      {eta && <span className="num text-[11px] text-muted">{eta}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Shell>
      );

    case "shipment": {
      const status = asStatus(card.status);
      const eta = formatEta(card.eta);
      return (
        <Shell label="Shipment">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/supply/shipments/${card.id}`} className={`${linkCls} num text-[13px] font-semibold`}>
              {card.id}
            </Link>
            {status ? <StatusChip status={status} size="sm" /> : <span>{card.status}</span>}
          </div>
          <div className="mt-3">
            <Stepper steps={shipmentSteps(card.status)} />
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {eta && (
              <>
                <dt className="text-muted">ETA</dt>
                <dd className="num text-right">{eta}</dd>
              </>
            )}
            {card.progress !== null && card.progress !== undefined && (
              <>
                <dt className="text-muted">Progress</dt>
                <dd className="num text-right">{Math.round(card.progress)}%</dd>
              </>
            )}
            {card.driver && (
              <>
                <dt className="text-muted">Driver</dt>
                <dd className="text-right">{card.driver}</dd>
              </>
            )}
            {card.vehicle && (
              <>
                <dt className="text-muted">Vehicle</dt>
                <dd className="text-right">{card.vehicle}</dd>
              </>
            )}
            {card.temp_c !== null && card.temp_c !== undefined && (
              <>
                <dt className="text-muted">Temperature</dt>
                <dd className="num text-right">{card.temp_c.toFixed(1)} C</dd>
              </>
            )}
          </dl>
        </Shell>
      );
    }

    case "fleet": {
      const entries = Object.entries(card.counts);
      return (
        <Shell label="Fleet">
          <div className="grid grid-cols-3 gap-2">
            {entries.map(([k, v]) => (
              <div key={k} className="rounded-sm bg-surface-1 px-2 py-1.5">
                <p className="num text-[16px] font-semibold">{fmtInt(v)}</p>
                <p className="text-[11px] capitalize text-muted">{k.replace(/_/g, " ")}</p>
              </div>
            ))}
            {card.queued !== null && card.queued !== undefined && (
              <div className="rounded-sm bg-surface-1 px-2 py-1.5">
                <p className="num text-[16px] font-semibold">{fmtInt(card.queued)}</p>
                <p className="text-[11px] text-muted">queued</p>
              </div>
            )}
          </div>
        </Shell>
      );
    }
  }
}
