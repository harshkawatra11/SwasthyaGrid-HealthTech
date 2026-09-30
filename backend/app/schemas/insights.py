"""Insight endpoint models (section 6.2)."""

from typing import Any

from pydantic import BaseModel

from app.logistics.models import UtcDatetime
from app.logistics.views import ShipmentSummary
from app.schemas.recommendation import RecommendationV2


class LatLng(BaseModel):
    lat: float
    lng: float


class RiskCounts(BaseModel):
    healthy: int = 0
    monitor: int = 0
    stress: int = 0
    critical: int = 0


class FacilityRef(BaseModel):
    id: str
    name: str


class SummaryTotals(BaseModel):
    facilities: int
    risk_counts: RiskCounts
    stockout_items: int
    low_cover_items: int
    bed_occupancy_avg: float | None = None
    bed_next_week_avg: float | None = None
    doctors_high_risk: int
    diagnostics_down: int
    pending_recommendations: int
    shipments_in_transit: int
    on_time_rate_7d: float | None = None


class DistrictSummary(BaseModel):
    district_id: str
    name: str
    center: LatLng | None = None
    facilities: int
    risk_counts: RiskCounts
    risk_index: int
    critical_facilities: list[FacilityRef]
    stockout_items: int
    low_cover_items: int
    bed_occupancy_avg: float | None = None
    bed_next_week_avg: float | None = None
    doctors_high_risk: int
    diagnostics_down: int
    pending_recommendations: int
    shipments_in_transit: int
    on_time_rate_7d: float | None = None
    footfall_tomorrow: int


class TopRisk(BaseModel):
    facility_id: str
    facility_name: str
    district_id: str
    medicine_name: str
    days_remaining: float
    priority: str
    inbound_shipment_id: str | None = None


class StateSummary(BaseModel):
    generated_at: UtcDatetime
    scope: str
    totals: SummaryTotals
    districts: list[DistrictSummary]
    top_risks: list[TopRisk]


class MatrixDimension(BaseModel):
    id: str
    label: str
    higher_is_worse: bool
    thresholds: list[float]
    unit: str


class MatrixRow(BaseModel):
    facility_id: str
    facility_name: str
    district_id: str
    risk_level: str
    values: dict[str, float | None]


class FacilityMatrix(BaseModel):
    dimensions: list[MatrixDimension]
    rows: list[MatrixRow]


class MatrixMedicine(BaseModel):
    name: str
    emergency: bool
    cold_chain: bool


class MatrixDistrict(BaseModel):
    id: str
    name: str


class MedicineCell(BaseModel):
    medicine_name: str
    district_id: str
    min_days_remaining: float | None = None
    facilities_below_threshold: int
    total_units: int


class MedicineMatrix(BaseModel):
    medicines: list[MatrixMedicine]
    districts: list[MatrixDistrict]
    cells: list[MedicineCell]


class Briefing(BaseModel):
    text: str
    bullets: list[str]
    generated_at: UtcDatetime
    model: str
    cached: bool


class History30d(BaseModel):
    deliveries: int
    units_received_by_medicine: dict[str, int]


class FacilityProfile(BaseModel):
    id: str
    name: str
    type: str
    lat: float
    lng: float
    beds_total: int
    district_id: str
    district_name: str
    risk_level: str
    medicine_stock: list[dict[str, Any]]
    bed_forecast: dict[str, Any]
    doctors: list[dict[str, Any]]
    diagnostics: list[dict[str, Any]]
    performance: dict[str, Any] | None = None
    causal_chain: dict[str, Any]
    recommendations: list[RecommendationV2]
    inbound: list[ShipmentSummary]
    history_30d: History30d
