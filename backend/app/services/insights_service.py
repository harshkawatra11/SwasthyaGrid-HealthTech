"""Insight endpoints (section 6.2): state summary, heat matrices, briefing, facility profile.

All numbers come from the same services the rest of the API uses, so the voice tools,
the dashboard and the briefing agree with each other.
"""

from typing import Any

from app.logistics.catalog import medicines
from app.repositories.district_repository import DistrictRepository
from app.services.district_service import DistrictService
from app.services.forecast_service import ForecastService
from app.services.recommendation_service import RecommendationService, _priority

RISK_LEVELS = ("healthy", "monitor", "stress", "critical")
STOCKOUT_DAYS = 3.0
LOW_COVER_DAYS = 7.0

MATRIX_DIMENSIONS = [
    {"id": "inventory", "label": "Min days of cover", "higher_is_worse": False,
     "thresholds": [21, 14, 7, 3], "unit": "days"},
    {"id": "beds", "label": "Beds next week", "higher_is_worse": True,
     "thresholds": [60, 75, 85, 95], "unit": "%"},
    {"id": "staffing", "label": "Doctor absence risk", "higher_is_worse": True,
     "thresholds": [0, 0.25, 0.5, 0.75], "unit": "level"},
    {"id": "diagnostics", "label": "Diagnostics down", "higher_is_worse": True,
     "thresholds": [0, 0.5, 1, 2], "unit": "count"},
    {"id": "performance", "label": "Performance score", "higher_is_worse": False,
     "thresholds": [90, 80, 70, 60], "unit": "score"},
    {"id": "supply", "label": "Inbound ETA", "higher_is_worse": True,
     "thresholds": [1, 3, 6, 12], "unit": "hours"},
]


def risk_index(
    *,
    facilities: int,
    critical: int,
    stress: int,
    stockout_items: int,
    bed_next_week_avg: float | None,
    doctors_high_risk: int,
) -> int:
    """Integer 0 to 100 (6.2). `critical` and `stress` are facility counts in the scope."""
    crit_pct = 100.0 * critical / facilities if facilities else 0.0
    stress_pct = 100.0 * stress / facilities if facilities else 0.0
    raw = (
        0.4 * crit_pct
        + 0.2 * stress_pct
        + 2 * min(stockout_items, 10)
        + 0.33 * max(0.0, (bed_next_week_avg or 0.0) - 70)
        + (10 if doctors_high_risk > 0 else 0)
    )
    return round(min(100, max(0, raw)))


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


class InsightsService:
    def __init__(
        self,
        repo: DistrictRepository,
        forecast: ForecastService,
        districts: DistrictService,
        recs: RecommendationService,
        logistics: Any,
        briefing: Any = None,
    ):
        self.repo = repo
        self.forecast = forecast
        self.districts = districts
        self.recs = recs
        self.logistics = logistics
        self._briefing = briefing

    # ------------------------------------------------------------------ helpers

    def _scope(self, district_id: str | None) -> str:
        if district_id:
            self.repo.district(district_id)  # 404 for an unknown id
        return district_id or "all"

    def _facility_stats(self, facility_id: str) -> dict[str, Any]:
        rows = self.forecast.medicine_forecast(facility_id)
        bed = self.forecast.bed_forecast(facility_id)
        doctors = [d for d in self.repo.doctors if d["facility_id"] == facility_id]
        diags = [d for d in self.repo.diagnostics if d["facility_id"] == facility_id]
        return {
            "risk": self.forecast.facility_risk_level(facility_id),
            "rows": rows,
            "stockout": sum(1 for r in rows if r["days_remaining"] < STOCKOUT_DAYS),
            "low_cover": sum(1 for r in rows if STOCKOUT_DAYS <= r["days_remaining"] < LOW_COVER_DAYS),
            "bed": bed or None,
            "doctors_high": sum(1 for d in doctors if d["risk_level"] == "high"),
            "diag_down": sum(1 for d in diags if d["status"] != "available"),
        }

    def _rollup(self, facilities: list[dict], stats: dict[str, dict], scope: str | None) -> dict:
        counts = dict.fromkeys(RISK_LEVELS, 0)
        beds_now: list[float] = []
        beds_next: list[float] = []
        stockout = low = doctors = diag = 0
        for f in facilities:
            st = stats[f["id"]]
            counts[st["risk"]] += 1
            stockout += st["stockout"]
            low += st["low_cover"]
            doctors += st["doctors_high"]
            diag += st["diag_down"]
            if st["bed"]:
                beds_now.append(st["bed"]["occupancy_pct"])
                beds_next.append(st["bed"]["predicted_next_week_pct"])
        kp = self.logistics.kpis(scope)
        return {
            "facilities": len(facilities),
            "risk_counts": counts,
            "stockout_items": stockout,
            "low_cover_items": low,
            "bed_occupancy_avg": _avg(beds_now),
            "bed_next_week_avg": _avg(beds_next),
            "doctors_high_risk": doctors,
            "diagnostics_down": diag,
            "pending_recommendations": len(self.recs.list(status="pending", district_id=scope)),
            "shipments_in_transit": kp["in_transit_now"] + kp["delayed_now"],
            "on_time_rate_7d": kp["on_time_rate_7d"],
        }

    # ------------------------------------------------------------------ state summary

    def state_summary(self, district_id: str | None = None) -> dict:
        scope = self._scope(district_id)
        facilities = self.repo.facilities_in(district_id)
        stats = {f["id"]: self._facility_stats(f["id"]) for f in facilities}
        totals = self._rollup(facilities, stats, district_id)

        districts = []
        for d in self.repo.districts:
            if district_id and d["id"] != district_id:
                continue
            members = [f for f in facilities if f["district_id"] == d["id"]]
            roll = self._rollup(members, stats, d["id"])
            breakdown = self.repo.footfall_breakdown_tomorrow_for(d["id"]) or {}
            districts.append(
                {
                    "district_id": d["id"],
                    "name": d["name"],
                    "center": d.get("center"),
                    **roll,
                    "risk_index": risk_index(
                        facilities=roll["facilities"],
                        critical=roll["risk_counts"]["critical"],
                        stress=roll["risk_counts"]["stress"],
                        stockout_items=roll["stockout_items"],
                        bed_next_week_avg=roll["bed_next_week_avg"],
                        doctors_high_risk=roll["doctors_high_risk"],
                    ),
                    "critical_facilities": [
                        {"id": f["id"], "name": f["name"]}
                        for f in members
                        if stats[f["id"]]["risk"] == "critical"
                    ],
                    "footfall_tomorrow": int(sum(breakdown.values())),
                }
            )

        cat = medicines()
        risks = []
        for f in facilities:
            for r in stats[f["id"]]["rows"]:
                emergency = bool(cat.get(r["medicine_name"], {}).get("emergency", False))
                risks.append((r["days_remaining"], 0 if emergency else 1, f["id"], r, emergency))
        risks.sort(key=lambda x: (x[0], x[1], x[2], x[3]["medicine_name"]))
        top = [
            {
                "facility_id": f_id,
                "facility_name": r["facility_name"],
                "district_id": r["district_id"],
                "medicine_name": r["medicine_name"],
                "days_remaining": r["days_remaining"],
                "priority": _priority(r["days_remaining"], emergency),
                "inbound_shipment_id": self.logistics.inbound_shipment_for(f_id, r["medicine_name"]),
            }
            for _, _, f_id, r, emergency in risks[:10]
        ]
        return {
            "generated_at": self.logistics.now(),
            "scope": scope,
            "totals": totals,
            "districts": districts,
            "top_risks": top,
        }

    # ------------------------------------------------------------------ matrices

    def facility_matrix(self, district_id: str | None = None) -> dict:
        self._scope(district_id)
        facilities = self.repo.facilities_in(district_id)
        perf = {p["facility_id"]: p["overall"] for p in self.districts.performance_scores(district_id)}
        rows = []
        for f in facilities:
            st = self._facility_stats(f["id"])
            days = [r["days_remaining"] for r in st["rows"]]
            rows.append(
                {
                    "facility_id": f["id"],
                    "facility_name": f["name"],
                    "district_id": f["district_id"],
                    "risk_level": st["risk"],
                    "values": {
                        "inventory": min(days) if days else None,
                        "beds": st["bed"]["predicted_next_week_pct"] if st["bed"] else None,
                        "staffing": 1 if st["doctors_high"] > 0 else 0,
                        "diagnostics": st["diag_down"],
                        "performance": perf.get(f["id"]),
                        "supply": self.logistics.inbound_eta_hours(f["id"]),
                    },
                }
            )
        return {"dimensions": MATRIX_DIMENSIONS, "rows": rows}

    def medicine_matrix(self, district_id: str | None = None) -> dict:
        self._scope(district_id)
        cat = medicines()
        scope_districts = [d for d in self.repo.districts if not district_id or d["id"] == district_id]
        cells: dict[tuple[str, str], dict] = {}
        for f in self.repo.facilities_in(district_id):
            for row in self.repo.medicine_stock_for(f["id"]):
                name = row["medicine_name"]
                use = max(float(row["avg_daily_consumption"] or 0), 0.1)
                days = round(row["units_remaining"] / use, 1)
                cell = cells.setdefault(
                    (name, f["district_id"]),
                    {"medicine_name": name, "district_id": f["district_id"], "min_days_remaining": None,
                     "facilities_below_threshold": 0, "total_units": 0},
                )
                if cell["min_days_remaining"] is None or days < cell["min_days_remaining"]:
                    cell["min_days_remaining"] = days
                if days < float(row.get("reorder_threshold_days") or 5):
                    cell["facilities_below_threshold"] += 1
                cell["total_units"] += int(row["units_remaining"])
        names = sorted({name for name, _ in cells})
        out = []
        for name in names:
            for d in scope_districts:
                out.append(
                    cells.get((name, d["id"]))
                    or {"medicine_name": name, "district_id": d["id"], "min_days_remaining": None,
                        "facilities_below_threshold": 0, "total_units": 0}
                )
        return {
            "medicines": [
                {
                    "name": n,
                    "emergency": bool(cat.get(n, {}).get("emergency", False)),
                    "cold_chain": bool(cat.get(n, {}).get("cold_chain", False)),
                }
                for n in names
            ],
            "districts": [{"id": d["id"], "name": d["name"]} for d in scope_districts],
            "cells": out,
        }

    # ------------------------------------------------------------------ briefing

    def briefing(self, district_id: str | None = None) -> dict:
        summary = self.state_summary(district_id)
        if self._briefing is None:
            from app.services.briefing_service import template_briefing

            return template_briefing(summary, generated_at=self.logistics.now())
        return self._briefing.briefing(summary, self.repo.version)

    # ------------------------------------------------------------------ facility profile

    def facility_profile(self, facility_id: str) -> dict:
        detail = self.districts.facility_detail(facility_id)
        perf = next(
            (p for p in self.districts.performance_scores(detail["district_id"])
             if p["facility_id"] == facility_id),
            None,
        )
        recs = [
            r
            for r in self.recs.list()
            if facility_id in (r["target_facility_id"], r["source_id"])
        ]
        return {
            **detail,
            "district_name": self.repo.district(detail["district_id"])["name"],
            "performance": perf,
            "causal_chain": self.districts.causal_chain(facility_id),
            "recommendations": recs,
            "inbound": self.logistics.facility_inbound(facility_id),
            "history_30d": self.logistics.facility_history_30d(facility_id),
        }

