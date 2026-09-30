import { ApiError, fetchJson } from "@/lib/api/base";
import { invalidate } from "@/lib/api/mutations";

export class AdminError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Throwing variants for the clock popover (it shows its own toast). */
async function post<T>(path: string, body: unknown): Promise<T> {
  try {
    return await fetchJson<T>(`/api/v1/logistics/admin/${path}`, { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof ApiError) {
      throw new AdminError(e.status, e.status === 403 ? "Admin controls are disabled" : e.detail);
    }
    throw e;
  }
}

export type ClockResponse = { sim_now: string; scale: number };

export const TIME_SCALES = [1, 10, 60, 120] as const;

export async function setTimeScale(scale: number): Promise<ClockResponse> {
  const r = await post<ClockResponse>("time-scale", { scale });
  await invalidate(["/logistics/clock"]);
  return r;
}

export async function resetScenario(seed?: number): Promise<{ ok: boolean; sim_now: string }> {
  const r = await post<{ ok: boolean; sim_now: string }>("reset", seed === undefined ? {} : { seed });
  await invalidate(["/logistics", "/recommendations", "/insights", "/alerts", "/facilities"]);
  return r;
}
