"use client";

import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // The initial read cannot move to a lazy useState initializer: matchMedia
    // does not exist during SSR, and this hook has to run in a client
    // component that still renders once on the server. Reading the media
    // query's current value on mount, synchronously in this effect, before
    // the listener attaches, is the correct place for it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
