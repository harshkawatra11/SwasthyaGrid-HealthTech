"""Deterministic mock forecast generators.

Every prediction returns {value, confidence, factors[]} — never a bare
number — per the explainability contract in docs/05-ai-engine.md. Real
XGBoost/LightGBM models are designed to slot in here later (docs/06-forecasting.md)
without changing this service's public interface.
"""

from app.logistics.catalog import medicines
from app.repositories.district_repository import DistrictRepository


def _risk_from_days(days_remaining: float) -> str:
    if days_remaining < 3:
        return "high"
    if days_remaining < 6:
        return "medium"
    return "low"


class ForecastService:
    def __init__(self, repo: DistrictRepository):
        self.repo = repo

    def medicine_forecast(self, facility_id: str) -> list[dict]:
        results = []
        factors = self.repo.demand_factors_for(facility_id)
        facility = self.repo.facility(facility_id)
        catalogue = medicines()
        for stock in self.repo.medicine_stock_for(facility_id):
            # A CRM edit can set consumption to 0; treat it as a very low rate
            # instead of dividing by zero.
            consumption = max(float(stock["avg_daily_consumption"] or 0), 0.1)
            days_remaining = round(stock["units_remaining"] / consumption, 1)
            risk = _risk_from_days(days_remaining)
            confidence = 90 if factors else 80
            meta = catalogue.get(stock["medicine_name"], {})
            results.append(
                {
                    "facility_id": facility_id,
                    "facility_name": facility["name"],
                    "district_id": facility["district_id"],
                    "unit": meta.get("unit", "unit"),
                    "cold_chain": bool(meta.get("cold_chain", False)),
                    "emergency": bool(meta.get("emergency", False)),
                    "medicine_name": stock["medicine_name"],
                    "units_remaining": stock["units_remaining"],
                    "days_remaining": days_remaining,
                    "risk": risk,
                    "confidence": confidence,
                    "factors": factors or ["Historical consumption trend"],
                }
            )
        return results

    def all_medicine_forecasts(self, district_id: str | None = None) -> list[dict]:
        out = []
        for facility in self.repo.facilities_in(district_id):
            out.extend(self.medicine_forecast(facility["id"]))
        return out

    def footfall_forecast(self, district_id: str) -> dict:
        return {
            "district_id": district_id,
            "series": self.repo.footfall_forecast_for(district_id),
            "tomorrow_breakdown": self.repo.footfall_breakdown_tomorrow_for(district_id),
            "confidence": 91,
            "factors": [
                "Seasonality",
                "Historical footfall trend",
                "Nearby disease cluster signals",
                "Weather forecast",
            ],
        }

    def bed_forecast(self, facility_id: str) -> dict:
        for b in self.repo.beds:
            if (b.get("facility_id") or b.get("_doc_id")) == facility_id:
                total = self.repo.facility(facility_id)["beds_total"]
                return {
                    "facility_id": facility_id,
                    "occupied": b["occupied"],
                    "occupancy_pct": round(b["occupied"] / total * 100),
                    "predicted_tomorrow_pct": b["predicted_occupancy_tomorrow_pct"],
                    "predicted_next_week_pct": b["predicted_occupancy_next_week_pct"],
                    "confidence": 89,
                    "factors": ["Footfall forecast correlation", "Seasonal admission trend"],
                }
        return {}

    def doctor_attendance_risk(self, district_id: str | None = None) -> list[dict]:
        names = {f["id"]: f for f in self.repo.facilities}
        return [
            {
                "facility_id": d["facility_id"],
                "facility_name": names.get(d["facility_id"], {}).get("name", d["facility_id"]),
                "district_id": names.get(d["facility_id"], {}).get("district_id"),
                "doctor_name": d["doctor_name"],
                "specialty": d["specialty"],
                "absence_pattern": d["absence_pattern"],
                "risk_level": d["risk_level"],
                "patient_delay_pct": d["patient_delay_pct"],
            }
            for d in self.repo.doctors
            if not district_id or names.get(d["facility_id"], {}).get("district_id") == district_id
        ]

    def facility_risk_level(self, facility_id: str) -> str:
        med = self.medicine_forecast(facility_id)
        if any(m["risk"] == "high" for m in med):
            return "critical"
        bed = self.bed_forecast(facility_id)
        if any(m["risk"] == "medium" for m in med) or (
            bed and bed.get("predicted_next_week_pct", 0) > 90
        ):
            return "stress"
        doctors = [d for d in self.repo.doctors if d["facility_id"] == facility_id]
        if any(d["risk_level"] == "high" for d in doctors):
            return "monitor"
        diagnostics = [d for d in self.repo.diagnostics if d["facility_id"] == facility_id]
        if any(d["status"] != "available" for d in diagnostics):
            return "monitor"
        return "healthy"
