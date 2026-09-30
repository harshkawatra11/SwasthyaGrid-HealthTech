"use client";

import { useCallback, useRef, useState } from "react";

/** Callback-ref width tracker (ResizeObserver). Returns [ref callback, width in px]. */
export function useElementWidth(initial = 800): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(initial);
  const obs = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    obs.current = ro;
  }, []);
  return [ref, width];
}
