import type { LogisticsKpis, ShipmentEvent, VehiclePosition } from "@/lib/api/types";
import type { RiskLevel, ShipmentStatus } from "@/lib/domain";

/** SSE payloads from GET /api/v1/logistics/stream (plan 6.4). Not part of OpenAPI, so hand-written. */

export type TickPayload = { sim_now: string; positions: VehiclePosition[] };

export type ShipmentStreamPayload = {
  event: ShipmentEvent;
  status: ShipmentStatus;
  district_id: string;
  facility_id: string;
};

export type RiskStreamPayload = {
  facility_id: string;
  facility_name: string;
  district_id: string;
  from: RiskLevel;
  to: RiskLevel;
  reason: string;
};

export type RecommendationsStreamPayload = { added: string[]; expired: string[]; changed: string[] };

export type KpisStreamPayload = LogisticsKpis;

export type LiveEvent =
  | { id: number; receivedAt: number; kind: "shipment"; data: ShipmentStreamPayload }
  | { id: number; receivedAt: number; kind: "risk"; data: RiskStreamPayload }
  | { id: number; receivedAt: number; kind: "recommendations"; data: RecommendationsStreamPayload };

export type LiveEventFilter = {
  kind?: LiveEvent["kind"];
  district_id?: string;
  facility_id?: string;
  shipment_id?: string;
};

export const LIVE_EVENT_LIMIT = 50;
