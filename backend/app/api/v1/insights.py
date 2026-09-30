"""Insight endpoints (section 6.2)."""

from fastapi import APIRouter, Depends

from app.api.deps import get_insights_service
from app.schemas.insights import Briefing, FacilityMatrix, MedicineMatrix, StateSummary
from app.services.insights_service import InsightsService

router = APIRouter(prefix="/api/v1/insights", tags=["insights"])


@router.get("/state-summary", response_model=StateSummary)
def state_summary(district_id: str | None = None, svc: InsightsService = Depends(get_insights_service)):
    return svc.state_summary(district_id)


@router.get("/facility-matrix", response_model=FacilityMatrix)
def facility_matrix(district_id: str | None = None, svc: InsightsService = Depends(get_insights_service)):
    return svc.facility_matrix(district_id)


@router.get("/medicine-matrix", response_model=MedicineMatrix)
def medicine_matrix(district_id: str | None = None, svc: InsightsService = Depends(get_insights_service)):
    return svc.medicine_matrix(district_id)


@router.get("/briefing", response_model=Briefing)
def briefing(district_id: str | None = None, svc: InsightsService = Depends(get_insights_service)):
    return svc.briefing(district_id)
