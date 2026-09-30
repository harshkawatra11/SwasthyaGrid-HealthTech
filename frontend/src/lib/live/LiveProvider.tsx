"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { mutate } from "swr";
import type { LiveState } from "@/components/ds/LiveDot";
import { apiBase, scopeQuery } from "@/lib/api/base";
import { invalidate } from "@/lib/api/mutations";
import { useScope } from "@/lib/scope";
import { createPositionsStore, type PositionsStore } from "./positions-store";
import { LiveStream, matchesFilter } from "./stream";
import type { LiveEvent, LiveEventFilter } from "./types";

type LiveContextValue = { stream: LiveStream; positions: PositionsStore };

const OFFLINE_STREAM = new LiveStream({
  url: "",
  positions: createPositionsStore(),
  invalidate: () => undefined,
});
const OFFLINE_VALUE: LiveContextValue = { stream: OFFLINE_STREAM, positions: createPositionsStore() };

const LiveContext = createContext<LiveContextValue>(OFFLINE_VALUE);

export function streamUrl(base: string, scope: string): string {
  return `${base}/api/v1/logistics/stream${scopeQuery(scope)}`;
}

/** One EventSource for the app. Re-opens when the scope changes. Must sit inside ScopeProvider. */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const { scope } = useScope();
  const [positions] = useState(() => createPositionsStore());

  const stream = useMemo(
    () =>
      new LiveStream({
        url: streamUrl(apiBase(), scope),
        positions,
        invalidate,
        onKpis: (payload) => {
          void mutate(`/api/v1/logistics/kpis${scopeQuery(scope)}`, { data: payload, offline: false }, { revalidate: false });
        },
      }),
    [scope, positions],
  );

  useEffect(() => {
    stream.start();
    return () => stream.stop();
  }, [stream]);

  return (
    <LiveStoreProvider stream={stream} positions={positions}>
      {children}
    </LiveStoreProvider>
  );
}

/** Supplies an existing stream and positions store to the hooks (also used by tests). */
export function LiveStoreProvider({ stream, positions, children }: LiveContextValue & { children: React.ReactNode }) {
  const value = useMemo(() => ({ stream, positions }), [stream, positions]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** Ref-style store for map layers: subscribe for updates, no React renders. */
export function useLivePositions(): PositionsStore {
  return useContext(LiveContext).positions;
}

export function useLiveState(): LiveState {
  const { stream } = useContext(LiveContext);
  return useSyncExternalStore(stream.subscribeState, stream.getState, () => "offline" as const);
}

/** Simulation time from the latest tick (null before the first tick). */
export function useLiveSimNow(): string | null {
  const { stream } = useContext(LiveContext);
  return useSyncExternalStore(stream.subscribeSimNow, stream.getSimNow, () => null);
}

const NO_EVENTS: readonly LiveEvent[] = [];

/** Last 50 stream events, newest first, optionally filtered. */
export function useLiveEvents(filter: LiveEventFilter = {}): readonly LiveEvent[] {
  const { stream } = useContext(LiveContext);
  const all = useSyncExternalStore(stream.subscribeEvents, stream.getEvents, () => NO_EVENTS);
  const { kind, district_id, facility_id, shipment_id } = filter;
  return useMemo(
    () => all.filter((e) => matchesFilter(e, { kind, district_id, facility_id, shipment_id })),
    [all, kind, district_id, facility_id, shipment_id],
  );
}
