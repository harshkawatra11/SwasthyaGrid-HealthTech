"use client";

import { useEffect, useRef, useState } from "react";
import { useClock } from "@/lib/api/hooks";
import { useLiveSimNow } from "@/lib/live/LiveProvider";

/**
 * Simulation time in epoch ms, updated every second. Anchored on the latest live tick (or the
 * clock endpoint) and extrapolated with the clock scale between ticks. Null until known.
 */
export function useSimNowMs(): number | null {
  const liveNow = useLiveSimNow();
  const { data: clock } = useClock();
  const anchorIso = liveNow ?? clock?.sim_now ?? null;
  const scale = clock?.scale ?? 60;
  const anchor = useRef<{ sim: number; wall: number; scale: number } | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (anchorIso) anchor.current = { sim: new Date(anchorIso).getTime(), wall: Date.now(), scale };
    const read = () => {
      const a = anchor.current;
      if (a) setNow(a.sim + (Date.now() - a.wall) * a.scale);
    };
    const first = setTimeout(read, 0);
    const id = setInterval(read, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [anchorIso, scale]);

  return now;
}
