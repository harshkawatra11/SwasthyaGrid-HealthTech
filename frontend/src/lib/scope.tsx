"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const SCOPE_KEY = "sg-scope";
export const SCOPE_PARAM = "d";

export type Scope = "all" | (string & {});

export const DISTRICT_IDS = [
  "district_jaipur_rural",
  "district_alwar",
  "district_bikaner",
  "district_udaipur",
  "district_kota",
] as const;

export function isValidScope(v: string | null | undefined): v is Scope {
  return v === "all" || (typeof v === "string" && (DISTRICT_IDS as readonly string[]).includes(v));
}

/** Resolve the effective scope: a valid URL param wins, then the stored value, then "all". */
export function resolveScope(param: string | null | undefined, stored: string | null | undefined): Scope {
  if (isValidScope(param)) return param;
  if (isValidScope(stored)) return stored;
  return "all";
}

/** Build the href for `path` with the scope applied (`all` removes the param). */
export function withScope(href: string, scope: Scope): string {
  const [pathAndQuery, hash] = href.split("#");
  const [path, query = ""] = pathAndQuery.split("?");
  const params = new URLSearchParams(query);
  if (scope === "all") params.delete(SCOPE_PARAM);
  else params.set(SCOPE_PARAM, scope);
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}

/* localStorage mirror exposed as an external store so render never reads storage directly. */
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return localStorage.getItem(SCOPE_KEY);
  } catch {
    return null;
  }
}

function writeStored(scope: Scope): void {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

function subscribeStored(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

type ScopeContextValue = { scope: Scope; setScope: (s: Scope) => void };

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stored = useSyncExternalStore(subscribeStored, readStored, () => null);
  const param = searchParams.get(SCOPE_PARAM);
  const scope = resolveScope(param, stored);

  // A fresh visit without `d` restores the stored scope into the URL.
  useEffect(() => {
    if (!isValidScope(param) && scope !== "all") {
      router.replace(withScope(`${pathname}?${searchParams.toString()}`, scope));
    }
  }, [param, scope, pathname, searchParams, router]);

  const setScope = useCallback(
    (next: Scope) => {
      writeStored(next);
      router.replace(withScope(`${pathname}?${searchParams.toString()}`, next));
    },
    [pathname, searchParams, router],
  );

  const value = useMemo(() => ({ scope, setScope }), [scope, setScope]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeContextValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used within ScopeProvider");
  return ctx;
}
