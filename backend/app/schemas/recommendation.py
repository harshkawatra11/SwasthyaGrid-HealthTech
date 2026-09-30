from typing import Literal

from pydantic import BaseModel

from app.logistics.views import ShipmentDetail


class RecommendationResolveRequest(BaseModel):
    quantity_override: str | None = None
    reason: str | None = None  # kept for the pre-v2 frontend
    note: str | None = None
    actor: str | None = None


class RejectRequest(BaseModel):
    note: str | None = None
    actor: str | None = None


class ModifyRequest(BaseModel):
    quantity_override: str
    note: str | None = None
    actor: str | None = None


class AskRequest(BaseModel):
    message: str


class AskResponse(BaseModel):
    answer: str
    tool_calls: list[str] = []
    confidence: int | None = None


class RecommendationV2(BaseModel):
    id: str
    type: Literal["replenishment", "stock_transfer", "bed_redirect", "staff_transfer"]
    district_id: str
    source_kind: Literal["facility", "warehouse"]
    source_id: str
    source_facility_id: str
    target_facility_id: str
    subject: str
    medicine_name: str | None = None
    quantity: int | None = None
    unit: str | None = None
    quantity_or_detail: str | None = None
    priority: str
    confidence: int
    reasons: list[str]
    status: str
    created_at: str
    resolved_at: str | None = None
    resolved_by: str | None = None
    resolution_note: str | None = None
    shipment_id: str | None = None
    distance_km: float | None = None
    eta_minutes: int | None = None
    episode: int = 1


class RecommendationList(BaseModel):
    recommendations: list[RecommendationV2]


class ApproveResponse(RecommendationV2):
    """The recommendation's own fields at the top level (old shape) plus two keys."""

    recommendation: RecommendationV2
    shipment: ShipmentDetail | None = None
