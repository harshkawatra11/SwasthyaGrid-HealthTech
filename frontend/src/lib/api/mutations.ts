"use client";

import { mutate } from "swr";
import { toast } from "@/components/ds/toast-store";
import { ApiError, fetchJson } from "./base";
import type { ApproveBody, ApproveResponse, ClockState, RecommendationV2, ShipmentDetail } from "./types";

const P = "/api/v1";

/** Revalidate every cached SWR key whose path starts with one of `prefixes`. */
export function invalidate(prefixes: readonly string[]): Promise<unknown> {
  return mutate((key) => typeof key === "string" && prefixes.some((p) => key.startsWith(`${P}${p}`)));
}

/** Keys touched by a recommendation decision (it may create a shipment and changes KPIs). */
export const AFTER_DECISION = ["/recommendations", "/insights", "/logistics", "/alerts", "/facilities"] as const;

function message(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "Backend unreachable" : e.detail;
  return e instanceof Error ? e.message : "Unexpected error";
}

async function run<T>(action: () => Promise<T>, ok: string | ((r: T) => string), fail: string): Promise<T | null> {
  try {
    const result = await action();
    toast({ title: typeof ok === "function" ? ok(result) : ok, tone: "success" });
    return result;
  } catch (e) {
    toast({ title: fail, body: message(e), tone: "critical" });
    return null;
  }
}

type RecPayload = { data: { recommendations: RecommendationV2[] }; offline: boolean };

function patchRecommendation(current: RecPayload | undefined, id: string, status: RecommendationV2["status"]): RecPayload {
  if (!current) return { data: { recommendations: [] }, offline: false };
  return {
    ...current,
    data: {
      ...current.data,
      recommendations: current.data.recommendations.map((r) => (r.id === id ? { ...r, status } : r)),
    },
  };
}

const isRecKey = (key: unknown) => typeof key === "string" && key.startsWith(`${P}/recommendations`);

/** Optimistic status flip on every cached recommendations list, rolled back if the call fails. */
async function decide(
  id: string,
  action: "approve" | "reject" | "modify",
  status: RecommendationV2["status"],
  body: ApproveBody,
): Promise<ApproveResponse> {
  const request = fetchJson<ApproveResponse>(`${P}/recommendations/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  request.catch(() => undefined); // awaited below; avoids an unhandled rejection if no key is cached
  await mutate<RecPayload>(isRecKey, () => request as unknown as Promise<RecPayload>, {
    optimisticData: (current) => patchRecommendation(current, id, status),
    rollbackOnError: true,
    populateCache: false,
    revalidate: false,
  });
  await invalidate(AFTER_DECISION);
  return request;
}

export function approveRecommendation(id: string, body: ApproveBody = {}) {
  return run(
    () => decide(id, "approve", "approved", body),
    (r) => (r.shipment ? `Approved. Shipment ${r.shipment.id} created` : "Recommendation approved"),
    "Could not approve",
  );
}

export function rejectRecommendation(id: string, body: Pick<ApproveBody, "note" | "actor"> = {}) {
  return run(() => decide(id, "reject", "rejected", body), "Recommendation rejected", "Could not reject");
}

export function modifyRecommendation(id: string, body: ApproveBody & { quantity_override: string }) {
  return run(() => decide(id, "modify", "modified", body), "Recommendation modified and approved", "Could not modify");
}

export function cancelShipment(id: string, reason: string, actor?: string) {
  return run(
    async () => {
      const r = await fetchJson<ShipmentDetail>(`${P}/logistics/shipments/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason, actor }),
      });
      await invalidate(["/logistics", "/recommendations", "/insights"]);
      return r;
    },
    `Shipment ${id} cancelled`,
    "Could not cancel shipment",
  );
}

export function setTimeScale(scale: number) {
  return run(
    async () => {
      const r = await fetchJson<ClockState>(`${P}/logistics/admin/time-scale`, {
        method: "POST",
        body: JSON.stringify({ scale }),
      });
      await invalidate(["/logistics/clock"]);
      return r;
    },
    (r) => `Simulation speed x${r.scale}`,
    "Could not change speed",
  );
}

export function resetScenario(seed?: number) {
  return run(
    async () => {
      const r = await fetchJson<{ ok: boolean; sim_now: string }>(`${P}/logistics/admin/reset`, {
        method: "POST",
        body: JSON.stringify(seed === undefined ? {} : { seed }),
      });
      await invalidate(["/logistics", "/recommendations", "/insights", "/alerts", "/facilities"]);
      return r;
    },
    "Scenario reset",
    "Could not reset scenario",
  );
}

export function runPlanner() {
  return run(
    async () => {
      const r = await fetchJson<{ assigned: string[]; still_blocked: Array<{ shipment_id: string; reason: string }> }>(
        `${P}/logistics/planner/run`,
        { method: "POST", body: "{}" },
      );
      await invalidate(["/logistics"]);
      return r;
    },
    (r) => `Planner assigned ${r.assigned.length}, blocked ${r.still_blocked.length}`,
    "Planner failed",
  );
}
