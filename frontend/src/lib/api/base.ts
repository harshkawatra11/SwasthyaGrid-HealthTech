/** Resolve the backend origin. Never `localhost`: it resolves to ::1 first and EventSource/WebSocket do not fall back. */
export function resolveApiBase(env: string | undefined, hostname: string | null): string {
  if (env) return env.replace(/\/$/, "");
  const host = !hostname || hostname === "localhost" ? "127.0.0.1" : hostname;
  return `http://${host}:8080`;
}

export function apiBase(): string {
  return resolveApiBase(
    process.env.NEXT_PUBLIC_API_BASE,
    typeof window === "undefined" ? null : window.location.hostname,
  );
}

export const API_BASE = apiBase();

export const FETCH_TIMEOUT_MS = 6000;

/** status 0 means the request never got an HTTP response (network failure or timeout). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;

  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0;
}

function detailText(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (detail === undefined || detail === null) return fallback;
  try {
    return JSON.stringify(detail);
  } catch {
    return fallback;
  }
}

export type FetchInit = RequestInit & { timeoutMs?: number };

/** JSON fetch against the backend. Throws ApiError: HTTP errors map `{detail, code}`; network and timeout give status 0. */
export async function fetchJson<T>(path: string, init: FetchInit = {}): Promise<T> {
  const { timeoutMs = FETCH_TIMEOUT_MS, headers, ...rest } = init;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const url = /^https?:\/\//.test(path) ? path : `${apiBase()}${path}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...rest,
      headers: {
        Accept: "application/json",
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let body: { detail?: unknown; code?: unknown } = {};
      try {
        body = await res.json();
      } catch {
        /* non-JSON error body */
      }
      const fallback = `Request failed (${res.status})`;
      throw new ApiError(
        res.status,
        typeof body.code === "string" ? body.code : `http_${res.status}`,
        detailText(body.detail, fallback),
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (timedOut) throw new ApiError(0, "timeout", `Request timed out after ${timeoutMs} ms`);
    throw new ApiError(0, "network", e instanceof Error ? e.message : "Network error");
  } finally {
    clearTimeout(timer);
  }
}

export function toQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === "all") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** `all` (or undefined) means no district filter. */
export function scopeQuery(scope: string | undefined, extra: Record<string, string | number | undefined> = {}): string {
  return toQuery({ district_id: scope, ...extra });
}
