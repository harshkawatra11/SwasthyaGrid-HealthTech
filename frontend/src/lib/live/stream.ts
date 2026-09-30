import { toast as defaultToast, type ToastInput } from "@/components/ds/toast-store";
import type { LiveState } from "@/components/ds/LiveDot";
import { RISK_LABEL, type RiskLevel } from "@/lib/domain";
import type { PositionsPublisher } from "./positions-store";
import {
  LIVE_EVENT_LIMIT,
  type KpisStreamPayload,
  type LiveEvent,
  type RecommendationsStreamPayload,
  type RiskStreamPayload,
  type ShipmentStreamPayload,
  type TickPayload,
} from "./types";

/** Reconnect delays after consecutive failures; the last value repeats. */
export const BACKOFF_MS = [1000, 2000, 5000, 10000] as const;
/** No frame for this long while connected means the stream is stale. */
export const STALE_MS = 5000;

export type EventSourceLike = {
  addEventListener(type: string, listener: (e: MessageEvent) => void): void;
  close(): void;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
};

const RISK_RANK: Record<RiskLevel, number> = { healthy: 0, monitor: 1, stress: 2, critical: 3 };

export function isRiskImprovement(from: RiskLevel, to: RiskLevel): boolean {
  return RISK_RANK[to] < RISK_RANK[from];
}

/** SWR key prefixes (after /api/v1) to revalidate per event, plan 9.1. */
export const INVALIDATE = {
  shipment: ["/logistics/shipments", "/logistics/vehicles", "/logistics/drivers", "/logistics/schedule", "/logistics/kpis", "/logistics/status-breakdown", "/logistics/warehouses"],
  risk: ["/facilities", "/insights", "/alerts", "/recommendations", "/medicines", "/performance", "/logistics/shipments"],
  recommendations: ["/recommendations", "/insights", "/alerts"],
} as const;

export type StreamDeps = {
  url: string;
  positions: PositionsPublisher;
  /** Revalidate SWR keys starting with `/api/v1` + prefix. */
  invalidate: (prefixes: readonly string[]) => unknown;
  onKpis?: (payload: KpisStreamPayload) => void;
  toast?: (t: ToastInput) => unknown;
  createSource?: (url: string) => EventSourceLike;
};

/** EventSource lifecycle, reconnect backoff, and event fan-out. Framework free so it can be tested with a fake EventSource. */
export class LiveStream {
  private source: EventSourceLike | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private nextId = 1;

  private state: LiveState = "offline";
  private events: readonly LiveEvent[] = [];
  private simNow: string | null = null;
  private readonly stateListeners = new Set<() => void>();
  private readonly eventListeners = new Set<() => void>();
  private readonly simListeners = new Set<() => void>();

  constructor(private readonly deps: StreamDeps) {}

  /* ---- external store surfaces (useSyncExternalStore) ---- */
  getState = (): LiveState => this.state;
  getEvents = (): readonly LiveEvent[] => this.events;
  getSimNow = (): string | null => this.simNow;
  subscribeState = (l: () => void) => this.sub(this.stateListeners, l);
  subscribeEvents = (l: () => void) => this.sub(this.eventListeners, l);
  subscribeSimNow = (l: () => void) => this.sub(this.simListeners, l);

  private sub(set: Set<() => void>, l: () => void) {
    set.add(l);
    return () => {
      set.delete(l);
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    this.source?.close();
    this.source = null;
    this.setState("offline");
  }

  private setState(next: LiveState) {
    if (this.state === next) return;
    this.state = next;
    this.stateListeners.forEach((l) => l());
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.reconnectTimer = null;
    this.staleTimer = null;
  }

  private armStale() {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => this.setState("stale"), STALE_MS);
  }

  private connect() {
    if (!this.running) return;
    this.reconnectTimer = null;
    const create = this.deps.createSource ?? ((u: string) => new EventSource(u) as unknown as EventSourceLike);
    let source: EventSourceLike;
    try {
      source = create(this.deps.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.source = source;
    source.onopen = () => {
      if (this.source !== source) return;
      this.attempt = 0;
      this.setState("live");
      this.armStale();
    };
    source.onerror = () => {
      if (this.source !== source) return;
      source.close();
      this.source = null;
      this.setState("offline");
      this.scheduleReconnect();
    };
    const on = (type: string, handler: (data: unknown) => void) =>
      source.addEventListener(type, (e) => {
        if (this.source !== source) return;
        let data: unknown;
        try {
          data = JSON.parse(e.data as string);
        } catch {
          return;
        }
        this.setState("live");
        this.armStale();
        handler(data);
      });
    on("tick", (d) => this.onTick(d as TickPayload));
    on("shipment", (d) => this.onShipment(d as ShipmentStreamPayload));
    on("risk", (d) => this.onRisk(d as RiskStreamPayload));
    on("recommendations", (d) => this.onRecommendations(d as RecommendationsStreamPayload));
    on("kpis", (d) => this.deps.onKpis?.(d as KpisStreamPayload));
  }

  private scheduleReconnect() {
    if (!this.running) return;
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = null;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private push(event: Omit<LiveEvent, "id" | "receivedAt"> & { kind: LiveEvent["kind"] }) {
    const full = { ...event, id: this.nextId++, receivedAt: Date.now() } as LiveEvent;
    this.events = [full, ...this.events].slice(0, LIVE_EVENT_LIMIT);
    this.eventListeners.forEach((l) => l());
  }

  private onTick(p: TickPayload) {
    this.deps.positions.publish(p.positions ?? []);
    if (p.sim_now !== this.simNow) {
      this.simNow = p.sim_now;
      this.simListeners.forEach((l) => l());
    }
  }

  private onShipment(p: ShipmentStreamPayload) {
    this.push({ kind: "shipment", data: p });
    this.deps.invalidate([...INVALIDATE.shipment, ...(p.facility_id ? [`/facilities/${p.facility_id}/profile`] : [])]);
    const notify = this.deps.toast ?? defaultToast;
    if (p.event.type === "cold_chain_breach") {
      notify({ title: "Cold chain breach", body: p.event.title || p.event.detail, tone: "critical", href: `/supply/shipments/${p.event.shipment_id}` });
    }
  }

  private onRisk(p: RiskStreamPayload) {
    this.push({ kind: "risk", data: p });
    this.deps.invalidate(INVALIDATE.risk);
    if (isRiskImprovement(p.from, p.to)) {
      const notify = this.deps.toast ?? defaultToast;
      const head = `${p.facility_name} improved from ${RISK_LABEL[p.from]} to ${RISK_LABEL[p.to]}`;
      notify({ title: p.reason ? `${head}: ${p.reason}` : head, tone: "success", href: `/facilities/${p.facility_id}` });
    }
  }

  private onRecommendations(p: RecommendationsStreamPayload) {
    this.push({ kind: "recommendations", data: p });
    this.deps.invalidate(INVALIDATE.recommendations);
  }
}

export function matchesFilter(e: LiveEvent, f: { kind?: string; district_id?: string; facility_id?: string; shipment_id?: string }): boolean {
  if (f.kind && e.kind !== f.kind) return false;
  if (e.kind === "recommendations") return !f.district_id && !f.facility_id && !f.shipment_id;
  if (f.district_id && e.data.district_id !== f.district_id) return false;
  if (f.facility_id && e.data.facility_id !== f.facility_id) return false;
  if (f.shipment_id && !(e.kind === "shipment" && e.data.event.shipment_id === f.shipment_id)) return false;
  return true;
}
