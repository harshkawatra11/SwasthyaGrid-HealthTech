import type { ShipmentStatus } from "@/lib/domain";

/** One vehicle position as delivered by the live stream (plan 5.9 VehiclePosition). */
export type LivePosition = {
  shipment_id: string;
  vehicle_id: string;
  lat: number;
  lng: number;
  bearing: number;
  speed_kmh: number;
  progress: number;
  status: ShipmentStatus;
  eta?: string | null;
  temp_c?: number | null;
};

export type PositionsSnapshot = {
  /** performance.now() at the moment the tick arrived; used for interpolation. */
  receivedAt: number;
  items: readonly LivePosition[];
};

/** Read side, consumed by map layers. Updates never touch React state. */
export interface PositionsStore {
  getSnapshot(): PositionsSnapshot;
  subscribe(listener: (snapshot: PositionsSnapshot) => void): () => void;
}

/** Write side, used by the live stream provider (C6) and demos. */
export interface PositionsPublisher extends PositionsStore {
  publish(items: readonly LivePosition[], receivedAt?: number): void;
}

export function createPositionsStore(): PositionsPublisher {
  let snapshot: PositionsSnapshot = { receivedAt: 0, items: [] };
  const listeners = new Set<(s: PositionsSnapshot) => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(items, receivedAt = typeof performance !== "undefined" ? performance.now() : Date.now()) {
      snapshot = { receivedAt, items };
      listeners.forEach((l) => l(snapshot));
    },
  };
}
