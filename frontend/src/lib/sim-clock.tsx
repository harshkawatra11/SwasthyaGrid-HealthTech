"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

export type SimClock = { simNow: string | null; scale: number | null; adminEnabled: boolean };

const DEFAULT_CLOCK: SimClock = { simNow: null, scale: null, adminEnabled: true };

const SimClockContext = createContext<SimClock>(DEFAULT_CLOCK);

/** C3 feeds this from `GET /logistics/clock` and the SSE `tick` event; until then the chip renders an idle state. */
export function SimClockProvider({ value, children }: { value?: SimClock; children: React.ReactNode }) {
  return <SimClockContext.Provider value={value ?? DEFAULT_CLOCK}>{children}</SimClockContext.Provider>;
}

export function useSimClock(): SimClock {
  return useContext(SimClockContext);
}

/** A locally-ticking display of the sim clock: advances every 250ms between
 *  server updates instead of only jumping when a fresh SSE `tick` or REST poll
 *  arrives, so the chip visibly streams instead of appearing to freeze
 *  between messages. Re-anchors on every new `simNow` the server sends. */
export function useTickingSimNow(): string | null {
  const clock = useSimClock();
  const [display, setDisplay] = useState<string | null>(clock.simNow);
  const anchorRef = useRef<{ simMs: number; wallMs: number; scale: number } | null>(null);

  useEffect(() => {
    if (!clock.simNow) return;
    anchorRef.current = { simMs: Date.parse(clock.simNow), wallMs: Date.now(), scale: clock.scale ?? 1 };
    // The 250ms interval below picks up this anchor on its next tick; a
    // deferred call here (rather than setState during the effect body)
    // keeps the display in step without violating the set-state-in-effect rule.
    const id = setTimeout(() => setDisplay(clock.simNow), 0);
    return () => clearTimeout(id);
  }, [clock.simNow, clock.scale]);

  useEffect(() => {
    const id = setInterval(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const elapsedMs = (Date.now() - anchor.wallMs) * anchor.scale;
      setDisplay(new Date(anchor.simMs + elapsedMs).toISOString());
    }, 250);
    return () => clearInterval(id);
  }, []);

  return display;
}
