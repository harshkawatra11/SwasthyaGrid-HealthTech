from fastapi import APIRouter, Depends

from app.api.deps import (
    get_district_service,
    get_forecast_service,
    get_insights_service,
    get_logistics_service,
    get_recommendation_service,
)
from app.logistics.service import LogisticsService
from app.schemas.insights import FacilityProfile
from app.schemas.recommendation import (
    ApproveResponse,
    ModifyRequest,
    RecommendationList,
    RecommendationResolveRequest,
    RejectRequest,
)
from app.services.district_service import DistrictService
from app.services.forecast_service import ForecastService
from app.services.insights_service import InsightsService
from app.services.recommendation_service import RecommendationService

router = APIRouter(prefix="/api/v1", tags=["district"])


@router.get("/districts")
def list_districts(svc: DistrictService = Depends(get_district_service)):
    return {"districts": svc.districts_overview()}


@router.get("/district")
def district_summary(
    district_id: str | None = None,
    svc: DistrictService = Depends(get_district_service),
):
    return svc.district_summary(district_id)


@router.get("/facilities")
def list_facilities(
    district_id: str | None = None,
    svc: DistrictService = Depends(get_district_service),
):
    return {"facilities": svc.facilities_overview(district_id)}


@router.get("/facilities/{facility_id}")
def facility_detail(
    facility_id: str, svc: DistrictService = Depends(get_district_service)
):
    return svc.facility_detail(facility_id)


@router.get("/medicines")
def medicine_forecasts(
    district_id: str | None = None,
    fc: ForecastService = Depends(get_forecast_service),
):
    return {"medicines": fc.all_medicine_forecasts(district_id)}


@router.get("/footfall/forecast")
def footfall_forecast(
    district_id: str | None = None,
    fc: ForecastService = Depends(get_forecast_service),
):
    # No district_id: the dashboard's original single-district call. Default
    # to the first district (Jaipur Rural) so that call keeps working exactly
    # as it did before the state expanded to five districts.
    resolved = district_id or fc.repo.districts[0]["id"]
    return fc.footfall_forecast(resolved)


@router.get("/beds/forecast")
def beds_forecast(
    facility_id: str | None = None,
    district_id: str | None = None,
    fc: ForecastService = Depends(get_forecast_service),
):
    if facility_id:
        return fc.bed_forecast(facility_id)
    return {"beds": [fc.bed_forecast(f["id"]) for f in fc.repo.facilities_in(district_id)]}


@router.get("/doctors/attendance")
def doctor_attendance(
    district_id: str | None = None, fc: ForecastService = Depends(get_forecast_service)
):
    return {"doctors": fc.doctor_attendance_risk(district_id)}


@router.get("/diagnostics")
def diagnostics(
    district_id: str | None = None, fc: ForecastService = Depends(get_forecast_service)
):
    facilities = {f["id"]: f for f in fc.repo.facilities}
    rows = []
    for d in fc.repo.diagnostics:
        f = facilities.get(d["facility_id"])
        if district_id and (f is None or f["district_id"] != district_id):
            continue
        rows.append(
            {
                **d,
                "facility_name": f["name"] if f else d["facility_id"],
                "district_id": f["district_id"] if f else None,
            }
        )
    return {"diagnostics": rows}


@router.get("/recommendations", response_model=RecommendationList)
def list_recommendations(
    status: str | None = None,
    district_id: str | None = None,
    type: str | None = None,
    priority: str | None = None,
    rec_svc: RecommendationService = Depends(get_recommendation_service),
    _booted: LogisticsService = Depends(get_logistics_service),
):
    return {
        "recommendations": rec_svc.list(
            status=status, district_id=district_id, type=type, priority=priority
        )
    }


def _resolved(rec: dict, logistics: LogisticsService, with_shipment: bool) -> dict:
    shipment = None
    if with_shipment and rec.get("shipment_id"):
        shipment = logistics.detail(rec["shipment_id"])
    return {**rec, "recommendation": rec, "shipment": shipment}


@router.post("/recommendations/{rec_id}/approve", response_model=ApproveResponse)
def approve_recommendation(
    rec_id: str,
    body: RecommendationResolveRequest | None = None,
    rec_svc: RecommendationService = Depends(get_recommendation_service),
    logistics: LogisticsService = Depends(get_logistics_service),
):
    body = body or RecommendationResolveRequest()
    rec = rec_svc.resolve(
        rec_id,
        "approved",
        quantity_override=body.quantity_override,
        actor=body.actor,
        note=body.note or body.reason,
    )
    return _resolved(rec, logistics, True)


@router.post("/recommendations/{rec_id}/reject", response_model=ApproveResponse)
def reject_recommendation(
    rec_id: str,
    body: RejectRequest | None = None,
    rec_svc: RecommendationService = Depends(get_recommendation_service),
    logistics: LogisticsService = Depends(get_logistics_service),
):
    body = body or RejectRequest()
    rec = rec_svc.resolve(rec_id, "rejected", actor=body.actor, note=body.note)
    return _resolved(rec, logistics, False)


@router.post("/recommendations/{rec_id}/modify", response_model=ApproveResponse)
def modify_recommendation(
    rec_id: str,
    body: ModifyRequest,
    rec_svc: RecommendationService = Depends(get_recommendation_service),
    logistics: LogisticsService = Depends(get_logistics_service),
):
    rec = rec_svc.resolve(
        rec_id,
        "modified",
        quantity_override=body.quantity_override,
        actor=body.actor,
        note=body.note,
    )
    return _resolved(rec, logistics, True)


def _alert_detail(fc: ForecastService, facility_id: str) -> str:
    rows = fc.medicine_forecast(facility_id)
    if rows:
        worst = min(rows, key=lambda r: r["days_remaining"])
        if worst["risk"] in ("high", "medium"):
            name = worst["medicine_name"]
            short = name[name.rindex("(") + 1 : -1] if name.endswith(")") and "(" in name else name
            return f"{short}: {worst['days_remaining']:g} days of cover"
    bed = fc.bed_forecast(facility_id)
    if bed:
        return f"Beds next week: {bed['predicted_next_week_pct']}%"
    return "Elevated risk"


@router.get("/alerts")
def alerts(
    severity: str | None = None,
    district_id: str | None = None,
    fc: ForecastService = Depends(get_forecast_service),
):
    generated = []
    for f in fc.repo.facilities_in(district_id):
        risk = fc.facility_risk_level(f["id"])
        if risk in ("critical", "stress"):
            generated.append(
                {
                    "id": f"alert_{f['id']}",
                    "facility_id": f["id"],
                    "facility_name": f["name"],
                    "district_id": f["district_id"],
                    "severity": "critical" if risk == "critical" else "warning",
                    "title": f"{f['name']} flagged {risk}",
                    "detail": _alert_detail(fc, f["id"]),
                }
            )
    if severity:
        generated = [a for a in generated if a["severity"] == severity]
    return {"alerts": generated}


@router.get("/facilities/{facility_id}/profile", response_model=FacilityProfile)
def facility_profile(
    facility_id: str, svc: InsightsService = Depends(get_insights_service)
):
    return svc.facility_profile(facility_id)


@router.get("/analytics/causal-chain/{facility_id}")
def causal_chain(
    facility_id: str, svc: DistrictService = Depends(get_district_service)
):
    return svc.causal_chain(facility_id)


@router.get("/performance")
def performance(
    district_id: str | None = None,
    svc: DistrictService = Depends(get_district_service),
):
    return {"performance": svc.performance_scores(district_id)}
