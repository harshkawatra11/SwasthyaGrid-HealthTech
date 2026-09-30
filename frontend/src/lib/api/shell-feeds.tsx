"use client";

import { createContext, useContext, useMemo } from "react";
import { SWRConfig } from "swr";
import { LiveProvider, useLiveSimNow } from "@/lib/live/LiveProvider";
import { useScope } from "@/lib/scope";
import { SimClockProvider, type SimClock } from "@/lib/sim-clock";
import { useClock, useLogisticsKpis, useRecommendations } from "./hooks";

/** Global SWR defaults for the app. */
export function SwrProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={{ revalidateOnFocus: false, dedupingInterval: 2000 }}>{children}</SWRConfig>;
}

export type NavBadges = Partial<Record<string, number>>;

const NavBadgesContext = createContext<NavBadges>({});

/** Badge counts keyed by nav href, read by the sidebar. */
export function useNavBadges(): NavBadges {
  return useContext(NavBadgesContext);
}

function NavBadgesProvider({ children }: { children: React.ReactNode }) {
  const { scope } = useScope();
  const pending = useRecommendations({ status: "pending", district_id: scope === "all" ? undefined : scope }).data?.recommendations.length;
  const delayed = useLogisticsKpis(scope).data?.delayed_now;
  const value = useMemo<NavBadges>(
    () => ({ "/recommendations": pending || undefined, "/supply": delayed || undefined }),
    [pending, delayed],
  );
  return <NavBadgesContext.Provider value={value}>{children}</NavBadgesContext.Provider>;
}

function ApiSimClockProvider({ children }: { children: React.ReactNode }) {
  const clock = useClock().data;
  const liveNow = useLiveSimNow();
  const value = useMemo<SimClock>(
    () => ({ simNow: liveNow ?? clock?.sim_now ?? null, scale: clock?.scale ?? null, adminEnabled: true }),
    [liveNow, clock],
  );
  return <SimClockProvider value={value}>{children}</SimClockProvider>;
}

/** Everything in the shell that depends on scope: live stream, sim clock and sidebar badges. Mount inside ScopeProvider. */
export function ShellFeeds({ children }: { children: React.ReactNode }) {
  return (
    <LiveProvider>
      <ApiSimClockProvider>
        <NavBadgesProvider>{children}</NavBadgesProvider>
      </ApiSimClockProvider>
    </LiveProvider>
  );
}
