"""Recommendation engine v2 (plan section 5.12).

The engine only ever proposes. State changes happen through `resolve()` (the
human decision) and through the lifecycle hooks the logistics service calls
when a linked shipment departs, is delivered or is cancelled. Recommendations
are refreshed from the current data instead of being generated once per process
(K1), ids are stable hashes (K1), transfers stay inside a district and respect
road distance and reserved surplus (K2), bed redirects and staff transfers pick
sensible in-district counterparts (K3, K4) and the status machine is enforced
(K5).
"""

import copy
import hashlib
import math
import re
import threading
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.core.exceptions import InvalidTransitionError, RecommendationNotFoundError
from app.logistics import master, roads, sim
from app.logistics.catalog import line_for, medicines
from app.logistics.clock import iso, parse_iso
from app.repositories.district_repository import DistrictRepository
from app.services.forecast_service import ForecastService

STOCK_TYPES = ("replenishment", "stock_transfer")
DEFAULT_THRESHOLD_DAYS = 5
REPLENISH_TARGET_DAYS = 21
LATERAL_TARGET_DAYS = 7
SOURCE_KEEP_DAYS = 14
LATERAL_MAX_KM = 40.0
LATERAL_MARGIN_MINUTES = 30
SUPPRESSION_MINUTES = 120
BED_TARGET_MAX_PCT = 85
BED_TRIGGER_PCT = 90

TERMINAL = ("rejected", "expired", "fulfilled", "cancelled")
NON_TERMINAL = ("pending", "approved", "modified", "dispatched")
ACTIVE = ("approved", "modified", "dispatched")

LEGAL_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"approved", "modified", "rejected", "expired"},
    "approved": {"dispatched", "cancelled"},
    "modified": {"dispatched", "cancelled"},
    "dispatched": {"fulfilled", "cancelled"},
}
ALL_STATUSES = {"pending", *TERMINAL, "approved", "modified", "dispatched"}
PRIORITY_RANK = {"critical": 0, "high": 1, "normal": 2}

# The service has a method named `list`, which shadows the builtin inside the class body.
Records = list[dict]
Strings = list[str]


class RecommendationHooks(Protocol):
    """Implemented by the logistics service to keep one draft shipment per stock recommendation."""

    def create_draft(self, rec: dict) -> None: ...

    def update_draft(self, rec: dict) -> None: ...

    def cancel_draft(self, rec: dict, reason: str) -> None: ...

    def approve_draft(self, rec: dict, actor: str, quantity: int | None) -> str | None: ...


def plural(unit: str, n: int) -> str:
    """`vial`, 120 -> `vials`; `strip of 10 tablets`, 3 -> `strips of 10 tablets`."""
    if n == 1:
        return unit
    if " of " in unit:
        head, tail = unit.split(" of ", 1)
        return f"{head}s of {tail}"
    return unit + "s"


def _leading_int(text: str | None) -> int | None:
    if not text:
        return None
    m = re.match(r"\s*(\d+)", text)
    return int(m.group(1)) if m else None


def _as_dt(value: Any) -> datetime:
    return value if isinstance(value, datetime) else parse_iso(str(value))


def _priority(days: float, emergency: bool) -> str:
    if days < 3 or (emergency and days < 5):
        return "critical"
    if days < 4:
        return "high"
    return "normal"


def _confidence(forecast_conf: float, distance_km: float, emergency: bool, has_factors: bool) -> int:
    value = (
        0.5 * forecast_conf
        + 25 * (1 - min(distance_km, 60.0) / 60.0)
        + (10 if emergency else 0)
        + (10 if has_factors else 0)
    )
    return int(min(98, max(40, round(value))))


def _fmt_num(x: float) -> str:
    return f"{x:g}" if abs(x - round(x)) > 1e-9 else str(round(x))


class RecommendationService:
    """Recommendation records, their status machine and the refresh loop."""

    def __init__(
        self,
        repo: DistrictRepository,
        forecast: ForecastService,
        *,
        routes: roads.Routes | None = None,
        now_provider: Callable[[], datetime] | None = None,
        warehouse_stock: Callable[[str, str], int] | None = None,
        delivery_provider: Callable[[], Iterable[dict]] | None = None,
    ):
        self.repo = repo
        self.forecast = forecast
        self._routes = routes if routes is not None else roads.load_routes()
        self._now_provider = now_provider or (lambda: datetime.now(UTC).replace(microsecond=0))
        self._warehouse_stock = warehouse_stock or self._seed_warehouse_stock
        self._delivery_provider = delivery_provider
        self._hooks: RecommendationHooks | None = None
        self._records: dict[str, dict] = {}
        self._keys: dict[str, str] = {}  # rec id -> stable key
        self._episodes: dict[str, int] = {}  # key -> latest episode number
        self._prev_candidate_keys: set[str] = set()
        self._version_seen: int | None = None
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ wiring

    def bind(
        self,
        hooks: RecommendationHooks | None = None,
        *,
        now_provider: Callable[[], datetime] | None = None,
        warehouse_stock: Callable[[str, str], int] | None = None,
        delivery_provider: Callable[[], Iterable[dict]] | None = None,
    ) -> None:
        """Connect the logistics side (draft shipments, sim time, warehouse stock, deliveries)."""
        if hooks is not None:
            self._hooks = hooks
        if now_provider is not None:
            self._now_provider = now_provider
        if warehouse_stock is not None:
            self._warehouse_stock = warehouse_stock
        if delivery_provider is not None:
            self._delivery_provider = delivery_provider

    @staticmethod
    def _seed_warehouse_stock(warehouse_id: str, medicine_name: str) -> int:
        row = master.base_warehouse_stock().get((warehouse_id, medicine_name))
        return int(row["units"]) if row else 0

    def _now(self) -> datetime:
        return self._now_provider()

    # ------------------------------------------------------------------ persistence

    def export_state(self) -> dict:
        with self._lock:
            return {
                "recommendations": copy.deepcopy(self._records),
                "keys": dict(self._keys),
                "episodes": dict(self._episodes),
                "candidate_keys": sorted(self._prev_candidate_keys),
            }

    def load_state(self, state: dict) -> None:
        with self._lock:
            self._records = copy.deepcopy(state.get("recommendations", {}))
            self._keys = dict(state.get("keys", {}))
            self._episodes = dict(state.get("episodes", {}))
            self._prev_candidate_keys = set(state.get("candidate_keys", []))
            self._version_seen = None

    # ------------------------------------------------------------------ queries

    def _maybe_refresh(self) -> None:
        if self._version_seen != self.repo.version:
            self.refresh()

    def list(
        self,
        status: str | None = None,
        district_id: str | None = None,
        type: str | None = None,
        priority: str | None = None,
    ) -> list[dict]:
        with self._lock:
            self._maybe_refresh()
            values = list(self._records.values())
        if status:
            values = [r for r in values if r["status"] == status]
        if district_id:
            values = [r for r in values if r["district_id"] == district_id]
        if type:
            values = [r for r in values if r["type"] == type]
        if priority:
            values = [r for r in values if r["priority"] == priority]
        values.sort(key=lambda r: (-r["confidence"], r["id"]))
        return copy.deepcopy(values)

    def get(self, rec_id: str) -> dict:
        with self._lock:
            self._maybe_refresh()
            if rec_id not in self._records:
                raise RecommendationNotFoundError(rec_id)
            return copy.deepcopy(self._records[rec_id])

    def key_for(self, rec_id: str) -> str:
        return self._keys[rec_id]

    # ------------------------------------------------------------------ generation

    def _road(self, a: str, b: str) -> dict | None:
        return self._routes.get(roads.route_key(a, b))

    def _generate(self) -> Records:
        repo = self.repo
        cat = medicines()
        facilities = repo.facilities
        by_id = {f["id"]: f for f in facilities}
        stock: dict[tuple[str, str], dict] = {}
        forecasts: dict[tuple[str, str], dict] = {}
        for f in facilities:
            for row in repo.medicine_stock_for(f["id"]):
                stock[(f["id"], row["medicine_name"])] = row
            for fc in self.forecast.medicine_forecast(f["id"]):
                forecasts[(f["id"], fc["medicine_name"])] = fc

        triggers = []
        for (fid, med), row in stock.items():
            meta = cat.get(med)
            if meta is None:
                continue
            c = float(row.get("avg_daily_consumption") or 0)
            if c <= 0:
                c = 0.1
            units = int(row["units_remaining"])
            days = units / c
            threshold = row.get("reorder_threshold_days") or DEFAULT_THRESHOLD_DAYS
            if days >= threshold:
                continue
            emergency = bool(meta["emergency"])
            triggers.append(
                {
                    "fid": fid,
                    "med": med,
                    "meta": meta,
                    "c": c,
                    "units": units,
                    "days": days,
                    "emergency": emergency,
                    "priority": _priority(days, emergency),
                }
            )
        triggers.sort(key=lambda t: (PRIORITY_RANK[t["priority"]], t["days"], t["fid"], t["med"]))

        # Working copies so no surplus or warehouse unit is promised twice (K2).
        surplus_used: dict[tuple[str, str], int] = {}
        for rec in self._records.values():
            if rec["type"] == "stock_transfer" and rec["status"] in ACTIVE:
                k = (rec["source_id"], rec["medicine_name"])
                surplus_used[k] = surplus_used.get(k, 0) + int(rec["quantity"] or 0)
        wh_used: dict[tuple[str, str], int] = {}

        def wh_available(wh: str, med: str) -> int:
            return self._warehouse_stock(wh, med) - wh_used.get((wh, med), 0)

        out: list[dict] = []
        for t in triggers:
            target = by_id[t["fid"]]
            district_id = target["district_id"]
            unit = t["meta"]["unit"]
            c = t["c"]
            fc = forecasts.get((t["fid"], t["med"]), {})
            factors = repo.demand_factors_for(t["fid"])
            ddw = master.ddw_for_district(district_id)

            repl_qty = math.ceil(REPLENISH_TARGET_DAYS * c - t["units"])
            if repl_qty <= 0:
                continue
            repl_line = line_for(t["med"], repl_qty)

            # Replenishment origin: the DDW unless it is short after reservations.
            origin = ddw
            short = wh_available(ddw, t["med"]) < repl_qty
            if short:
                origin = master.CENTRAL_ID
            cls = sim.pick_vehicle_class(
                repl_line.weight_kg,
                repl_line.pallet_slots,
                repl_line.cold_chain,
                central=origin == master.CENTRAL_ID,
            )
            route = self._road(origin, t["fid"])
            if cls is None or route is None:
                continue
            repl_eta = sim.estimate_trip_minutes(
                self._routes, origin, [t["fid"]], repl_line.pallet_slots, cls
            )

            lateral = None
            if t["priority"] == "critical":
                lateral = self._best_lateral(t, by_id, stock, surplus_used, ddw, repl_eta)

            if lateral is not None:
                src = lateral["source"]
                qty = lateral["qty"]
                key_used = (src["id"], t["med"])
                surplus_used[key_used] = surplus_used.get(key_used, 0) + qty
                rec_type = "stock_transfer"
                source_kind, source_id, source_name = "facility", src["id"], src["name"]
                holds = lateral["holds"]
                distance_km = lateral["km"]
                road_minutes = lateral["road_minutes"]
                eta = lateral["eta"]
            else:
                qty = repl_qty
                if short:
                    qty = min(repl_qty, max(0, wh_available(origin, t["med"])))
                    if qty <= 0:
                        continue
                holds = wh_available(origin, t["med"])
                wh_used[(origin, t["med"])] = wh_used.get((origin, t["med"]), 0) + qty
                rec_type = "replenishment"
                source_kind, source_id = "warehouse", origin
                source_name = master.warehouse(origin)["name"]
                distance_km = route["distance_m"] / 1000.0
                road_minutes = route["duration_s"] / 60.0 * sim.speed_factor(cls)
                eta = repl_eta

            days = round(t["days"], 1)
            reasons = [
                (
                    f"Projected stock-out in {_fmt_num(days)} days "
                    f"({t['units']} {plural(unit, t['units'])} left, {_fmt_num(c)} per day)"
                )
            ]
            if t["emergency"]:
                reasons.append(f"{t['med']} is an emergency medicine")
            reasons.extend(factors)
            if rec_type == "replenishment" and short:
                reasons.append("District warehouse stock insufficient")
            reasons.append(
                f"{source_name} holds {holds} {plural(unit, holds)}; "
                f"{distance_km:.0f} km, about {round(road_minutes)} min by road"
            )
            out.append(
                self._candidate(
                    rec_type=rec_type,
                    district_id=district_id,
                    source_kind=source_kind,
                    source_id=source_id,
                    target_id=t["fid"],
                    subject=t["med"],
                    medicine=t["med"],
                    quantity=qty,
                    unit=unit,
                    priority=t["priority"],
                    confidence=_confidence(
                        fc.get("confidence", 80), distance_km, t["emergency"], bool(factors)
                    ),
                    reasons=reasons,
                    distance_km=round(distance_km, 1),
                    eta_minutes=round(eta),
                )
            )

        out.extend(self._bed_candidates(by_id))
        out.extend(self._staff_candidates(by_id))
        return out

    def _best_lateral(self, t, by_id, stock, surplus_used, ddw, repl_eta) -> dict | None:
        target = by_id[t["fid"]]
        c = t["c"]
        want = math.ceil(LATERAL_TARGET_DAYS * c - t["units"])
        if want <= 0:
            return None
        best = None
        for other in self.repo.facilities_in(target["district_id"]):
            if other["id"] == target["id"]:
                continue
            row = stock.get((other["id"], t["med"]))
            route = self._road(other["id"], target["id"])
            if row is None or route is None:
                continue
            km = route["distance_m"] / 1000.0
            if km > LATERAL_MAX_KM:
                continue
            c_src = float(row.get("avg_daily_consumption") or 0) or 0.1
            surplus = int(row["units_remaining"] - SOURCE_KEEP_DAYS * c_src) - surplus_used.get(
                (other["id"], t["med"]), 0
            )
            if surplus <= 0:
                continue
            qty = min(want, surplus)
            line = line_for(t["med"], qty)
            cls = sim.pick_vehicle_class(line.weight_kg, line.pallet_slots, line.cold_chain)
            first_leg = self._road(ddw, other["id"])
            if cls is None or first_leg is None:
                continue
            road_minutes = route["duration_s"] / 60.0 * sim.speed_factor(cls)
            # The DDW van drives to the source, loads there, then drives on to the target.
            full_eta = sim.estimate_trip_minutes(
                self._routes, ddw, [other["id"], target["id"]], line.pallet_slots, cls, pickups=1
            )
            if full_eta + LATERAL_MARGIN_MINUTES >= repl_eta:
                continue
            cand = {
                "source": other,
                "qty": qty,
                "holds": int(row["units_remaining"]),
                "km": km,
                "road_minutes": road_minutes,
                "eta": full_eta,
            }
            rank = (km, -surplus, other["id"])
            if best is None or rank < best[0]:
                best = (rank, cand)
        return best[1] if best else None

    def _bed_candidates(self, by_id: dict[str, dict]) -> Records:
        beds = {(b.get("facility_id") or b.get("_doc_id")): b for b in self.repo.beds}
        out = []
        for fid, bed in beds.items():
            pct = bed.get("predicted_occupancy_next_week_pct", 0)
            source = by_id.get(fid)
            if source is None or pct <= BED_TRIGGER_PCT:
                continue
            options = []
            for other in self.repo.facilities_in(source["district_id"]):
                if other["id"] == fid or other["type"] != "CHC":
                    continue
                other_bed = beds.get(other["id"])
                route = self._road(fid, other["id"])
                if other_bed is None or route is None:
                    continue
                other_pct = other_bed.get("predicted_occupancy_next_week_pct", 100)
                if other_pct >= BED_TARGET_MAX_PCT:
                    continue
                options.append((route["distance_m"], other["id"], other, other_pct, route))
            if not options:
                continue
            _, _, target, target_pct, route = min(options, key=lambda o: (o[0], o[1]))
            km = route["distance_m"] / 1000.0
            out.append(
                self._candidate(
                    rec_type="bed_redirect",
                    district_id=source["district_id"],
                    source_kind="facility",
                    source_id=fid,
                    target_id=target["id"],
                    subject="Redirect new admissions",
                    medicine=None,
                    quantity=None,
                    unit=None,
                    detail="Redirect new admissions",
                    priority="critical" if pct >= 95 else "high",
                    confidence=_confidence(89, km, False, False),
                    reasons=[
                        f"Bed occupancy forecast: {pct}% next week at {source['name']}",
                        f"{target['name']} is forecast at {target_pct}% next week, {km:.0f} km away",
                    ],
                    distance_km=round(km, 1),
                    eta_minutes=round(route["duration_s"] / 60.0),
                )
            )
        return out

    def _staff_candidates(self, by_id: dict[str, dict]) -> Records:
        out = []
        doctors = self.repo.doctors
        risk_cache: dict[str, str] = {}

        def risk(fid: str) -> str:
            if fid not in risk_cache:
                risk_cache[fid] = self.forecast.facility_risk_level(fid)
            return risk_cache[fid]

        for doc in doctors:
            if doc.get("risk_level") != "high":
                continue
            target = by_id.get(doc["facility_id"])
            if target is None:
                continue
            options = []
            for other in self.repo.facilities_in(target["district_id"]):
                if other["id"] == target["id"] or risk(other["id"]) not in ("healthy", "monitor"):
                    continue
                helper = next(
                    (
                        d
                        for d in doctors
                        if d["facility_id"] == other["id"] and d.get("risk_level") == "low"
                    ),
                    None,
                )
                route = self._road(other["id"], target["id"])
                if helper is None or route is None:
                    continue
                options.append((route["distance_m"], other["id"], other, helper, route))
            if not options:
                continue
            _, _, source, helper, route = min(options, key=lambda o: (o[0], o[1]))
            km = route["distance_m"] / 1000.0
            out.append(
                self._candidate(
                    rec_type="staff_transfer",
                    district_id=target["district_id"],
                    source_kind="facility",
                    source_id=source["id"],
                    target_id=target["id"],
                    subject=f"Relief {doc['specialty']}: {source['name']} to {target['name']}",
                    medicine=None,
                    quantity=None,
                    unit=None,
                    detail=f"Temporary 2-week cover for {doc['doctor_name']}",
                    priority="high",
                    confidence=_confidence(81, km, False, False),
                    reasons=[
                        f"{doc['doctor_name']} absent: {doc.get('absence_pattern') or 'pattern unknown'}",
                        f"Projected patient delay of {doc.get('patient_delay_pct', 0)}% if unresolved",
                        (
                            f"{source['name']} is {risk(source['id'])} and "
                            f"{helper['doctor_name']} has low absence risk"
                        ),
                    ],
                    distance_km=round(km, 1),
                    eta_minutes=round(route["duration_s"] / 60.0),
                )
            )
        return out

    @staticmethod
    def _candidate(
        *,
        rec_type: str,
        district_id: str,
        source_kind: str,
        source_id: str,
        target_id: str,
        subject: str,
        medicine: str | None,
        quantity: int | None,
        unit: str | None,
        priority: str,
        confidence: int,
        reasons: Strings,
        distance_km: float | None,
        eta_minutes: int | None,
        detail: str | None = None,
    ) -> dict:
        if detail is None and quantity is not None and unit is not None:
            detail = f"{quantity} {plural(unit, quantity)}"
        return {
            "key": f"{rec_type}|{source_id}|{target_id}|{subject}",
            "type": rec_type,
            "district_id": district_id,
            "source_kind": source_kind,
            "source_id": source_id,
            "source_facility_id": source_id,
            "target_facility_id": target_id,
            "subject": subject,
            "medicine_name": medicine,
            "quantity": quantity,
            "unit": unit,
            "quantity_or_detail": detail,
            "priority": priority,
            "confidence": confidence,
            "reasons": reasons,
            "distance_km": distance_km,
            "eta_minutes": eta_minutes,
        }

    # ------------------------------------------------------------------ refresh

    def _recent_deliveries(self, now: datetime) -> set[tuple[str, str]]:
        if self._delivery_provider is None:
            return set()
        cutoff = now - timedelta(minutes=SUPPRESSION_MINUTES)
        recent = set()
        for entry in self._delivery_provider():
            at = _as_dt(entry["at"]) if entry.get("at") else None
            if at is not None and at >= cutoff:
                recent.add((entry["facility_id"], entry["medicine_name"]))
        return recent

    def _latest_for_key(self, key: str) -> dict | None:
        n = self._episodes.get(key)
        if not n:
            return None
        base = "rec_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]
        return self._records.get(base if n == 1 else f"{base}_{n}")

    def refresh(self, now: datetime | None = None) -> dict[str, Strings]:
        """Recompute candidates; expire stale pending records; add new ones (5.12)."""
        with self._lock:
            now = now or self._now()
            candidates = {c["key"]: c for c in self._generate()}
            added: list[str] = []
            expired: list[str] = []
            changed: list[str] = []

            for rec in list(self._records.values()):
                if rec["status"] == "pending" and self._keys[rec["id"]] not in candidates:
                    self._apply(rec, "expired", now, "system", "Condition cleared")
                    expired.append(rec["id"])
                    if self._hooks and rec["type"] in STOCK_TYPES:
                        self._hooks.cancel_draft(rec, "Condition cleared")

            active_pairs = {
                (r["target_facility_id"], r["medicine_name"])
                for r in self._records.values()
                if r["status"] in ACTIVE and r["medicine_name"]
            }
            recent = self._recent_deliveries(now)

            for key, cand in candidates.items():
                latest = self._latest_for_key(key)
                if latest is not None and latest["status"] in NON_TERMINAL:
                    if latest["status"] == "pending" and self._refresh_pending(latest, cand):
                        changed.append(latest["id"])
                        if self._hooks and latest["type"] in STOCK_TYPES:
                            self._hooks.update_draft(latest)
                    continue
                pair = (cand["target_facility_id"], cand["medicine_name"])
                if cand["medicine_name"] and (pair in active_pairs or pair in recent):
                    continue
                if (
                    latest is not None
                    and latest["status"] == "rejected"
                    and key in self._prev_candidate_keys
                ):
                    continue  # a rejected recommendation stays rejected until the condition clears
                rec = self._new_episode(cand, now)
                added.append(rec["id"])
                if self._hooks and rec["type"] in STOCK_TYPES:
                    self._hooks.create_draft(rec)

            self._prev_candidate_keys = set(candidates)
            self._version_seen = self.repo.version
            return {"added": added, "expired": expired, "changed": changed}

    def _new_episode(self, cand: dict, now: datetime) -> dict:
        key = cand["key"]
        n = self._episodes.get(key, 0) + 1
        self._episodes[key] = n
        base = "rec_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]
        rec_id = base if n == 1 else f"{base}_{n}"
        rec = {k: v for k, v in cand.items() if k != "key"}
        rec.update(
            {
                "id": rec_id,
                "status": "pending",
                "created_at": iso(now),
                "resolved_at": None,
                "resolved_by": None,
                "resolution_note": None,
                "shipment_id": None,
                "episode": n,
            }
        )
        self._records[rec_id] = rec
        self._keys[rec_id] = key
        return rec

    @staticmethod
    def _refresh_pending(rec: dict, cand: dict) -> bool:
        fields = (
            "quantity",
            "quantity_or_detail",
            "priority",
            "confidence",
            "reasons",
            "distance_km",
            "eta_minutes",
        )
        if all(rec.get(f) == cand[f] for f in fields):
            return False
        for f in fields:
            rec[f] = cand[f]
        return True

    # ------------------------------------------------------------------ status machine

    @staticmethod
    def _apply(rec: dict, status: str, now: datetime, actor: str, note: str | None) -> None:
        rec["status"] = status
        if rec.get("resolved_at") is None and status in ("approved", "modified", "rejected", "expired"):
            rec["resolved_at"] = iso(now)
            rec["resolved_by"] = actor
        if note:
            rec["resolution_note"] = note

    @staticmethod
    def _check(rec: dict, status: str) -> None:
        if status not in ALL_STATUSES:
            raise InvalidTransitionError(f"Unknown recommendation status '{status}'")
        if status not in LEGAL_TRANSITIONS.get(rec["status"], set()):
            raise InvalidTransitionError(
                f"Recommendation {rec['id']} is {rec['status']} and cannot become {status}"
            )

    def resolve(
        self,
        rec_id: str,
        status: str,
        quantity_override: str | None = None,
        actor: str | None = None,
        note: str | None = None,
    ) -> dict:
        """Human decision on a recommendation. 404 unknown id, 409 illegal transition."""
        with self._lock:
            self._maybe_refresh()
            rec = self._records.get(rec_id)
            if rec is None:
                raise RecommendationNotFoundError(rec_id)
            self._check(rec, status)
            now = self._now()
            actor = actor or "Officer"
            snapshot = copy.deepcopy(rec)

            if quantity_override:
                if rec["type"] in STOCK_TYPES:
                    qty = _leading_int(quantity_override)
                    if qty:
                        rec["quantity"] = qty
                        rec["quantity_or_detail"] = f"{qty} {plural(rec['unit'], qty)}"
                    else:
                        rec["quantity_or_detail"] = quantity_override
                else:
                    rec["quantity_or_detail"] = quantity_override
            self._apply(rec, status, now, actor, note)

            if rec["type"] in STOCK_TYPES and self._hooks is not None:
                try:
                    if status in ("approved", "modified"):
                        shipment_id = self._hooks.approve_draft(
                            rec, actor, _leading_int(quantity_override)
                        )
                        if shipment_id:
                            rec["shipment_id"] = shipment_id
                    elif status == "rejected":
                        self._hooks.cancel_draft(rec, note or "Recommendation rejected")
                except Exception:
                    self._records[rec_id] = snapshot
                    raise
            return copy.deepcopy(rec)

    def _lifecycle(self, rec_id: str, status: str, note: str | None = None) -> dict | None:
        with self._lock:
            rec = self._records.get(rec_id)
            if rec is None:
                return None
            if rec["status"] == status:
                return copy.deepcopy(rec)
            self._check(rec, status)
            self._apply(rec, status, self._now(), "system", note)
            return copy.deepcopy(rec)

    def mark_dispatched(self, rec_id: str) -> dict | None:
        return self._lifecycle(rec_id, "dispatched")

    def mark_fulfilled(self, rec_id: str) -> dict | None:
        return self._lifecycle(rec_id, "fulfilled")

    def mark_cancelled(self, rec_id: str, reason: str | None = None) -> dict | None:
        return self._lifecycle(rec_id, "cancelled", reason)
