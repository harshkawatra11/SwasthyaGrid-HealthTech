import { useSyncExternalStore } from "react";

/* Offline when at least one reporting key last failed with a network error. */
const offlineKeys = new Set<string>();
let offline = false;
const listeners = new Set<() => void>();

function recompute() {
  const next = offlineKeys.size > 0;
  if (next === offline) return;
  offline = next;
  listeners.forEach((l) => l());
}

/** Called by the data layer after every fetch: `true` for a network failure, `false` for a success. */
export function reportApiStatus(key: string, isOffline: boolean): void {
  if (isOffline) offlineKeys.add(key);
  else offlineKeys.delete(key);
  recompute();
}

/** Direct override (kept from C2). Clears all keys when set to false. */
export function setApiOffline(value: boolean): void {
  if (value) offlineKeys.add("__manual__");
  else offlineKeys.clear();
  recompute();
}

export function useApiHealth(): { offline: boolean } {
  const o = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => offline,
    () => false,
  );
  return { offline: o };
}
