from app.repositories.district_repository import DistrictRepository
from app.services.forecast_service import ForecastService


class DistrictService:
    def __init__(self, repo: DistrictRepository, forecast: ForecastService):
        self.repo = repo
        self.forecast = forecast

    def districts_overview(self) -> list[dict]:
        return self.repo.districts

    def facilities_overview(self, district_id: str | None = None) -> list[dict]:
        out = []
        for f in self.repo.facilities_in(district_id):
            out.append(
                {
                    **f,
                    "risk_level": self.forecast.facility_risk_level(f["id"]),
                }
            )
        return out

    def facility_detail(self, facility_id: str) -> dict:
        facility = self.repo.facility(facility_id)
        return {
            **facility,
            "risk_level": self.forecast.facility_risk_level(facility_id),
            "medicine_stock": self.forecast.medicine_forecast(facility_id),
            "bed_forecast": self.forecast.bed_forecast(facility_id),
            "doctors": [
                d for d in self.repo.doctors if d["facility_id"] == facility_id
            ],
            "diagnostics": [
                d for d in self.repo.diagnostics if d["facility_id"] == facility_id
            ],
        }

    def district_summary(self, district_id: str | None = None) -> dict:
        """With no district_id: a state-level rollup across all five districts.

        With one: the single-district shape the dashboard and the original
        eight-facility Jaipur Rural demo already expect.
        """
        facilities = self.facilities_overview(district_id)
        risk_counts = {"healthy": 0, "monitor": 0, "stress": 0, "critical": 0}
        for f in facilities:
            risk_counts[f["risk_level"]] += 1

        if district_id is not None:
            return {
                "district": self.repo.district(district_id),
                "facilities": facilities,
                "risk_counts": risk_counts,
            }

        return {
            "districts": self.repo.districts,
            "facilities": facilities,
            "risk_counts": risk_counts,
            "district_count": len(self.repo.districts),
            "facility_count": len(facilities),
        }

    def performance_scores(self, district_id: str | None = None) -> list[dict]:
        """Illustrative composite scorecard per facility.

        Overall = average of sub-scores, sub-scores derived from current mock
        signals (inventory health, doctor attendance, diagnostics availability).
        """
        out = []
        for f in self.repo.facilities_in(district_id):
            med = self.forecast.medicine_forecast(f["id"])
            inventory_score = 100 - sum(30 for m in med if m["risk"] == "high") - sum(
                15 for m in med if m["risk"] == "medium"
            )
            inventory_score = max(inventory_score, 20)

            doctors = [d for d in self.repo.doctors if d["facility_id"] == f["id"]]
            attendance_score = 60 if any(d["risk_level"] == "high" for d in doctors) else 90

            diagnostics = [d for d in self.repo.diagnostics if d["facility_id"] == f["id"]]
            diagnostics_score = 65 if any(
                d["status"] != "available" for d in diagnostics
            ) else 92

            bed = self.forecast.bed_forecast(f["id"])
            patient_wait_score = 100 - (bed.get("predicted_next_week_pct", 50) - 50)
            patient_wait_score = max(min(patient_wait_score, 95), 40)

            forecast_accuracy = 90

            overall = round(
                (
                    inventory_score
                    + attendance_score
                    + diagnostics_score
                    + patient_wait_score
                    + forecast_accuracy
                )
                / 5
            )

            out.append(
                {
                    "facility_id": f["id"],
                    "facility_name": f["name"],
                    "district_id": f["district_id"],
                    "overall": overall,
                    "inventory": inventory_score,
                    "attendance": attendance_score,
                    "diagnostics": diagnostics_score,
                    "patient_wait": round(patient_wait_score),
                    "forecast_accuracy": forecast_accuracy,
                }
            )
        return sorted(out, key=lambda s: s["overall"])

    def causal_chain(self, facility_id: str) -> dict:
        district_id = self.repo.district_id_for_facility(facility_id)
        chain = self.repo.causal_chain_for(district_id)
        if chain and chain.get("facility_id") == facility_id:
            return chain
        return {
            "facility_id": facility_id,
            "headline": "No significant causal signal detected",
            "chain": [],
        }
