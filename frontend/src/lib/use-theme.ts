"use client";

import { useSyncExternalStore } from "react";
import { readTheme, type Theme } from "@/lib/theme";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

/** The active theme, following the data-theme attribute on <html>. */
export function useTheme(): Theme {
  return useSyncExternalStore<Theme>(subscribe, readTheme, () => "dark");
}
