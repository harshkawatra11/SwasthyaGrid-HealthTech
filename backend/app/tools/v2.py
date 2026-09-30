"""Tool set v2: 13 tools shared by the Gemini typed agent and the Sarvam voice agent.

Every tool accepts spoken names as well as ids (resolvers in `resolve.py`) and
returns a `ToolResult`. Only `ToolResult.llm` is shown to the model: compact,
names instead of ids, numbers rounded to one decimal, lists capped at 8 with a
`"more"` count. `ToolResult.card` is an optional fact card for the UI.

Logistics data comes through the `LogisticsQuery` and `InsightsQuery`
protocols (`app.logistics.protocol`), so this module never imports lane A code.
"""

import inspect
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from rapidfuzz import fuzz, process

from app.logistics.protocol import InsightsQuery, LogisticsQuery
from app.services.district_service import DistrictService
from app.services.forecast_service import ForecastService
from app.services.recommendation_service import RecommendationService
from app.tools.resolve import normalize, resolve_district, resolve_facility

LIST_CAP = 8
ACTIVE_STATUSES = ["approved", "loading", "in_transit", "delayed"]
EMERGENCY_MEDICINES = frozenset(
    {
        "Anti-Snake Venom (ASV)",
        "Anti-Rabies Vaccine (ARV)",
        "Oxytocin",
        "Adrenaline (Epinephrine)",
        "Tetanus Toxoid (TT)",
    }
)
_MEDICINE_ALIASES = {"arv": "Anti-Rabies Vaccine (ARV)", "asv": "Anti-Snake Venom (ASV)",
                     "tt": "Tetanus Toxoid (TT)", "ors": "ORS", "epinephrine": "Adrenaline (Epinephrine)"}  # fmt: skip
_PRIORITY_ORDER = {"critical": 0, "high": 1, "normal": 2}
_ALL_WORDS = {"", "all", "state", "rajasthan", "everything", "none", "null", "all districts"}
_SHIPMENT_ID_RE = re.compile(r"^\s*SHP-?\s*\d+\s*$", re.IGNORECASE)

COMPARE_METRICS = {
    "risk_index": "index",
    "critical_facilities": "facilities",
    "stockouts": "items",
    "bed_pressure": "percent",
    "on_time_rate": "percent",
    "pending_recommendations": "recommendations",
}

TOOL_LABELS = {
    "get_state_briefing": "Reviewing all five districts",
    "get_district_briefing": "Checking {district} district data",
    "find_facility": "Looking up the facility",
    "get_facility_status": "Checking {facility}",
    "get_shortages": "Scanning stock levels",
    "compare_districts": "Comparing districts",
    "get_recommendations": "Checking recommendations",
    "get_shipments": "Checking shipments",
    "get_shipment": "Tracking the shipment",
    "get_fleet_status": "Checking the fleet",
    "get_footfall_forecast": "Checking the footfall forecast",
    "get_causal_chain": "Looking at the causes",
    "get_performance": "Checking performance scores",
}


@dataclass
class ToolResult:
    llm: dict[str, Any]
    card: dict[str, Any] | None = None


def tool_label(name: str, args: dict[str, Any] | None = None) -> str:
    """Status line for the UI while a tool runs, e.g. "Checking Kota district data"."""
    args = args or {}
    template = TOOL_LABELS.get(name, "Checking the data")
    if "{district}" in template:
        did = resolve_district(str(args.get("district") or ""))
        if did is None:
            return "Checking district data"
        return template.format(district=_short_district(_district_name(did)))
    if "{facility}" in template:
        res = resolve_facility(str(args.get("facility") or ""))
        return template.format(facility=res.best.name) if res.best else "Checking the facility"
    return template


def _short_district(name: str) -> str:
    return name.removesuffix(" District")


def _district_name(did: str) -> str:
    from app.repositories.district_repository import get_district_repository

    try:
        return get_district_repository().district(did)["name"]
    except Exception:
        return did


def _r(value: Any) -> Any:
    return round(value, 1) if isinstance(value, float) else value


def _cap(items: list[Any], n: int = LIST_CAP) -> dict[str, Any]:
    out: dict[str, Any] = {"items": items[:n]}
    if len(items) > n:
        out["more"] = len(items) - n
    return out


def _capped(key: str, items: list[Any], n: int = LIST_CAP) -> dict[str, Any]:
    c = _cap(items, n)
    out: dict[str, Any] = {key: c["items"]}
    if "more" in c:
        out["more"] = c["more"]
    return out


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _minutes_until(value: Any, now: datetime | None) -> int | None:
    eta = _parse_dt(value)
    if eta is None or now is None:
        return None
    if (eta.tzinfo is None) != (now.tzinfo is None):
        eta = eta.replace(tzinfo=now.tzinfo)
    return max(0, round((eta - now).total_seconds() / 60))


def _counts(value: Any, key: str = "live_status") -> dict[str, int]:
    """Accept either a {status: n} mapping or a list of dicts carrying `key`."""
    if isinstance(value, dict):
        return {str(k): int(v) for k, v in value.items() if isinstance(v, (int, float))}
    counts: dict[str, int] = {}
    for item in value or []:
        if isinstance(item, dict):
            k = str(item.get(key) or item.get("status") or "unknown")
            counts[k] = counts.get(k, 0) + 1
    return counts


class ToolContext:
    """Services plus lookup helpers shared by all tool closures."""

    def __init__(
        self,
        district: DistrictService,
        forecast: ForecastService,
        recommendation: RecommendationService,
        logistics: LogisticsQuery | None = None,
        insights: InsightsQuery | None = None,
    ):
        self.district = district
        self.forecast = forecast
        self.recommendation = recommendation
        self._logistics = logistics
        self._insights = insights

    @property
    def repo(self):
        return self.district.repo

    @property
    def logistics(self) -> LogisticsQuery | None:
        if self._logistics is not None:
            return self._logistics
        from app.api import deps

        try:
            return deps.get_logistics_service()
        except NotImplementedError:
            return None

    @property
    def insights(self) -> InsightsQuery | None:
        if self._insights is not None:
            return self._insights
        from app.api import deps

        try:
            return deps.get_insights_service()
        except NotImplementedError:
            return None

    def now(self) -> datetime | None:
        lg = self.logistics
        return lg.now() if lg is not None else None

    def dname(self, did: str | None) -> str:
        if not did:
            return "all five districts"
        try:
            return _short_district(self.repo.district(did)["name"])
        except Exception:
            return did

    def fname(self, fid: str | None) -> str:
        if not fid:
            return "unknown facility"
        try:
            return self.repo.facility(fid)["name"]
        except Exception:
            return fid

    def fdistrict(self, fid: str | None) -> str | None:
        try:
            return self.repo.facility(fid)["district_id"] if fid else None
        except Exception:
            return None

    def district_arg(self, text: Any) -> tuple[str | None, dict[str, Any] | None]:
        """(district_id, error). Empty or "all" means no restriction."""
        if text is None or str(text).strip().lower() in _ALL_WORDS:
            return None, None
        did = resolve_district(str(text), self.repo.districts)
        if did is None:
            names = [_short_district(d["name"]) for d in self.repo.districts]
            return None, {"error": f"Unknown district '{text}'. Districts are: {', '.join(names)}."}
        return did, None

    def facility_arg(
        self, text: Any, district: str | None = None
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        res = resolve_facility(
            str(text or ""), district, facilities=self.repo.facilities, districts=self.repo.districts
        )
        if not res.matches:
            return None, {"error": f"No facility matches '{text}'."}
        if res.ambiguous:
            return None, {
                "error": f"'{text}' matches more than one facility. Ask which one is meant.",
                "candidates": [
                    {"name": m.name, "district": self.dname(m.district_id)} for m in res.matches
                ],
            }
        return self.repo.facility(res.matches[0].id), None

    def stock_rows(self, did: str | None) -> list[dict[str, Any]]:
        return self.forecast.all_medicine_forecasts(did)

    def pending_recs(self, did: str | None = None) -> list[dict[str, Any]]:
        recs = self.recommendation.list(status="pending")
        if did is None:
            return recs
        return [r for r in recs if self.rec_district(r) == did]

    def rec_district(self, rec: dict[str, Any]) -> str | None:
        return rec.get("district_id") or self.fdistrict(rec.get("target_facility_id"))


def _resolve_medicine(text: str, names: list[str]) -> str | None:
    key = normalize(text)
    if key in _MEDICINE_ALIASES:
        return _MEDICINE_ALIASES[key]
    low = {normalize(n): n for n in names}
    if key in low:
        return low[key]
    for k, n in low.items():
        if key and key in k:
            return n
    hit = process.extractOne(key, list(low), scorer=fuzz.WRatio, score_cutoff=75)
    return low[hit[0]] if hit else None


def _shipment_row(ctx: ToolContext, s: dict[str, Any], now: datetime | None) -> dict[str, Any]:
    driver = s.get("driver") or {}
    return {
        "id": s.get("id"),
        "status": s.get("status"),
        "from": (s.get("origin") or {}).get("name"),
        "to": (s.get("destination") or {}).get("name"),
        "cargo": s.get("lines_summary"),
        "eta_in_minutes": _minutes_until(s.get("eta"), now),
        "delay_minutes": s.get("delay_minutes") or 0,
        "driver": driver.get("name"),
    }


# ---------------------------------------------------------------------------
# Fact card builders: pure functions of tool data.
# ---------------------------------------------------------------------------


def card_district_summary(did: str, name: str, risk_counts: dict, risk_index: Any, critical: list[dict]) -> dict:
    return {
        "type": "district_summary",
        "district_id": did,
        "name": name,
        "risk_counts": risk_counts,
        "risk_index": risk_index,
        "critical": critical,
    }


def card_facility(fid: str, name: str, district_name: str, risk: str, medicines: list[dict], beds_next_week: Any) -> dict:
    return {
        "type": "facility",
        "facility_id": fid,
        "name": name,
        "district_name": district_name,
        "risk": risk,
        "medicines": [{"name": m["name"], "days": m["days"], "risk": m["risk"]} for m in medicines],
        "beds_next_week": beds_next_week,
    }


def card_shortages(rows: list[dict]) -> dict:
    return {
        "type": "shortages",
        "rows": [
            {
                "facility_id": r["facility_id"],
                "facility": r["facility"],
                "district": r["district"],
                "medicine": r["medicine"],
                "days": r["days"],
            }
            for r in rows
        ],
    }


def card_ranking(metric: str, unit: str, rows: list[dict]) -> dict:
    return {"type": "ranking", "metric": metric, "unit": unit, "rows": rows}


def card_shipments(rows: list[dict]) -> dict:
    return {
        "type": "shipments",
        "rows": [
            {"id": r["id"], "status": r["status"], "destination": r["to"], "eta": r["eta"]}
            for r in rows
        ],
    }


def card_shipment(
    sid: str, status: str, eta: Any, progress: Any, driver: str | None, vehicle: str | None, temp_c: Any
) -> dict:
    return {
        "type": "shipment",
        "id": sid,
        "status": status,
        "eta": eta,
        "progress": progress,
        "driver": driver,
        "vehicle": vehicle,
        "temp_c": temp_c,
    }


def card_fleet(counts: dict, queued: list) -> dict:
    return {"type": "fleet", "counts": counts, "queued": queued}


# ---------------------------------------------------------------------------
# Tool table.
# ---------------------------------------------------------------------------


def build_tool_functions(
    district: DistrictService,
    forecast: ForecastService,
    recommendation: RecommendationService,
    logistics: LogisticsQuery | None = None,
    insights: InsightsQuery | None = None,
) -> dict[str, Callable[..., ToolResult]]:
    """Returns {tool_name: callable returning ToolResult}, the dispatch table for both agents."""
    ctx = ToolContext(district, forecast, recommendation, logistics, insights)

    def _facility_worst_issue(fid: str) -> str:
        meds = sorted(forecast.medicine_forecast(fid), key=lambda m: m["days_remaining"])
        if meds and meds[0]["risk"] != "low":
            m = meds[0]
            return f"{m['medicine_name']} stock lasts {_r(m['days_remaining'])} days"
        bed = forecast.bed_forecast(fid)
        if bed and bed.get("predicted_next_week_pct", 0) > 85:
            return f"beds forecast {bed['predicted_next_week_pct']} percent full next week"
        for d in ctx.repo.doctors:
            if d["facility_id"] == fid and d["risk_level"] == "high":
                return f"{d['doctor_name']} at high absence risk"
        for d in ctx.repo.diagnostics:
            if d["facility_id"] == fid and d["status"] != "available":
                return f"{d['test_name']} is {d['status'].replace('_', ' ')}"
        return "no open issue"

    def _shortage_rows(did: str | None, max_days: float, medicine: str | None = None) -> list[dict]:
        rows = []
        for r in ctx.stock_rows(did):
            if r["days_remaining"] >= max_days:
                continue
            if medicine and r["medicine_name"] != medicine:
                continue
            fid = r["facility_id"]
            rows.append(
                {
                    "facility_id": fid,
                    "facility": ctx.fname(fid),
                    "district": ctx.dname(ctx.fdistrict(fid)),
                    "medicine": r["medicine_name"],
                    "days": _r(r["days_remaining"]),
                    "units": r["units_remaining"],
                    "emergency": r["medicine_name"] in EMERGENCY_MEDICINES,
                }
            )
        rows.sort(key=lambda x: (x["days"], not x["emergency"]))
        return rows

    def get_state_briefing() -> ToolResult:
        """Overview of all five districts: risk, critical facilities, shortages, pending recommendations and shipments. Use for state-wide questions."""
        ins = ctx.insights
        if ins is None:
            return ToolResult({"error": "The state summary service is not available right now."})
        summary = ins.state_summary(None)
        lg = ctx.logistics
        shortages_by_district: dict[str, list[dict]] = {}
        for row in _shortage_rows(None, 7):
            d = ctx.fdistrict(row["facility_id"])
            shortages_by_district.setdefault(d or "", []).append(row)
        districts_out, ranking = [], []
        for d in summary.get("districts", []):
            did = d["district_id"]
            delayed = None
            if lg is not None:
                delayed = len(lg.list_shipments(district_id=did, statuses=["delayed"], limit=200))
            top = [
                {"facility": r["facility"], "medicine": r["medicine"], "days": r["days"]}
                for r in shortages_by_district.get(did, [])[:3]
            ]
            districts_out.append(
                {
                    "district": ctx.dname(did),
                    "risk_counts": d.get("risk_counts"),
                    "risk_index": d.get("risk_index"),
                    "critical_facilities": [c["name"] for c in d.get("critical_facilities", [])],
                    "top_shortages": top,
                    "pending_recommendations": d.get("pending_recommendations"),
                    "shipments_in_transit": d.get("shipments_in_transit"),
                    "shipments_delayed": delayed,
                }
            )
            ranking.append({"district_id": did, "name": ctx.dname(did), "value": d.get("risk_index")})
        t = summary.get("totals", {})
        rate = t.get("on_time_rate_7d")
        state = {
            "facilities": t.get("facilities"),
            "risk_counts": t.get("risk_counts"),
            "stockout_items": t.get("stockout_items"),
            "low_cover_items": t.get("low_cover_items"),
            "pending_recommendations": t.get("pending_recommendations"),
            "shipments_in_transit": t.get("shipments_in_transit"),
            "on_time_rate_percent": round(rate * 100) if isinstance(rate, (int, float)) else None,
        }
        ranking.sort(key=lambda r: -(r["value"] or 0))
        return ToolResult(
            {"districts": districts_out, "state": state},
            card_ranking("risk_index", "index", ranking),
        )

    def get_district_briefing(district: str) -> ToolResult:
        """Full briefing for one district: facilities with their worst issue, shortages, beds, doctors, diagnostics, pending recommendations, inbound shipments, footfall and causal chain.

        Args:
            district: district name or id, e.g. "Kota" or "district_kota".
        """
        did, err = ctx.district_arg(district)
        if err or did is None:
            return ToolResult(err or {"error": "Say which district."})
        facilities = []
        risk_counts = {"healthy": 0, "monitor": 0, "stress": 0, "critical": 0}
        critical = []
        for f in ctx.repo.facilities_in(did):
            risk = forecast.facility_risk_level(f["id"])
            risk_counts[risk] += 1
            if risk == "critical":
                critical.append({"id": f["id"], "name": f["name"]})
            facilities.append(
                {"name": f["name"], "risk": risk, "worst_issue": _facility_worst_issue(f["id"])}
            )
        beds = []
        for f in ctx.repo.facilities_in(did):
            b = forecast.bed_forecast(f["id"])
            if b and b.get("predicted_next_week_pct", 0) > 85:
                beds.append({"facility": f["name"], "next_week_pct": b["predicted_next_week_pct"]})
        fids = {f["id"] for f in ctx.repo.facilities_in(did)}
        doctors = [
            {"doctor": d["doctor_name"], "facility": ctx.fname(d["facility_id"]),
             "specialty": d["specialty"], "pattern": d["absence_pattern"]}
            for d in ctx.repo.doctors
            if d["facility_id"] in fids and d["risk_level"] == "high"
        ]  # fmt: skip
        diags = [
            {"facility": ctx.fname(d["facility_id"]), "test": d["test_name"], "status": d["status"]}
            for d in ctx.repo.diagnostics
            if d["facility_id"] in fids and d["status"] != "available"
        ]
        now = ctx.now()
        recs = sorted(
            ctx.pending_recs(did),
            key=lambda r: (_PRIORITY_ORDER.get(r.get("priority"), 3), -r.get("confidence", 0)),
        )
        rec_rows = [_rec_row(r) for r in recs[:5]]
        inbound: list[dict] = []
        lg = ctx.logistics
        if lg is not None:
            for s in lg.list_shipments(district_id=did, statuses=ACTIVE_STATUSES, limit=50):
                r = _shipment_row(ctx, s, now)
                inbound.append({k: r[k] for k in ("id", "status", "to", "cargo", "eta_in_minutes")})
        ff = forecast.footfall_forecast(did)
        breakdown = ff.get("tomorrow_breakdown") or {}
        chain = ctx.repo.causal_chain_for(did) or {}
        risk_index = None
        ins = ctx.insights
        if ins is not None:
            ds = ins.state_summary(did).get("districts") or []
            risk_index = ds[0].get("risk_index") if ds else None
        llm: dict[str, Any] = {
            "district": ctx.dname(did),
            "risk_counts": risk_counts,
            "risk_index": risk_index,
            **_capped("facilities", facilities),
        }
        shortage_rows = _shortage_rows(did, 7)
        llm["shortages"] = _cap(
            [{k: r[k] for k in ("facility", "medicine", "days", "emergency")} for r in shortage_rows]
        )
        llm["beds_over_85_next_week"] = _cap(beds)
        llm["high_risk_doctors"] = _cap(doctors)
        llm["diagnostics_down"] = _cap(diags)
        llm["pending_recommendations"] = _cap(rec_rows[:5], 5)
        llm["inbound_shipments"] = _cap(inbound)
        llm["footfall_tomorrow"] = sum(v for v in breakdown.values() if isinstance(v, (int, float)))
        llm["footfall_tomorrow_breakdown"] = breakdown
        if chain:
            llm["causal_chain"] = {
                "facility": ctx.fname(chain.get("facility_id")),
                "headline": chain.get("headline"),
                "chain": chain.get("chain"),
            }
        card = card_district_summary(did, ctx.dname(did), risk_counts, risk_index, critical)
        return ToolResult(llm, card)

    def find_facility(query: str, district: str | None = None) -> ToolResult:
        """Find a facility by spoken or written name, e.g. "Kota ka PHC chaar" or "rural fourteen". Returns up to three matches.

        Args:
            query: the spoken or written facility name.
            district: optional district name or id to narrow the search.
        """
        did, err = ctx.district_arg(district)
        if err:
            return ToolResult(err)
        res = resolve_facility(query, did, facilities=ctx.repo.facilities, districts=ctx.repo.districts)
        matches = [
            {
                "name": m.name,
                "district": ctx.dname(m.district_id),
                "type": m.type,
                "risk": forecast.facility_risk_level(m.id),
                "match_score": m.score,
            }
            for m in res.matches
        ]
        return ToolResult({"matches": matches, "ambiguous": res.ambiguous})

    def get_facility_status(facility: str) -> ToolResult:
        """Everything about one facility: risk, medicines with days of cover, beds, doctors, diagnostics, inbound shipments and pending recommendations.

        Args:
            facility: facility name or id, e.g. "PHC Kota-4".
        """
        f, err = ctx.facility_arg(facility)
        if err or f is None:
            return ToolResult(err or {"error": "Say which facility."})
        fid = f["id"]
        risk = forecast.facility_risk_level(fid)
        meds = [
            {
                "name": m["medicine_name"],
                "days": _r(m["days_remaining"]),
                "risk": m["risk"],
                "confidence_percent": m["confidence"],
            }
            for m in sorted(forecast.medicine_forecast(fid), key=lambda m: m["days_remaining"])
        ]
        bed = forecast.bed_forecast(fid)
        beds = (
            {
                "total": f.get("beds_total"),
                "occupied_now": bed.get("occupied"),
                "occupancy_now_pct": bed.get("occupancy_pct"),
                "tomorrow_pct": bed.get("predicted_tomorrow_pct"),
                "next_week_pct": bed.get("predicted_next_week_pct"),
                "confidence_percent": bed.get("confidence"),
            }
            if bed
            else None
        )
        doctors = [
            {"doctor": d["doctor_name"], "specialty": d["specialty"], "absence_risk": d["risk_level"],
             "pattern": d["absence_pattern"]}
            for d in ctx.repo.doctors
            if d["facility_id"] == fid
        ]  # fmt: skip
        diags = [
            {
                "test": d["test_name"],
                "status": d["status"],
                "nearest_alternative": ctx.fname(d.get("nearest_alternative_facility_id"))
                if d.get("nearest_alternative_facility_id")
                else None,
            }
            for d in ctx.repo.diagnostics
            if d["facility_id"] == fid
        ]
        now = ctx.now()
        inbound = []
        lg = ctx.logistics
        if lg is not None:
            for s in lg.facility_inbound(fid):
                if s.get("status") in ACTIVE_STATUSES + ["arrived", "recommended"]:
                    r = _shipment_row(ctx, s, now)
                    inbound.append({k: r[k] for k in ("id", "status", "from", "cargo", "eta_in_minutes")})
        recs = [
            _rec_row(r)
            for r in ctx.recommendation.list(status="pending")
            if fid in (r.get("target_facility_id"), r.get("source_id"), r.get("source_facility_id"))
        ]
        llm = {
            "facility": f["name"],
            "district": ctx.dname(f["district_id"]),
            "type": f.get("type"),
            "risk": risk,
            "medicines": meds,
            "beds": beds,
            "doctors": doctors,
            "diagnostics": diags,
            "inbound_shipments": inbound,
            "pending_recommendations": recs,
        }
        card = card_facility(
            fid, f["name"], ctx.dname(f["district_id"]), risk, meds,
            beds.get("next_week_pct") if beds else None,
        )  # fmt: skip
        return ToolResult(llm, card)

    def get_shortages(district: str | None = None, medicine: str | None = None, max_days: float = 7) -> ToolResult:
        """Medicines running low across facilities, sorted by days of cover left.

        Args:
            district: optional district name or id. Omit for all five districts.
            medicine: optional medicine name, e.g. "ARV" or "ORS".
            max_days: only rows with fewer days of cover than this. Default 7.
        """
        did, err = ctx.district_arg(district)
        if err:
            return ToolResult(err)
        med = None
        if medicine:
            names = sorted({r["medicine_name"] for r in ctx.stock_rows(None)})
            med = _resolve_medicine(str(medicine), names)
            if med is None:
                return ToolResult({"error": f"Unknown medicine '{medicine}'.", "medicines": names})
        rows = _shortage_rows(did, float(max_days), med)
        llm = {
            "scope": ctx.dname(did),
            "medicine": med,
            "max_days": max_days,
            "total": len(rows),
            **_capped(
                "rows",
                [{k: r[k] for k in ("facility", "district", "medicine", "days", "units", "emergency")} for r in rows],
            ),
        }
        return ToolResult(llm, card_shortages(rows[:LIST_CAP]))

    def compare_districts(metric: str) -> ToolResult:
        """Rank the five districts on one metric.

        Args:
            metric: one of risk_index, critical_facilities, stockouts, bed_pressure, on_time_rate, pending_recommendations.
        """
        key = str(metric or "").strip().lower().replace(" ", "_")
        if key not in COMPARE_METRICS:
            return ToolResult({"error": f"Unknown metric '{metric}'.", "metrics": list(COMPARE_METRICS)})
        ins = ctx.insights
        if ins is None:
            return ToolResult({"error": "The district comparison service is not available right now."})
        rows = []
        for d in ins.state_summary(None).get("districts", []):
            if key == "risk_index":
                v = d.get("risk_index")
            elif key == "critical_facilities":
                v = len(d.get("critical_facilities") or []) or (d.get("risk_counts") or {}).get("critical", 0)
            elif key == "stockouts":
                v = d.get("stockout_items")
            elif key == "bed_pressure":
                v = d.get("bed_next_week_avg")
            elif key == "on_time_rate":
                r = d.get("on_time_rate_7d")
                v = round(r * 100, 1) if isinstance(r, (int, float)) else None
            else:
                v = d.get("pending_recommendations")
            rows.append({"district_id": d["district_id"], "name": ctx.dname(d["district_id"]), "value": _r(v)})
        rows.sort(key=lambda r: (r["value"] is None, r["value"] if key == "on_time_rate" else -(r["value"] or 0)))
        unit = COMPARE_METRICS[key]
        llm = {
            "metric": key,
            "unit": unit,
            "order": "lowest first (worst first)" if key == "on_time_rate" else "highest first (worst first)",
            "ranking": [{"district": r["name"], "value": r["value"]} for r in rows],
        }
        return ToolResult(llm, card_ranking(key, unit, rows))

    def _rec_row(r: dict[str, Any]) -> dict[str, Any]:
        return {
            "subject": r.get("subject"),
            "type": r.get("type"),
            "facility": ctx.fname(r.get("target_facility_id")),
            "district": ctx.dname(ctx.rec_district(r)),
            "priority": r.get("priority"),
            "confidence": r.get("confidence"),
            "eta_minutes": r.get("eta_minutes"),
            "status": r.get("status"),
        }

    def get_recommendations(
        district: str | None = None, status: str = "pending", priority: str | None = None, limit: int = 5
    ) -> ToolResult:
        """AI recommendations (replenishments, transfers, staffing, bed redirects) with their status. Read only: you cannot approve them.

        Args:
            district: optional district name or id.
            status: pending (default), approved, dispatched, fulfilled, rejected, expired, cancelled or all.
            priority: optional critical, high or normal.
            limit: maximum rows, default 5.
        """
        did, err = ctx.district_arg(district)
        if err:
            return ToolResult(err)
        st = (status or "pending").lower()
        recs = ctx.recommendation.list(status=None if st == "all" else st)
        if did:
            recs = [r for r in recs if ctx.rec_district(r) == did]
        if priority:
            recs = [r for r in recs if r.get("priority") == priority.lower()]
        recs = sorted(recs, key=lambda r: (_PRIORITY_ORDER.get(r.get("priority"), 3), -r.get("confidence", 0)))
        rows = [_rec_row(r) for r in recs]
        n = max(1, min(int(limit or 5), LIST_CAP))
        return ToolResult({"status": st, "total": len(rows), **_capped("recommendations", rows, n)})

    def _no_logistics() -> ToolResult:
        return ToolResult({"error": "Shipment and fleet data is not available right now."})

    def get_shipments(
        district: str | None = None,
        facility: str | None = None,
        status: list[str] | None = None,
        limit: int = 5,
    ) -> ToolResult:
        """Shipments (medicine deliveries) with status, ETA, delay and driver.

        Args:
            district: optional district name or id.
            facility: optional destination facility name.
            status: optional list of statuses: recommended, approved, loading, in_transit, delayed, arrived, delivered, cancelled.
            limit: maximum rows, default 5.
        """
        lg = ctx.logistics
        if lg is None:
            return _no_logistics()
        did, err = ctx.district_arg(district)
        if err:
            return ToolResult(err)
        fid = None
        if facility:
            f, ferr = ctx.facility_arg(facility, did)
            if ferr or f is None:
                return ToolResult(ferr or {"error": "Unknown facility."})
            fid = f["id"]
        if isinstance(status, str):
            status = [s.strip() for s in status.split(",") if s.strip()]
        rows = lg.list_shipments(district_id=did, facility_id=fid, statuses=status or None, limit=200)
        now = ctx.now()
        out = [_shipment_row(ctx, s, now) for s in rows]
        n = max(1, min(int(limit or 5), LIST_CAP))
        cards = [{**r, "eta": s.get("eta")} for r, s in zip(out[:n], rows[:n], strict=False)]
        return ToolResult(
            {"total": len(out), **_capped("shipments", out, n)}, card_shipments(cards)
        )

    def get_shipment(shipment: str) -> ToolResult:
        """Track one shipment: status, progress, ETA, delay reason, vehicle, driver, temperature and last event.

        Args:
            shipment: a shipment id such as SHP-200123, or a facility name meaning the latest active shipment to it.
        """
        lg = ctx.logistics
        if lg is None:
            return _no_logistics()
        text = str(shipment or "").strip()
        sid = None
        if _SHIPMENT_ID_RE.match(text):
            sid = re.sub(r"\s+", "", text).upper()
            if "-" not in sid:
                sid = "SHP-" + sid[3:]
        else:
            f, ferr = ctx.facility_arg(text)
            if ferr or f is None:
                return ToolResult(ferr or {"error": "Unknown facility."})
            latest = lg.latest_active_for_facility(f["id"])
            if not latest:
                return ToolResult({"error": f"No active shipment to {f['name']}."})
            sid = latest["id"]
        try:
            d = lg.get_shipment(sid)
        except (KeyError, LookupError, ValueError):
            return ToolResult({"error": f"Shipment {sid} was not found."})
        now = ctx.now()
        events = d.get("events") or []
        last = events[-1] if events else None
        delay_reason = d.get("blocked_reason")
        if not delay_reason:
            for e in reversed(events):
                if e.get("type") in ("incident_started", "cold_chain_breach"):
                    delay_reason = e.get("detail") or e.get("title")
                    break
        veh = d.get("vehicle") or {}
        driver = (d.get("driver") or {}).get("name")
        temps = d.get("temperature") or []
        temp = temps[-1].get("temp_c") if temps else (d.get("position") or {}).get("temp_c")
        progress = d.get("progress")
        pct = round(progress * 100) if isinstance(progress, (int, float)) else None
        vehicle_label = " ".join(x for x in (veh.get("registration"), veh.get("class")) if x) or None
        llm = {
            "id": d.get("id"),
            "status": d.get("status"),
            "from": (d.get("origin") or {}).get("name"),
            "to": (d.get("destination") or {}).get("name"),
            "cargo": d.get("lines_summary"),
            "progress_percent": pct,
            "eta_in_minutes": _minutes_until(d.get("eta"), now),
            "delay_minutes": d.get("delay_minutes") or 0,
            "delay_reason": delay_reason,
            "vehicle": vehicle_label,
            "driver": driver,
            "temperature_c": _r(temp) if temp is not None else None,
            "last_event": (last or {}).get("title"),
        }
        card = card_shipment(d.get("id"), d.get("status"), d.get("eta"), pct, driver, vehicle_label, llm["temperature_c"])
        return ToolResult(llm, card)

    def get_fleet_status(district: str | None = None) -> ToolResult:
        """Vehicles by live status, drivers on shift and queued shipments with the reason they are blocked.

        Args:
            district: optional district name or id.
        """
        lg = ctx.logistics
        if lg is None:
            return _no_logistics()
        did, err = ctx.district_arg(district)
        if err:
            return ToolResult(err)
        fs = lg.fleet_status(did)
        vehicles = _counts(fs.get("vehicles_by_status", fs.get("vehicles")))
        drivers = fs.get("drivers_on_shift")
        if drivers is None:
            drivers = fs.get("drivers")
        if isinstance(drivers, (dict, list)):
            dc = _counts(drivers)
            drivers = sum(v for k, v in dc.items() if k not in ("off_shift", "unknown")) if dc else 0
        queued_raw = fs.get("queued") or fs.get("queued_shipments") or []
        queued = [
            {
                "id": q.get("id") or q.get("shipment_id"),
                "to": (q.get("destination") or {}).get("name") if isinstance(q.get("destination"), dict) else q.get("to"),
                "blocked_reason": q.get("blocked_reason") or q.get("reason"),
            }
            for q in queued_raw
            if isinstance(q, dict)
        ]
        llm = {
            "scope": ctx.dname(did),
            "vehicles": vehicles,
            "drivers_on_shift": drivers,
            "queued_shipments": len(queued),
            **_capped("queued", queued),
        }
        return ToolResult(llm, card_fleet(vehicles, queued[:LIST_CAP]))

    def get_footfall_forecast(district: str) -> ToolResult:
        """Next seven days of predicted patient footfall for a district, tomorrow's breakdown and the forecast confidence.

        Args:
            district: district name or id.
        """
        did, err = ctx.district_arg(district)
        if err or did is None:
            return ToolResult(err or {"error": "Say which district."})
        ff = forecast.footfall_forecast(did)
        return ToolResult(
            {
                "district": ctx.dname(did),
                "next_7_days": [{"day": p["day"], "predicted": p["predicted"]} for p in ff["series"]],
                "tomorrow_breakdown": ff["tomorrow_breakdown"],
                "confidence_percent": ff["confidence"],
                "factors": ff["factors"],
            }
        )

    def get_causal_chain(facility: str) -> ToolResult:
        """The chain of causes behind a demand spike at a facility.

        Args:
            facility: facility name or id.
        """
        f, err = ctx.facility_arg(facility)
        if err or f is None:
            return ToolResult(err or {"error": "Say which facility."})
        c = ctx.district.causal_chain(f["id"])
        return ToolResult(
            {"facility": f["name"], "district": ctx.dname(f["district_id"]),
             "headline": c.get("headline"), "chain": c.get("chain")}
        )  # fmt: skip

    def get_performance(district: str | None = None, worst_n: int = 5) -> ToolResult:
        """Lowest performance scores among facilities with their sub-scores.

        Args:
            district: optional district name or id.
            worst_n: how many facilities to return, default 5.
        """
        did, err = ctx.district_arg(district)
        if err:
            return ToolResult(err)
        scores = ctx.district.performance_scores(did)
        n = max(1, min(int(worst_n or 5), LIST_CAP))
        rows = [
            {
                "facility": s["facility_name"],
                "district": ctx.dname(s["district_id"]),
                "overall": s["overall"],
                "inventory": s["inventory"],
                "attendance": s["attendance"],
                "diagnostics": s["diagnostics"],
                "patient_wait": s["patient_wait"],
            }
            for s in scores[:n]
        ]
        return ToolResult({"scope": ctx.dname(did), "lowest_scores": rows, "total_facilities": len(scores)})

    return {
        "get_state_briefing": get_state_briefing,
        "get_district_briefing": get_district_briefing,
        "find_facility": find_facility,
        "get_facility_status": get_facility_status,
        "get_shortages": get_shortages,
        "compare_districts": compare_districts,
        "get_recommendations": get_recommendations,
        "get_shipments": get_shipments,
        "get_shipment": get_shipment,
        "get_fleet_status": get_fleet_status,
        "get_footfall_forecast": get_footfall_forecast,
        "get_causal_chain": get_causal_chain,
        "get_performance": get_performance,
    }


def build_tools(
    district: DistrictService,
    forecast: ForecastService,
    recommendation: RecommendationService,
    logistics: LogisticsQuery | None = None,
    insights: InsightsQuery | None = None,
) -> list[Callable[..., dict]]:
    """Gemini-shaped tool list: same callables, but each returns only the `llm` dict.

    The wrapper keeps the original parameter list and docstring (google-genai
    introspects them) and reports `dict` as its return type.
    """
    tools = []
    for fn in build_tool_functions(district, forecast, recommendation, logistics, insights).values():
        tools.append(_llm_only(fn))
    return tools


def _llm_only(fn: Callable[..., ToolResult]) -> Callable[..., dict]:
    def wrapper(*args: Any, **kwargs: Any) -> dict:
        return fn(*args, **kwargs).llm

    wrapper.__name__ = fn.__name__
    wrapper.__qualname__ = fn.__qualname__
    wrapper.__doc__ = fn.__doc__
    wrapper.__signature__ = inspect.signature(fn).replace(return_annotation=dict)  # type: ignore[attr-defined]
    return wrapper
