"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { PackageX, XCircle } from "lucide-react";
import { BaseMapClient } from "@/components/map/client";
import { Card } from "@/components/ds/Card";
import { Dialog, DialogClose, DialogContent } from "@/components/ds/overlays";
import { EmptyState } from "@/components/ds/EmptyState";
import { LiveDot } from "@/components/ds/LiveDot";
import { PageHeader } from "@/components/ds/PageHeader";
import { PriorityChip } from "@/components/ds/PriorityChip";
import { Skeleton } from "@/components/ds/Skeleton";
import { Stepper } from "@/components/ds/Stepper";
import { StatusChip } from "@/components/ds/StatusChip";
import { useClock, useDriver, useShipment, useVehicle } from "@/lib/api/hooks";
import { cancelShipment } from "@/lib/api/mutations";
import { useLivePositions, useLiveSimNow } from "@/lib/live/LiveProvider";
import { createPositionsStore, type PositionsSnapshot } from "@/lib/live/positions-store";
import { fmtPct } from "@/lib/format";
import { roleCapabilities, roleLabels, useRole } from "@/lib/roleContext";
import { useScope, withScope } from "@/lib/scope";
import { ProvenanceFooter, SourceLine } from "../dispatch/SourceLine";
import { CargoCard, DelayBanner, DriverCard, EventLog, OriginCard, PodCard, VehicleCard } from "./TrackingCards";
import { canCancel, delayInfo, etaHeadline, etaSubline, nearestPathIndex, stepperSteps, toPath } from "./helpers";

const TrackLayers = dynamic(() => import("./TrackLayers").then((m) => m.TrackLayers), { ssr: false });

function CancelDialog({ open, onOpenChange, id }: { open: boolean; onOpenChange: (o: boolean) => void; id: string }) {
  const { role } = useRole();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    const res = await cancelShipment(id, reason.trim() || "Cancelled by approver", roleLabels[role]);
    setBusy(false);
    if (res) onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Cancel shipment ${id}`} description="The vehicle and driver are released and the recommendation goes back to the queue.">
        <label className="block text-[12px] text-muted" htmlFor="cancel-reason">
          Reason
        </label>
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why is this shipment being cancelled?"
          className="mt-1 w-full rounded-md border border-border bg-surface-2 p-2 text-[13px] text-text outline-none focus:border-brand"
        />
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose className="h-8 rounded-md border border-border px-3 text-[12px] text-text hover:bg-surface-3">Keep shipment</DialogClose>
          <button
            type="button"
            disabled={busy}
            onClick={confirm}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red px-3 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-60"
          >
            <XCircle size={14} /> {busy ? "Cancelling" : "Cancel shipment"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TrackingView({ shipmentId }: { shipmentId: string }) {
  const { scope } = useScope();
  const { data: s, error, isLoading } = useShipment(shipmentId);
  const { data: driver } = useDriver(s?.driver?.id);
  const { data: vehicle } = useVehicle(s?.vehicle?.id);
  const { data: clock } = useClock();
  const liveSim = useLiveSimNow();
  const simNow = liveSim ?? clock?.sim_now ?? null;
  const { role } = useRole();
  const [cancelOpen, setCancelOpen] = useState(false);

  // A local store holding only this shipment's truck, fed from the app-wide live positions.
  const global = useLivePositions();
  const [local] = useState(() => createPositionsStore());
  useEffect(() => {
    const push = (snap: PositionsSnapshot) => {
      const mine = snap.items.filter((p) => p.shipment_id === shipmentId);
      if (mine.length) local.publish(mine, snap.receivedAt);
    };
    push(global.getSnapshot());
    return global.subscribe(push);
  }, [global, local, shipmentId]);
  const fallback = s?.position ?? null;
  useEffect(() => {
    if (fallback && local.getSnapshot().items.length === 0) local.publish([fallback]);
  }, [fallback, local]);
  const snap = useSyncExternalStore(
    (cb) => local.subscribe(() => cb()),
    local.getSnapshot,
    local.getSnapshot,
  );
  const truck = snap.items[0] ?? null;

  const path = useMemo(() => toPath(s?.path ?? []), [s?.path]);
  const travelled = useMemo(() => {
    if (!s) return 0;
    if (s.status === "delivered" || s.status === "arrived") return Math.max(0, path.length - 1);
    if (s.status === "loading" || s.status === "approved" || s.status === "recommended") return 0;
    return nearestPathIndex(s.path, truck);
  }, [s, path.length, truck]);

  if (isLoading && !s) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-[8fr_4fr]">
          <Skeleton className="h-[460px]" />
          <Skeleton className="h-[460px]" />
        </div>
      </div>
    );
  }
  if (!s) {
    return (
      <Card>
        <EmptyState
          icon={PackageX}
          title={error?.status === 404 ? "Shipment not found" : "Shipment unavailable"}
          body={error?.status === 404 ? "This shipment id does not exist in the current scenario." : "The backend could not be reached."}
          action={
            <Link href={withScope("/supply", scope)} className="text-[13px] text-brand hover:underline">
              Back to dispatch
            </Link>
          }
        />
      </Card>
    );
  }

  const delay = delayInfo(s);
  const steps = stepperSteps(s.status, s.events);
  const stop = s.stops.at(-1);
  const origin = path.length ? { lat: path[0][0], lng: path[0][1], label: s.origin.name } : undefined;
  const destination = stop ? { lat: stop.lat, lng: stop.lng, label: s.destination.name } : undefined;
  const live = s.status === "in_transit" || s.status === "delayed" || s.status === "loading";
  const progressPct = Math.round((s.status === "delivered" || s.status === "arrived" ? 1 : s.progress) * 100);

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[
          { label: "Supply chain" },
          { label: "Dispatch", href: withScope("/supply", scope) },
          { label: s.id },
        ]}
        eyebrow="Shipment tracking"
        title={s.id}
        description={`${s.origin.name} to ${s.destination.name}. ${s.lines_summary}.`}
        actions={
          <>
            <StatusChip status={s.status} live />
            <PriorityChip priority={s.priority} />
            {canCancel(s.status, roleCapabilities[role].canApprove) && (
              <button
                type="button"
                onClick={() => setCancelOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[12px] font-medium text-red hover:bg-surface-3"
              >
                <XCircle size={14} /> Cancel shipment
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[8fr_4fr]">
        <div className="relative overflow-hidden rounded-lg border border-border">
          <BaseMapClient height={460} fitPoints={path.length > 1 ? path : []} scrollWheelZoom className="rounded-none border-0">
            <TrackLayers store={local} path={path} travelledIndex={travelled} status={s.status} origin={origin} destination={destination} />
          </BaseMapClient>
          <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-md border border-border bg-[color-mix(in_srgb,var(--surface-1)_88%,transparent)] px-2.5 py-1.5 text-[11px] text-muted backdrop-blur-sm">
            <span className="mr-3 inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-5 bg-text" /> Travelled
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block w-5 border-t-2 border-dashed border-faint" /> Remaining
            </span>
          </div>
        </div>

        <Card
          eyebrow="Arrival"
          title={s.status === "delayed" ? "Running late" : s.status === "delivered" ? "Complete" : "On the way"}
          live={live}
          className="flex flex-col"
          footer={<SourceLine source="simulation clock, 60x by default" sub="Supply chain / Tracking" />}
        >
          <div className="space-y-4">
            <div>
              <p data-testid="eta-headline" className="text-[26px] font-semibold leading-tight text-text">
                {etaHeadline(s, simNow)}
              </p>
              <p className="num mt-1 text-[12px] text-muted">{etaSubline(s)}</p>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  {live && <LiveDot state="live" />} Route progress
                </span>
                <span className="num" data-testid="progress-pct">
                  {fmtPct(progressPct)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct} aria-label="Route progress">
                <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${progressPct}%` }} />
              </div>
              {truck && (s.status === "in_transit" || s.status === "delayed") && (
                <p className="num mt-1 text-[11px] text-faint">{Math.round(truck.speed_kmh)} km/h</p>
              )}
            </div>
            {delay && <DelayBanner info={delay} />}
            <div className="pt-1">
              <Stepper steps={steps} />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DriverCard shipment={s} driver={driver} />
        <VehicleCard shipment={s} vehicle={vehicle} />
        <CargoCard shipment={s} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[5fr_4fr_3fr]">
        <EventLog events={s.events} />
        <PodCard shipment={s} />
        <OriginCard shipment={s} />
      </div>

      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} id={s.id} />
      <ProvenanceFooter />
    </div>
  );
}
