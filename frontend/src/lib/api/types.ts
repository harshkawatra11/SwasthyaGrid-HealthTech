/**
 * API types, hand-written from the JSON shapes in plan sections 6.1 to 6.4.
 *
 * NOTE: once `npm run gen:api` has produced `lib/api/openapi.ts` (lane A endpoints A8 to A10 must
 * be running), every interface named in plan 9.1 becomes an alias, for example
 * `export type ShipmentSummary = components["schemas"]["ShipmentSummary"];`. Keep the names and
 * field names unchanged so the swap is mechanical. Wire shapes are snake_case, as delivered.
 */

import type { Priority, RiskLevel, ShipmentStatus } from "@/lib/domain";

export type { Priority, RiskLevel, ShipmentStatus };

/* ---------- shared ---------- */

export type LatLng = { lat: number; lng: number };
export type ISODate = string;

export type ShipmentKind = "replenishment" | "lateral_transfer" | "routine" | "restock";
export type NodeKind = "warehouse" | "facility";

/* ---------- pre-existing endpoints (6.1) ---------- */

export interface District {
  id: string;
  name: string;
  state: string;
  center?: LatLng;
  rto_code?: string;
  hq_city?: string;
}

export interface Facility {
  id: string;
  name: string;
  type: "PHC" | "CHC" | string;
  lat: number;
  lng: number;
  beds_total: number;
  district_id: string;
  risk_level: RiskLevel;
}

export interface MedicineForecast {
  facility_id: string;
  medicine_name: string;
  units_remaining: number;
  days_remaining: number;
  risk: "high" | "medium" | "low";
  confidence: number;
  factors: string[];
  facility_name?: string;
  district_id?: string;
  unit?: string;
  cold_chain?: boolean;
  emergency?: boolean;
}

export interface FootfallForecast {
  district_id: string;
  series: Array<Record<string, unknown>>;
  tomorrow_breakdown: Record<string, number>;
  confidence: number;
  factors: string[];
}

export interface BedForecast {
  facility_id: string;
  occupied?: number;
  occupancy_pct?: number;
  predicted_tomorrow_pct?: number;
  predicted_next_week_pct?: number;
  confidence?: number;
  factors?: string[];
}

export interface DoctorAttendance {
  facility_id: string;
  facility_name?: string;
  district_id?: string;
  doctor_name: string;
  specialty: string;
  absence_pattern: string;
  risk_level: "high" | "medium" | "low";
  patient_delay_pct: number;
}

export interface DiagnosticRow {
  facility_id: string;
  facility_name?: string;
  district_id?: string;
  test_name: string;
  status: string;
  nearest_alternative_facility_id?: string | null;
  distance_km?: number | null;
}

export interface Alert {
  id: string;
  facility_id: string;
  district_id: string;
  severity: "critical" | "warning" | string;
  title: string;
  detail?: string;
  facility_name?: string;
}

export interface PerformanceRow {
  facility_id: string;
  facility_name: string;
  district_id: string;
  overall: number;
  inventory: number;
  attendance: number;
  diagnostics: number;
  patient_wait: number;
  forecast_accuracy: number;
}

/** Recommendation record, plan 5.12 (old fields kept). */
export interface RecommendationV2 {
  id: string;
  type: "replenishment" | "stock_transfer" | "bed_redirect" | "staff_transfer" | "diagnostic_redirect";
  district_id: string;
  source_kind: "facility" | "warehouse";
  source_id: string;
  source_facility_id: string;
  target_facility_id: string;
  subject: string;
  medicine_name: string | null;
  quantity: number | null;
  unit: string | null;
  quantity_or_detail: string;
  priority: Priority;
  confidence: number;
  reasons: string[];
  status:
    | "pending"
    | "approved"
    | "modified"
    | "rejected"
    | "expired"
    | "dispatched"
    | "fulfilled"
    | "cancelled";
  created_at: ISODate;
  resolved_at: ISODate | null;
  resolved_by: string | null;
  resolution_note: string | null;
  shipment_id: string | null;
  distance_km: number | null;
  eta_minutes: number | null;
  episode: number;
}

export interface ApproveResponse extends Partial<RecommendationV2> {
  recommendation: RecommendationV2;
  shipment: ShipmentSummary | null;
}

export interface ApproveBody {
  quantity_override?: string;
  note?: string;
  actor?: string;
}

/* ---------- logistics (6.3) ---------- */

export interface VehiclePosition {
  shipment_id: string;
  vehicle_id: string;
  lat: number;
  lng: number;
  bearing: number;
  speed_kmh: number;
  progress: number;
  status: ShipmentStatus;
  eta: ISODate | null;
  temp_c: number | null;
}

export interface ShipmentSummary {
  id: string;
  status: ShipmentStatus;
  priority: Priority;
  kind: ShipmentKind;
  district_id: string;
  origin: { id: string; name: string; kind: NodeKind };
  destination: { id: string; name: string };
  lines_summary: string;
  weight_kg: number;
  pallet_slots: number;
  cold_chain: boolean;
  created_at: ISODate;
  planned_start: ISODate | null;
  planned_arrival: ISODate | null;
  eta: ISODate | null;
  delay_minutes: number;
  progress: number;
  vehicle: { id: string; registration: string; class: string } | null;
  driver: { id: string; name: string } | null;
  source_recommendation_id: string | null;
  blocked_reason: string | null;
}

export interface ShipmentLine {
  medicine_name: string;
  units: number;
  cartons: number;
  weight_kg: number;
  pallet_slots: number;
  cold_chain: boolean;
}

export interface Segment {
  kind: "load" | "drive" | "dwell" | "incident";
  start: ISODate;
  end: ISODate;
  node_id?: string | null;
  route_key?: string | null;
  from_fraction?: number;
  to_fraction?: number;
  note?: string | null;
}

export interface ShipmentEvent {
  shipment_id: string;
  type:
    | "created"
    | "approved"
    | "vehicle_assigned"
    | "loading_started"
    | "departed"
    | "arrived_pickup"
    | "departed_pickup"
    | "incident_started"
    | "incident_cleared"
    | "cold_chain_breach"
    | "cold_chain_recovered"
    | "arrived"
    | "pod_confirmed"
    | "cancelled"
    | (string & {});
  at: ISODate;
  title: string;
  detail: string;
  actor: string | null;
  lat?: number;
  lng?: number;
}

export interface PodRecord {
  pod_id: string;
  confirmed_at: ISODate;
  confirmed_by: string;
  received: Array<{ medicine_name: string; units: number }>;
  condition: "ok" | "damaged" | "short";
  note?: string | null;
}

export interface ShipmentDetail extends ShipmentSummary {
  lines: ShipmentLine[];
  stops: Array<{
    node_id: string;
    node_kind: NodeKind;
    name: string;
    purpose: "pickup" | "dropoff";
    lat: number;
    lng: number;
  }>;
  segments: Segment[];
  path: Array<[number, number]>;
  travelled_index: number;
  position: VehiclePosition | null;
  events: ShipmentEvent[];
  pod: PodRecord | null;
  recommendation: { id: string; subject: string; priority: Priority; confidence: number; reasons: string[] } | null;
  temperature: Array<{ at: ISODate; temp_c: number }>;
}

export interface InboundItem extends ShipmentSummary {
  lines: Array<{
    medicine_name: string;
    units: number;
    unit: string;
    cold_chain: boolean;
    base_daily_consumption: number;
  }>;
}

export type VehicleLiveStatus =
  | "available"
  | "scheduled"
  | "loading"
  | "in_transit"
  | "delayed"
  | "returning"
  | "maintenance";

export interface VehicleSummary {
  id: string;
  registration: string;
  class: string;
  label: string;
  capacity_kg: number;
  pallet_slots: number;
  cold_chain: boolean;
  home_warehouse_id: string;
  district_id: string;
  live_status: VehicleLiveStatus;
  current_shipment_id: string | null;
  position?: VehiclePosition;
  utilisation_7d: number;
  km_since_service: number;
  service_due: boolean;
  fuel_pct: number;
}

export interface GanttTrip {
  shipment_id: string;
  status: ShipmentStatus;
  segments: Array<{ kind: string; start: ISODate; end: ISODate }>;
  label: string;
}

export interface VehicleDetail extends VehicleSummary {
  cargo: {
    slots: Array<{
      index: number;
      state: "loaded" | "reserved" | "empty";
      medicine_name?: string;
      shipment_id?: string;
      cold_chain: boolean;
      weight_kg?: number;
    }>;
    used_kg: number;
    used_slots: number;
  };
  schedule: GanttTrip[];
  trips_7d: number;
  odometer_km: number;
}

export type DriverLiveStatus = "off_shift" | "available" | "assigned" | "driving" | "resting";

export interface DriverSummary {
  id: string;
  name: string;
  home_warehouse_id: string;
  district_id: string;
  shift: string;
  live_status: DriverLiveStatus;
  rating: number;
  deliveries_30d: number;
  on_time_rate_30d: number;
  hours_today: number;
  current_shipment_id: string | null;
  vehicle_id: string | null;
}

export interface DriverDetail extends DriverSummary {
  phone_masked: string;
  license_masked: string;
  license_expiry: string;
  years_experience: number;
  languages: string[];
  schedule: GanttTrip[];
  recent: ShipmentSummary[];
}

export interface WarehouseSummary {
  id: string;
  name: string;
  type: string;
  district_id: string;
  lat: number;
  lng: number;
  capacity_pallets: number;
  docks: number;
  cold_room: boolean;
  outbound_today: number;
  reserved_units: number;
  low_cover_medicines: number;
}

export interface WarehouseDetail extends WarehouseSummary {
  stock: Array<{
    medicine_name: string;
    units: number;
    reserved: number;
    days_of_cover: number;
    batch_no: string;
    expiry_date: string;
    expiring_soon: boolean;
  }>;
  outbound: ShipmentSummary[];
}

export interface LogisticsKpis {
  delivered_today?: number;
  in_transit_now?: number;
  delayed_now?: number;
  on_time_rate_today?: number;
  on_time_rate_7d?: number;
  avg_transit_hours_7d?: number;
  vehicles_in_transit?: number;
  vehicles_available?: number;
  pending_approvals?: number;
  cold_chain_active?: number;
  cold_chain_breaches_today?: number;
  [key: string]: number | undefined;
}

export interface VolumeSeries {
  points: Array<{
    date: string;
    shipments: number;
    delivered: number;
    avg_transit_hours: number;
    on_time_rate: number;
  }>;
}

export interface StatusBreakdown {
  date: string;
  counts: Partial<Record<ShipmentStatus, number>>;
}

export interface ScheduleResponse {
  date: string;
  window: { start: ISODate; end: ISODate };
  rows: Array<{ vehicle: VehicleSummary; trips: GanttTrip[] }>;
}

export interface ClockState {
  sim_now: ISODate;
  scale: number;
  scenario_start: ISODate;
  background_traffic: boolean;
  paused: boolean;
}

export interface PodRequest {
  pod_id: string;
  facility_id: string;
  confirmed_by: string;
  received: Array<{ medicine_name: string; units: number }>;
  condition: "ok" | "damaged" | "short";
  note?: string;
}

export interface PodResponse {
  shipment: ShipmentDetail;
  already_confirmed: boolean;
  stock_applied_by: "crm" | "backend_overlay";
}

/* ---------- insights (6.2) ---------- */

export type RiskCounts = Record<RiskLevel, number>;

export interface StateTotals {
  facilities: number;
  risk_counts: RiskCounts;
  stockout_items: number;
  low_cover_items: number;
  bed_occupancy_avg: number;
  bed_next_week_avg: number;
  doctors_high_risk: number;
  diagnostics_down: number;
  pending_recommendations: number;
  shipments_in_transit: number;
  on_time_rate_7d: number;
}

export interface DistrictSummaryRow extends Omit<StateTotals, "facilities"> {
  district_id: string;
  name: string;
  center: LatLng;
  facilities: number;
  risk_index: number;
  critical_facilities: Array<{ id: string; name: string }>;
  footfall_tomorrow: number;
}

export interface StateSummary {
  generated_at: ISODate;
  scope: string;
  totals: StateTotals;
  districts: DistrictSummaryRow[];
  top_risks: Array<{
    facility_id: string;
    facility_name: string;
    district_id: string;
    medicine_name: string;
    days_remaining: number;
    priority: Priority;
    inbound_shipment_id: string | null;
  }>;
}

export interface FacilityMatrix {
  dimensions: Array<{
    id: string;
    label: string;
    higher_is_worse: boolean;
    thresholds: number[];
    unit: string;
  }>;
  rows: Array<{
    facility_id: string;
    facility_name: string;
    district_id: string;
    risk_level: RiskLevel;
    values: Record<string, number | null>;
  }>;
}

export interface MedicineMatrix {
  medicines: Array<{ name: string; emergency: boolean; cold_chain: boolean }>;
  districts: Array<{ id: string; name: string }>;
  cells: Array<{
    medicine_name: string;
    district_id: string;
    min_days_remaining: number | null;
    facilities_below_threshold: number;
    total_units: number;
  }>;
}

export interface Briefing {
  text: string;
  bullets: string[];
  generated_at: ISODate;
  model: string;
  cached: boolean;
}

export interface FacilityProfile {
  id: string;
  name: string;
  type: string;
  risk_level: RiskLevel;
  district_id: string;
  district_name: string;
  medicine_stock: MedicineForecast[];
  bed_forecast: BedForecast;
  doctors: Array<Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
  performance: PerformanceRow | null;
  causal_chain: Record<string, unknown> | null;
  recommendations: RecommendationV2[];
  inbound: ShipmentSummary[];
  history_30d: {
    deliveries: number;
    units_received_by_medicine: Record<string, number>;
  };
}

/* ---------- request filters ---------- */

export type ScopeArg = "all" | (string & {});

export interface ShipmentFilters {
  district_id?: string;
  status?: string;
  priority?: string;
  kind?: string;
  facility_id?: string;
  q?: string;
  sort?: "eta" | "created_at" | "priority";
  limit?: number;
  offset?: number;
}

export interface RecommendationFilters {
  district_id?: string;
  status?: string;
  type?: string;
  priority?: string;
}

export interface FleetFilters {
  district_id?: string;
  status?: string;
}
