"use client";

import { useState, type ReactNode } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ds/overlays";
import { approveRecommendation, modifyRecommendation, rejectRecommendation } from "@/lib/api/mutations";
import type { RecommendationV2 } from "@/lib/api/types";
import { fmtDuration, fmtKm } from "@/lib/format";
import { roleCapabilities, roleLabels, useRole } from "@/lib/roleContext";
import { cn } from "@/lib/cn";

const BTN =
  "inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[12px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50";

export function useCanApprove(): { canApprove: boolean; actor: string } {
  const { role } = useRole();
  return { canApprove: roleCapabilities[role].canApprove, actor: roleLabels[role] };
}

/** Numeric part of a quantity, used to prefill the override field. */
export function defaultQuantity(rec: Pick<RecommendationV2, "quantity" | "quantity_or_detail">): string {
  if (rec.quantity !== null && rec.quantity !== undefined) return String(rec.quantity);
  const m = rec.quantity_or_detail.match(/\d+/);
  return m ? m[0] : "";
}

/** Body of the override sent to the backend: only when the value differs from the recommendation. */
export function quantityOverride(rec: Pick<RecommendationV2, "quantity" | "quantity_or_detail">, entered: string): string | undefined {
  const clean = entered.trim();
  return clean !== "" && clean !== defaultQuantity(rec) ? clean : undefined;
}

type ActionProps = { rec: RecommendationV2; sourceName: string; targetName: string; compact?: boolean };

function Summary({ rec, sourceName, targetName }: Pick<ActionProps, "rec" | "sourceName" | "targetName">) {
  return (
    <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-[12px]">
      <dt className="text-muted">Item</dt>
      <dd className="text-text">{rec.subject}</dd>
      <dt className="text-muted">Route</dt>
      <dd className="text-text">
        {sourceName} to {targetName}
      </dd>
      <dt className="text-muted">Distance</dt>
      <dd className="num text-text">{rec.distance_km !== null ? fmtKm(rec.distance_km) : "n/a"}</dd>
      <dt className="text-muted">ETA</dt>
      <dd className="num text-text">{rec.eta_minutes !== null ? fmtDuration(rec.eta_minutes) : "n/a"}</dd>
    </dl>
  );
}

function QuantityField({ value, onChange, unit, id }: { value: string; onChange: (v: string) => void; unit: string | null; id: string }) {
  return (
    <label htmlFor={id} className="mt-3 block text-[11px] text-muted">
      Quantity{unit ? ` (${unit}s)` : ""}
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        className="num mt-1 block w-full rounded-sm border border-border-strong bg-surface-1 px-2 py-1.5 text-[13px] text-text focus:border-brand focus:outline-none"
      />
    </label>
  );
}

function Shell({ trigger, children, open, onOpenChange }: { trigger: ReactNode; children: ReactNode; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function ApproveAction({ rec, sourceName, targetName, compact }: ActionProps) {
  const { canApprove, actor } = useCanApprove();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(defaultQuantity(rec));
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const override = quantityOverride(rec, qty);
    const res = await approveRecommendation(rec.id, { actor, ...(override ? { quantity_override: override } : {}) });
    setBusy(false);
    if (res) setOpen(false);
  }

  return (
    <Shell
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          disabled={!canApprove}
          title={canApprove ? undefined : "Your role cannot approve"}
          data-testid={`approve-${rec.id}`}
          className={cn(BTN, "border-brand bg-brand-soft text-brand hover:bg-brand hover:text-[var(--bg)]", compact && "px-1.5 py-0.5 text-[11px]")}
        >
          <Check size={12} aria-hidden /> Approve
        </button>
      }
    >
      <p className="mb-2 text-[13px] font-semibold text-text">Approve this recommendation?</p>
      <Summary rec={rec} sourceName={sourceName} targetName={targetName} />
      <QuantityField id={`qty-${rec.id}`} value={qty} onChange={setQty} unit={rec.unit} />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={cn(BTN, "border-border-strong text-muted hover:text-text")} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || qty === ""}
          data-testid={`confirm-approve-${rec.id}`}
          className={cn(BTN, "border-brand bg-brand text-[var(--bg)] hover:bg-brand-strong")}
          onClick={confirm}
        >
          {busy ? "Approving" : "Confirm approve"}
        </button>
      </div>
    </Shell>
  );
}

export function ModifyAction({ rec, sourceName, targetName }: ActionProps) {
  const { canApprove, actor } = useCanApprove();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(defaultQuantity(rec));
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const res = await modifyRecommendation(rec.id, { actor, quantity_override: qty });
    setBusy(false);
    if (res) setOpen(false);
  }

  return (
    <Shell
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" disabled={!canApprove} className={cn(BTN, "border-border-strong text-text hover:bg-surface-3")}>
          <Pencil size={12} aria-hidden /> Modify
        </button>
      }
    >
      <p className="mb-2 text-[13px] font-semibold text-text">Modify quantity, then approve</p>
      <Summary rec={rec} sourceName={sourceName} targetName={targetName} />
      <QuantityField id={`mod-${rec.id}`} value={qty} onChange={setQty} unit={rec.unit} />
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={busy || qty === ""} className={cn(BTN, "border-brand bg-brand text-[var(--bg)]")} onClick={confirm}>
          {busy ? "Saving" : "Approve modified"}
        </button>
      </div>
    </Shell>
  );
}

export function RejectAction({ rec, compact }: { rec: RecommendationV2; compact?: boolean }) {
  const { canApprove, actor } = useCanApprove();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const res = await rejectRecommendation(rec.id, { actor, note: note.trim() });
    setBusy(false);
    if (res) setOpen(false);
  }

  return (
    <Shell
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          disabled={!canApprove}
          data-testid={`reject-${rec.id}`}
          className={cn(BTN, "border-border-strong text-muted hover:border-red hover:text-red", compact && "px-1.5 py-0.5 text-[11px]")}
        >
          <X size={12} aria-hidden /> Reject
        </button>
      }
    >
      <p className="mb-2 text-[13px] font-semibold text-text">Reject: {rec.subject}</p>
      <label className="block text-[11px] text-muted">
        Reason (required)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="mt-1 block w-full resize-none rounded-sm border border-border-strong bg-surface-1 px-2 py-1.5 text-[12px] text-text focus:border-brand focus:outline-none"
        />
      </label>
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={busy || note.trim() === ""} className={cn(BTN, "border-red bg-red text-white")} onClick={confirm}>
          {busy ? "Rejecting" : "Confirm reject"}
        </button>
      </div>
    </Shell>
  );
}
