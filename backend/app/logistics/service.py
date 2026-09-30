"""LogisticsService: the live supply chain world (sections 5.10 to 5.13, 6.3).

Owns the shipments, reservations, stock overlay and persistence. Everything the
API, the voice tools and the insights layer need is exposed as methods that
return plain dicts (`model_dump(mode="json")`), so callers never see internals.
Time comes from a `SimClock`; tests pass a fake clock and drive `tick(now)`.
"""

import logging
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.config import Settings, get_settings
from app.core.exceptions import (
    DriverNotFoundError,
    FacilityNotFoundError,
    ShipmentNotFoundError,
    ShipmentStateError,
    VehicleNotFoundError,
    WarehouseNotFoundError,
)
from app.logistics import analytics, master, planner, roads, scenario, sim
from app.logistics.catalog import line_for, medicines
from app.logistics.clock import IST, SimClock, iso, parse_iso, today_0830_ist
from app.logistics.models import (
    ActionLog,
    Driver,
    PodRecord,
    Shipment,
    Stop,
    TripPlan,
    Vehicle,
)
from app.logistics.store import JsonFileStateStore, LogisticsState, MemoryStateStore, StateStore
from app.logistics.views import (
    DriverRef,
    GanttSegment,
    GanttTrip,
    InboundItem,
    InboundLine,
    NodeRef,
    RecommendationRef,
    ShipmentDetail,
    ShipmentSummary,
    StopView,
    TemperaturePoint,
)
from app.repositories.district_repository import DistrictRepository
from app.services.forecast_service import ForecastService
from app.services.recommendation_service import STOCK_TYPES, RecommendationService, plural

logger = logging.getLogger("swasthyagrid")

ACTIVE_STATUSES = ("approved", "loading", "in_transit", "delayed", "arrived")
MOVING_STATUSES = ("loading", "in_transit", "delayed")
DEFAULT_SEED = 20260926
SAVE_INTERVAL_SECONDS = 5.0  # dirty state is written at most this often
IDLE_SAVE_SECONDS = 30.0  # the clock alone is persisted this often
PLANNER_INTERVAL_SECONDS = 5.0  # queued-shipment retry pass throttle (real seconds)
PLANNER_PASS_CAP = 25  # queued shipments tried per pass, by priority
TICK_WARN_MS = 200.0
ARCHIVE_AFTER = timedelta(hours=24)
AUTO_CANCEL_AFTER = timedelta(hours=3)
AUTO_CANCEL_KINDS = ("routine", "restock")
AUTO_CANCEL_REASON = "No capacity, superseded"
RESET_AFTER_SIM_DAYS = 3
RESET_AFTER_SHIPMENTS = 1500
TERMINAL = ("delivered", "cancelled")
REC_REFRESH_SECONDS = 60.0
PATH_MAX_POINTS = 400
SCHEDULE_START_HOUR = 5
SCHEDULE_END_HOUR = 23


class LogisticsService:
    def __init__(
        self,
        repo: DistrictRepository,
        forecast: ForecastService,
        recs: RecommendationService,
        store: StateStore | None = None,
        *,
        settings: Settings | None = None,
        clock: SimClock | None = None,
        routes: roads.Routes | None = None,
        real_now: Callable[[], datetime] | None = None,
        background_traffic: bool | None = None,
        auto_pod_minutes: int | None = None,
        time_scale: float | None = None,
        scenario_start: datetime | None = None,
    ):
        self.repo = repo
        self.forecast = forecast
        self.recs = recs
        self.settings = settings or get_settings()
        self.store = store or MemoryStateStore()
        self.routes = routes if routes is not None else roads.load_routes()
        self._real_now = real_now or (lambda: datetime.now(UTC))
        self.background_traffic = (
            self.settings.logistics_background_traffic
            if background_traffic is None
            else background_traffic
        )
        self.auto_pod_minutes = (
            self.settings.logistics_auto_pod_minutes if auto_pod_minutes is None else auto_pod_minutes
        )
        self._initial_scale = (
            self.settings.logistics_time_scale if time_scale is None else time_scale
        )
        self._forced_start = scenario_start
        self.clock = clock or SimClock(
            anchor_real=time.time(), anchor_sim=today_0830_ist(), scale=self._initial_scale
        )
        self._lock = recs._lock  # one lock for both services (hooks call back into us)

        self.vehicles: list[Vehicle] = master.vehicles()
        self.drivers: list[Driver] = master.drivers()
        self.vehicle_by_id = {v.id: v for v in self.vehicles}
        self.driver_by_id = {d.id: d for d in self.drivers}
        self.warehouses = {w["id"]: w for w in master.warehouses()}
        self.base_stock = master.base_warehouse_stock()
        self.state = LogisticsState()
        self._emitted: dict[str, set[tuple[str, str]]] = {}
        self._overrides: dict[str, Callable[[Shipment], None]] = {}
        self._last_save = 0.0
        self._last_rec_refresh = 0.0
        self._listeners: list[Callable[[dict], None]] = []
        self._risk_levels: dict[str, str] = {}
        self._risk_version: int | None = None
        self._history = master.load_history()
        self._hist_by: dict[str, dict[str, list[dict]]] = {}
        self.booted = False
        # Appendix E: active set, dirty-flag saves, planner throttle, tick budget
        self._active: dict[str, None] = {}  # insertion-ordered set of non-terminal shipment ids
        self._indexed_count = -1
        self._retired: list[str] = []  # shipments that became terminal since the last event sweep
        self._event_gate: dict[str, tuple[tuple, datetime]] = {}
        self._archive: list[Shipment] = []
        self._archive_by_id: dict[str, Shipment] = {}
        self._dirty = False
        self.planner_interval = PLANNER_INTERVAL_SECONDS
        self._last_planner = float("-inf")
        self._planner_wake = True
        self._tick_ms: deque[float] = deque(maxlen=60)

    # ------------------------------------------------------------------ active set

    def _reindex(self) -> None:
        self._active = {i: None for i, s in self.state.shipments.items() if s.status not in TERMINAL}
        self._indexed_count = len(self.state.shipments)

    def active_shipments(self) -> list[Shipment]:
        """Non-terminal shipments in creation order (delivered and cancelled are excluded)."""
        if self._indexed_count != len(self.state.shipments):
            self._reindex()
        ships = self.state.shipments
        return [ships[i] for i in self._active if i in ships and ships[i].status not in TERMINAL]

    def _retire(self, s: Shipment) -> None:
        """A shipment just became delivered or cancelled: it leaves the active set."""
        self._active.pop(s.id, None)
        self._retired.append(s.id)
        self._dirty = True
        self._planner_wake = True  # a vehicle and a driver may have freed up

    def _queued(self) -> list[Shipment]:
        return [s for s in self.active_shipments() if s.approved_at is not None and s.trip is None]

    def analytics_shipments(self) -> list[Shipment]:
        """Live plus archived shipments (analytics windows reach back further than the live file)."""
        return [*self.state.shipments.values(), *self._archive]

    def metrics_snapshot(self) -> dict:
        with self._lock:
            ms = sorted(self._tick_ms)
            p95 = ms[min(len(ms) - 1, int(0.95 * len(ms)))] if ms else 0.0
            return {
                "tick_ms": {
                    "last": round(self._tick_ms[-1], 2) if ms else 0.0,
                    "p95": round(p95, 2),
                    "samples": len(ms),
                },
                "queued": len(self._queued()),
                "active": len(self.active_shipments()),
                "shipments_live": len(self.state.shipments),
                "shipments_archived": len(self._archive),
            }

    # ------------------------------------------------------------------ boot and persistence

    def boot(self) -> None:
        """Load the persisted world or build the initial scenario (idempotent)."""
        with self._lock:
            if self.booted:
                return
            self.repo.set_stock_overlay(self._overlay_entries)
            self.recs.bind(
                self,
                now_provider=self.now,
                warehouse_stock=self.warehouse_available,
                delivery_provider=self._delivery_entries,
            )
            loaded = self.store.load()
            if loaded is not None and self._too_stale(loaded):
                loaded = None
            if loaded is None:
                start = self._forced_start or today_0830_ist(self._real_now())
                self._fresh_world(start, DEFAULT_SEED, self._initial_scale)
            else:
                self.state = loaded
                scale = float(self.state.scenario.get("time_scale", self._initial_scale))
                self.clock.scale = scale
                last = parse_iso(self.state.clock["last_sim_now"])
                self.clock.reanchor(last)  # the world pauses while the server is down
                self.recs.load_state(
                    {
                        "recommendations": self.state.recommendations,
                        "keys": self.state.rec_keys,
                        "episodes": self.state.rec_episodes,
                        "candidate_keys": self.state.rec_candidate_keys,
                    }
                )
            self._load_archive()
            self._reindex()
            self._seed_emitted(self.now())
            self._risk_changes(self.now())  # baseline, changes are reported from the next tick
            self.booted = True
            self._save(force=True)

    def _too_stale(self, loaded: LogisticsState) -> bool:
        """R6: a saved world that ran days ahead or grew huge is backed up and rebuilt."""
        try:
            start = parse_iso(loaded.scenario["start"])
            last = parse_iso(loaded.clock["last_sim_now"])
        except Exception:
            return False
        drifted = last - start > timedelta(days=RESET_AFTER_SIM_DAYS)
        bloated = len(loaded.shipments) > RESET_AFTER_SHIPMENTS
        if not (drifted or bloated):
            return False
        logger.warning(
            "Logistics state is stale (%d shipments, sim %s past start); backing up and rebuilding",
            len(loaded.shipments),
            last - start,
        )
        backup = getattr(self.store, "backup", None)
        if backup is not None:
            backup()
        return True

    def _load_archive(self) -> None:
        loader = getattr(self.store, "load_archive", None)
        rows = loader() if loader is not None else []
        self._archive = [s for s in rows if s.id not in self.state.shipments]
        self._archive_by_id = {s.id: s for s in self._archive}

    def _fresh_world(self, start: datetime, seed: int, scale: float) -> None:
        self.state = LogisticsState(
            scenario={"seed": seed, "start": iso(start), "time_scale": scale},
            clock={"last_sim_now": iso(start)},
        )
        self.clock.scale = scale
        self.clock.reanchor(start)
        self._emitted = {}
        self._overrides = {}
        self._archive = []
        self._archive_by_id = {}
        self._retired = []
        self._active = {}
        self._indexed_count = 0
        clearer = getattr(self.store, "clear_archive", None)
        if clearer is not None:
            clearer()
        self.recs.load_state({})
        self.repo.invalidate()
        self.recs.refresh(start)  # pending recommendations and their drafts
        scenario.build_initial_scenario(self, start, seed)
        self._lifecycle(start)
        self.recs.refresh(start)

    def _sync_recs(self) -> None:
        export = self.recs.export_state()
        self.state.recommendations = export["recommendations"]
        self.state.rec_keys = export["keys"]
        self.state.rec_episodes = export["episodes"]
        self.state.rec_candidate_keys = export["candidate_keys"]

    def _save(self, force: bool = False) -> None:
        """Persist the world. Forced saves are immediate; ticks save a dirty state at most every
        5 real seconds and an idle one (clock only) every 30 seconds."""
        since = time.monotonic() - self._last_save
        if not force and (since < SAVE_INTERVAL_SECONDS or not (self._dirty or since >= IDLE_SAVE_SECONDS)):
            return
        self._archive_old(self.now())
        self._sync_recs()
        self.state.clock["last_sim_now"] = iso(self.now())
        self.store.save(self.state)
        self._last_save = time.monotonic()
        self._dirty = False

    def _archive_old(self, now: datetime) -> None:
        """R4: terminal shipments older than 24 sim hours leave the live file for the archive."""
        cutoff = now - ARCHIVE_AFTER
        old = [
            s
            for s in self.state.shipments.values()
            if s.status in TERMINAL and self._terminal_at(s) < cutoff
        ]
        if not old:
            return
        appender = getattr(self.store, "append_archive", None)
        if appender is not None:
            appender(old)
        for s in old:
            del self.state.shipments[s.id]
            self._emitted.pop(s.id, None)
            self._event_gate.pop(s.id, None)
            self._archive.append(s)
            self._archive_by_id[s.id] = s
        self._indexed_count = len(self.state.shipments)

    @staticmethod
    def _terminal_at(s: Shipment) -> datetime:
        if s.status == "delivered" and s.pod is not None:
            return s.pod.confirmed_at
        return s.cancelled_at or s.created_at

    def flush(self) -> None:
        with self._lock:
            self._save(force=True)

    # ------------------------------------------------------------------ clock

    def now(self) -> datetime:
        return self.clock.now().replace(microsecond=0)

    def scenario_start(self) -> datetime:
        return parse_iso(self.state.scenario["start"])

    def clock_info(self) -> dict:
        return {
            "sim_now": iso(self.now()),
            "scale": self.clock.scale,
            "scenario_start": iso(self.scenario_start()),
            "background_traffic": self.background_traffic,
            "paused": False,
        }

    def set_time_scale(self, scale: float) -> dict:
        if not 1 <= scale <= 600:
            raise ValueError("scale must be between 1 and 600")
        with self._lock:
            self.clock.rescale(scale)
            self.state.scenario["time_scale"] = scale
            self._save(force=True)
            return self.clock_info()

    def reset(self, seed: int | None = None) -> dict:
        """Rebuild the initial scenario and re-anchor the clock to 08:30 IST today."""
        with self._lock:
            start = today_0830_ist(self._real_now())
            self._fresh_world(start, seed if seed is not None else DEFAULT_SEED, self.clock.scale)
            self._seed_emitted(self.now())
            self._risk_levels = {}
            self._risk_changes(self.now())
            self._save(force=True)
            return {"ok": True, "sim_now": iso(self.now())}

    # ------------------------------------------------------------------ names and places

    def node_name(self, node_id: str) -> str:
        if node_id in self.warehouses:
            return self.warehouses[node_id]["name"]
        try:
            return self.repo.facility(node_id)["name"]
        except FacilityNotFoundError:
            return node_id

    def node_kind(self, node_id: str) -> str:
        return "warehouse" if node_id in self.warehouses else "facility"

    def node_position(self, node_id: str) -> tuple[float, float]:
        if node_id in self.warehouses:
            loc = self.warehouses[node_id]["location"]
            return loc["lat"], loc["lng"]
        f = self.repo.facility(node_id)
        return f["lat"], f["lng"]

    def _names(self) -> dict[str, str]:
        names = {w["id"]: w["name"] for w in self.warehouses.values()}
        names.update({f["id"]: f["name"] for f in self.repo.facilities})
        return names

    # ------------------------------------------------------------------ warehouse stock

    def warehouse_available(self, warehouse_id: str, medicine_name: str) -> int:
        base = self.base_stock.get((warehouse_id, medicine_name))
        units = int(base["units"]) if base else 0
        units += self.state.warehouse_adjust.get(warehouse_id, {}).get(medicine_name, 0)
        units -= self.state.reservations.get(warehouse_id, {}).get(medicine_name, 0)
        return units

    def _adjust(self, table: dict[str, dict[str, int]], wh: str, med: str, delta: int) -> None:
        row = table.setdefault(wh, {})
        row[med] = row.get(med, 0) + delta

    def _reserve(self, s: Shipment) -> None:
        if s.reserved or s.kind == "lateral_transfer":
            return
        for line in s.lines:
            self._adjust(self.state.reservations, s.origin_id, line.medicine_name, line.units)
        s.reserved = True

    def _release(self, s: Shipment) -> None:
        if not s.reserved:
            return
        for line in s.lines:
            self._adjust(self.state.reservations, s.origin_id, line.medicine_name, -line.units)
        s.reserved = False

    def _overlay_entries(self) -> list[dict]:
        return self.state.stock_overlay

    def _delivery_entries(self) -> list[dict]:
        return [e for e in self.state.stock_overlay if e["units"] > 0]

    # ------------------------------------------------------------------ shipments: creation

    def new_shipment_id(self) -> str:
        self.state.counters["shipment_seq"] = self.state.counters.get("shipment_seq", 0) + 1
        return f"SHP-2{self.state.counters['shipment_seq']:05d}"

    def build_shipment(
        self,
        *,
        kind: str,
        district_id: str,
        origin_id: str,
        stops: list[Stop],
        lines: list[tuple[str, int]],
        priority: str,
        created_at: datetime,
        rec_id: str | None = None,
    ) -> Shipment:
        built = [line_for(name, units) for name, units in lines]
        s = Shipment(
            id=self.new_shipment_id(),
            district_id=district_id,
            origin_id=origin_id,
            origin_kind="warehouse",
            stops=stops,
            destination_facility_id=stops[-1].node_id,
            lines=built,
            weight_kg=round(sum(x.weight_kg for x in built), 3),
            pallet_slots=sum(x.pallet_slots for x in built),
            cold_chain=any(x.cold_chain for x in built),
            priority=priority,  # type: ignore[arg-type]
            source_recommendation_id=rec_id,
            kind=kind,  # type: ignore[arg-type]
            status="recommended",
            created_at=created_at,
        )
        self.state.shipments[s.id] = s
        if self._indexed_count == len(self.state.shipments) - 1:
            self._active[s.id] = None
            self._indexed_count += 1
        self._dirty = True
        return s

    def _set_lines(self, s: Shipment, lines: list[tuple[str, int]]) -> None:
        built = [line_for(name, units) for name, units in lines]
        s.lines = built
        s.weight_kg = round(sum(x.weight_kg for x in built), 3)
        s.pallet_slots = sum(x.pallet_slots for x in built)
        s.cold_chain = any(x.cold_chain for x in built)

    def fleet_state(self) -> planner.FleetState:
        maintenance = {
            vid for vid, f in self.state.fleet.items() if f.get("status_override") == "maintenance"
        }
        off = {did for did, c in self.state.crew.items() if c.get("status_override") == "off"}
        return planner.FleetState(
            vehicles=self.vehicles,
            drivers=self.drivers,
            shipments=list(self.state.shipments.values()),
            routes=self.routes,
            warehouse_available=self.warehouse_available,
            warehouse_names={w: v["name"] for w, v in self.warehouses.items()},
            maintenance=maintenance,
            off_duty=off,
        )

    def approve_shipment(
        self, s: Shipment, actor: str, now: datetime, plan: bool = True
    ) -> TripPlan | planner.BlockedReason | None:
        """Approve a draft or new shipment: pick origin, reserve stock and plan the trip."""
        s.approved_at = now
        s.approved_by = actor
        s.status = "approved"
        self._dirty = True
        self._planner_wake = True
        if s.kind != "lateral_transfer":
            s.origin_id = planner.choose_origin(s, self.fleet_state())
        self._reserve(s)
        if not plan:
            return None
        result = planner.assign(s, now, self.fleet_state())
        self._apply_assignment(s, result)
        return result

    @staticmethod
    def _apply_assignment(s: Shipment, result: TripPlan | planner.BlockedReason) -> None:
        if isinstance(result, TripPlan):
            s.trip = result
            s.blocked_reason = None
        else:
            s.trip = None
            s.blocked_reason = result.reason

    def log(self, actor: str, action: str, shipment_id: str | None = None, detail: str | None = None) -> None:
        self.state.actions.append(
            ActionLog(at=self.now(), actor=actor, action=action, shipment_id=shipment_id, detail=detail)
        )
        del self.state.actions[:-500]

    # ------------------------------------------------------------------ recommendation hooks

    def _draft_lines(self, rec: dict) -> list[tuple[str, int]]:
        return [(rec["medicine_name"], int(rec["quantity"]))]

    def create_draft(self, rec: dict) -> None:
        if rec["type"] not in STOCK_TYPES:
            return
        existing = self.state.shipments.get(rec.get("shipment_id") or "")
        if existing is not None and existing.status == "recommended":
            return
        district = rec["district_id"]
        target = rec["target_facility_id"]
        if rec["type"] == "stock_transfer":
            kind = "lateral_transfer"
            origin = master.ddw_for_district(district)
            stops = [
                Stop(
                    node_id=rec["source_id"],
                    node_kind="facility",
                    purpose="pickup",
                    dwell_minutes=sim.PICKUP_DWELL_MINUTES,
                ),
                Stop(node_id=target, node_kind="facility", purpose="dropoff"),
            ]
        else:
            kind = "replenishment"
            origin = rec["source_id"]
            stops = [Stop(node_id=target, node_kind="facility", purpose="dropoff")]
        s = self.build_shipment(
            kind=kind,
            district_id=district,
            origin_id=origin,
            stops=stops,
            lines=self._draft_lines(rec),
            priority=rec["priority"],
            created_at=self.now(),
            rec_id=rec["id"],
        )
        rec["shipment_id"] = s.id

    def update_draft(self, rec: dict) -> None:
        s = self.state.shipments.get(rec.get("shipment_id") or "")
        if s is None or s.status != "recommended":
            return
        self._set_lines(s, self._draft_lines(rec))
        s.priority = rec["priority"]
        if s.kind == "replenishment":
            s.origin_id = rec["source_id"]

    def cancel_draft(self, rec: dict, reason: str) -> None:
        s = self.state.shipments.get(rec.get("shipment_id") or "")
        if s is None or s.status != "recommended":
            return
        s.status = "cancelled"
        s.cancelled_at = self.now()
        s.cancel_reason = reason
        self._retire(s)

    def approve_draft(self, rec: dict, actor: str, quantity: int | None) -> str | None:
        s = self.state.shipments.get(rec.get("shipment_id") or "")
        if s is None or s.status != "recommended":
            self.create_draft(rec)
            s = self.state.shipments.get(rec.get("shipment_id") or "")
        if s is None:
            return None
        if s.status != "recommended":
            return s.id
        if quantity:
            self._set_lines(s, [(rec["medicine_name"], quantity)])
        now = self.now()
        override = self._overrides.pop(rec["id"], None)
        if override is not None:
            self.approve_shipment(s, actor, now, plan=False)
            override(s)
        else:
            self.approve_shipment(s, actor, now)
        self.log(actor, "approve", s.id, rec["id"])
        self._save(force=True)
        return s.id

    # ------------------------------------------------------------------ lifecycle

    def derived_status(self, s: Shipment, now: datetime | None = None) -> str:
        return sim.derive_status(s, now or self.now())

    def _vehicle_reg(self, vehicle_id: str | None) -> str | None:
        v = self.vehicle_by_id.get(vehicle_id or "")
        return v.registration if v else None

    def _driver_name(self, driver_id: str | None) -> str | None:
        d = self.driver_by_id.get(driver_id or "")
        return d.name if d else None

    def _event_ctx(self, s: Shipment) -> sim.EventContext:
        return sim.EventContext(
            names=self._names(),
            vehicle_registration=self._vehicle_reg(s.trip.vehicle_id) if s.trip else None,
            driver_name=self._driver_name(s.trip.driver_id) if s.trip else None,
        )

    def _on_departed(self, s: Shipment, now: datetime) -> None:
        if s.stock_dispatched:
            return
        s.stock_dispatched = True
        if s.reserved:
            self._release(s)
            for line in s.lines:
                self._adjust(self.state.warehouse_adjust, s.origin_id, line.medicine_name, -line.units)
        if s.kind == "lateral_transfer":
            pickup = next((st for st in s.stops if st.purpose == "pickup"), None)
            if pickup is not None:
                for line in s.lines:
                    self.state.stock_overlay.append(
                        {
                            "facility_id": pickup.node_id,
                            "medicine_name": line.medicine_name,
                            "units": -line.units,
                            "shipment_id": s.id,
                            "at": iso(now),
                        }
                    )
                self.repo.invalidate()
        if s.source_recommendation_id:
            self.recs.mark_dispatched(s.source_recommendation_id)

    def _record_pod(self, s: Shipment, pod: PodRecord, now: datetime) -> None:
        s.pod = pod
        s.status = "delivered"
        self._retire(s)
        self._record_km(s)
        if s.kind == "restock":
            for item in pod.received:
                self._adjust(
                    self.state.warehouse_adjust,
                    s.destination_facility_id,
                    item["medicine_name"],
                    int(item["units"]),
                )
        else:
            for item in pod.received:
                if int(item["units"]) > 0:
                    self.state.stock_overlay.append(
                        {
                            "facility_id": s.destination_facility_id,
                            "medicine_name": item["medicine_name"],
                            "units": int(item["units"]),
                            "shipment_id": s.id,
                            "at": iso(pod.confirmed_at),
                        }
                    )
        if s.source_recommendation_id:
            self.recs.mark_fulfilled(s.source_recommendation_id)
        if self.repo.live_source == "seed":
            self.repo.invalidate()
            self._refresh_recs(now)

    def _record_km(self, s: Shipment) -> None:
        if s.km_recorded or s.trip is None:
            return
        s.km_recorded = True
        row = self.state.fleet.setdefault(s.trip.vehicle_id, {})
        vehicle = self.vehicle_by_id[s.trip.vehicle_id]
        row["odometer_km"] = row.get("odometer_km", vehicle.odometer_km) + s.trip.distance_km
        row["km_since_service"] = row.get("km_since_service", vehicle.km_since_service) + s.trip.distance_km

    def _auto_cancel(self, s: Shipment, now: datetime) -> None:
        """R3: a routine or restock load that never got a trip is superseded, not kept forever."""
        s.status = "cancelled"
        s.cancelled_at = now
        s.cancel_reason = AUTO_CANCEL_REASON
        self._retire(s)
        self._release(s)
        self.log("system", "cancel", s.id, AUTO_CANCEL_REASON)

    def _lifecycle(self, now: datetime) -> None:
        """Departures, arrivals and automatic proof of delivery for routine and restock loads."""
        for s in self.active_shipments():
            if s.status in TERMINAL:
                continue
            derived = sim.derive_status(s, now)
            if (
                s.trip is None
                and s.kind in AUTO_CANCEL_KINDS
                and s.approved_at is not None
                and now - s.approved_at >= AUTO_CANCEL_AFTER
            ):
                self._auto_cancel(s, now)
                continue
            if (
                s.trip is not None
                and not s.stock_dispatched
                and derived != "recommended"
                and now >= sim.first_departure(s.trip)
            ):
                self._on_departed(s, now)
            if derived == "arrived" and s.trip is not None:
                self._record_km(s)
                arrived_at = sim.trip_end(s.trip)
                minutes = self.auto_pod_minutes
                if s.kind in ("routine", "restock") and minutes > 0:
                    due = arrived_at + timedelta(minutes=minutes)
                    if now >= due:
                        pod = PodRecord(
                            pod_id=f"auto-{s.id}",
                            confirmed_at=due,
                            confirmed_by="system (auto)",
                            received=[
                                {"medicine_name": x.medicine_name, "units": x.units} for x in s.lines
                            ],
                            condition="ok",
                        )
                        self._record_pod(s, pod, now)
                        continue
            if s.status not in TERMINAL:
                if s.status != derived:
                    self._dirty = True
                s.status = derived  # type: ignore[assignment]

    # ------------------------------------------------------------------ tick

    def _seed_emitted(self, now: datetime) -> None:
        self._emitted = {}
        self._event_gate = {}
        self._retired = []
        for s in self.active_shipments():
            self._emitted[s.id] = {(e.type, iso(e.at)) for e in sim.derive_events(s, now)}

    def _collect_events(self, now: datetime) -> list[dict]:
        out: list[dict] = []
        retired, self._retired = self._retired, []
        ships = self.state.shipments
        sweep = [*self.active_shipments(), *(ships[i] for i in retired if i in ships)]
        far = datetime.max.replace(tzinfo=UTC)
        for s in sweep:
            sig = _event_signature(s)
            gate = self._event_gate.get(s.id)
            if gate is not None and gate[0] == sig and now < gate[1]:
                continue  # nothing about this shipment changed and no event is due yet
            seen = self._emitted.setdefault(s.id, set())
            events = sim.derive_events(s, now)
            upcoming = [e.at for e in sim.derive_events(s, far) if e.at > now]
            self._event_gate[s.id] = (sig, min(upcoming, default=far))
            fresh = [e for e in events if (e.type, iso(e.at)) not in seen]
            if not fresh:
                continue
            located = {
                (e.type, iso(e.at)): e for e in sim.derive_events(s, now, self.routes, self._event_ctx(s))
            }
            status = sim.derive_status(s, now)
            for e in fresh:
                key = (e.type, iso(e.at))
                seen.add(key)
                out.append(
                    {
                        "event": located[key].model_dump(mode="json"),
                        "status": status,
                        "district_id": s.district_id,
                        "facility_id": s.destination_facility_id,
                    }
                )
        for i in retired:
            self._emitted.pop(i, None)  # terminal shipments emit nothing further
            self._event_gate.pop(i, None)
        out.sort(key=lambda x: x["event"]["at"])
        return out

    def _refresh_recs(self, now: datetime) -> dict:
        changes = self.recs.refresh(now)
        self._last_rec_refresh = time.monotonic()
        return changes

    def tick(self, now: datetime | None = None) -> dict:
        """Advance the world to `now`: traffic, departures, POD, queued planning, refresh."""
        started = time.perf_counter()
        with self._lock:
            now = now or self.now()
            if self.background_traffic:
                scenario.background_step(self, now)
            self._lifecycle(now)
            self._maybe_run_planner(now)
            changes = None
            stale = time.monotonic() - self._last_rec_refresh >= REC_REFRESH_SECONDS
            if stale or self.recs._version_seen != self.repo.version:
                changes = self._refresh_recs(now)
                if not any(changes.values()):
                    changes = None
            events = self._collect_events(now)
            risk = self._risk_changes(now)
            if events or changes or risk:
                self._dirty = True
            self.state.clock["last_sim_now"] = iso(now)
            self._save()
            result = {
                "sim_now": iso(now),
                "events": events,
                "recommendations": changes,
                "risk": risk,
            }
            if self._listeners:
                result["positions"] = self._positions_with_district(now)
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            self._tick_ms.append(elapsed_ms)
        if elapsed_ms > TICK_WARN_MS:
            logger.warning(
                "logistics tick took %.0f ms (active %d, live %d)",
                elapsed_ms,
                len(self._active),
                len(self.state.shipments),
            )
        for listener in list(self._listeners):
            try:
                listener(result)
            except Exception:
                logger.exception("tick listener failed")
        return result

    def add_tick_listener(self, listener: Callable[[dict], None]) -> None:
        """Register a callback that receives every tick result (used by the SSE hub)."""
        self._listeners.append(listener)

    def _risk_reason(self, facility_id: str, now: datetime) -> str:
        cat = medicines()
        pods = [
            s.pod
            for s in self.state.shipments.values()
            if s.destination_facility_id == facility_id and s.pod is not None
        ]
        latest = max(pods, key=lambda p: p.confirmed_at, default=None)
        if latest is not None and now - latest.confirmed_at <= timedelta(hours=3):
            got = [r for r in latest.received if int(r["units"]) > 0]
            if got:
                r = got[0]
                unit = cat.get(r["medicine_name"], {}).get("unit", "unit")
                n = int(r["units"])
                return f"{_short_med(r['medicine_name'])} delivered: {n} {plural(unit, n)}"
        for e in reversed(self.state.stock_overlay):
            if e["facility_id"] == facility_id and e["units"] < 0:
                unit = cat.get(e["medicine_name"], {}).get("unit", "unit")
                n = -int(e["units"])
                return f"{_short_med(e['medicine_name'])} sent out: {n} {plural(unit, n)}"
        return "Stock and forecast update"

    def _risk_changes(self, now: datetime) -> list[dict]:
        """Facilities whose risk level differs from the previous evaluation (6.4 `risk`)."""
        version = self.repo.version
        if version == self._risk_version and self._risk_levels:
            return []
        self._risk_version = version
        levels = {f["id"]: self.forecast.facility_risk_level(f["id"]) for f in self.repo.facilities}
        previous = self._risk_levels
        self._risk_levels = levels
        if not previous:
            return []
        out = []
        for f in self.repo.facilities:
            old, new = previous.get(f["id"]), levels[f["id"]]
            if old is not None and old != new:
                out.append(
                    {
                        "facility_id": f["id"],
                        "facility_name": f["name"],
                        "district_id": f["district_id"],
                        "from": old,
                        "to": new,
                        "reason": self._risk_reason(f["id"], now),
                    }
                )
        return out

    def _positions_with_district(self, now: datetime) -> list[dict]:
        out = []
        for s in self.active_shipments():
            if s.trip is None or sim.derive_status(s, now) not in MOVING_STATUSES:
                continue
            pos = sim.position(s, now, self.routes)
            if pos is not None:
                out.append({"position": pos.model_dump(mode="json"), "district_id": s.district_id})
        return out

    def run_planner(self, now: datetime | None = None) -> dict:
        """Retry queued shipments in priority order (5.10 step 6)."""
        with self._lock:
            now = now or self.now()
            queued = planner.queue_order(self._queued())[:PLANNER_PASS_CAP]
            assigned: list[str] = []
            blocked: list[dict] = []
            if queued:
                fleet = self.fleet_state()  # one index per pass; assignments extend it
                for s in queued:
                    result = planner.assign(s, now, fleet)
                    self._apply_assignment(s, result)
                    if isinstance(result, TripPlan):
                        fleet.record(s)
                        assigned.append(s.id)
                        self.log("system", "assign", s.id, result.vehicle_id)
                    else:
                        blocked.append({"shipment_id": s.id, "reason": result.reason})
            if assigned:
                self._dirty = True
                self._lifecycle(now)
            return {"assigned": assigned, "still_blocked": blocked}

    def _maybe_run_planner(self, now: datetime) -> None:
        """Tick-side planner: at most one pass per `planner_interval` real seconds, or at once when
        a shipment was approved or a vehicle freed since the last pass."""
        t = time.monotonic()
        if not self._planner_wake and t - self._last_planner < self.planner_interval:
            return
        self._planner_wake = False
        self._last_planner = t
        self.run_planner(now)

    # ------------------------------------------------------------------ mutations

    def get_state_shipment(self, shipment_id: str) -> Shipment:
        s = self.state.shipments.get(shipment_id) or self._archive_by_id.get(shipment_id)
        if s is None:
            raise ShipmentNotFoundError(shipment_id)
        return s

    def cancel(self, shipment_id: str, reason: str, actor: str | None = None) -> dict:
        with self._lock:
            s = self.get_state_shipment(shipment_id)
            now = self.now()
            derived = sim.derive_status(s, now)
            if derived in ("arrived", "delivered", "cancelled"):
                raise ShipmentStateError(f"Shipment {s.id} is {derived} and cannot be cancelled")
            actor = actor or "Officer"
            if derived == "recommended" and s.source_recommendation_id:
                rec = self.recs.get(s.source_recommendation_id)
                if rec["status"] == "pending":
                    self.recs.resolve(rec["id"], "rejected", actor=actor, note=reason)
                    self.log(actor, "cancel", s.id, reason)
                    self._save(force=True)
                    return self.detail(s.id)
            s.status = "cancelled"
            s.cancelled_at = now
            s.cancel_reason = reason
            self._retire(s)
            if s.reserved:
                self._release(s)
            elif s.stock_dispatched and s.kind != "lateral_transfer":
                for line in s.lines:  # the load returns to the warehouse
                    self._adjust(self.state.warehouse_adjust, s.origin_id, line.medicine_name, line.units)
            self._record_km(s)
            if s.source_recommendation_id:
                self.recs.mark_cancelled(s.source_recommendation_id, reason)
            self.log(actor, "cancel", s.id, reason)
            self._save(force=True)
            return self.detail(s.id)

    def confirm_pod(
        self,
        shipment_id: str,
        pod_id: str,
        facility_id: str,
        confirmed_by: str,
        received: list[dict],
        condition: str = "ok",
        note: str | None = None,
    ) -> dict:
        """Proof of delivery from the receiving facility (idempotent on the shipment)."""
        with self._lock:
            s = self.get_state_shipment(shipment_id)
            applied_by = "backend_overlay" if self.repo.live_source == "seed" else "crm"
            if s.pod is not None:
                return {
                    "shipment": self.detail(s.id),
                    "already_confirmed": True,
                    "stock_applied_by": applied_by,
                }
            now = self.now()
            derived = sim.derive_status(s, now)
            if derived != "arrived":
                raise ShipmentStateError(f"Shipment {s.id} is {derived}, not arrived")
            if facility_id != s.destination_facility_id:
                raise ShipmentStateError(f"Shipment {s.id} is not addressed to {facility_id}")
            pod = PodRecord(
                pod_id=pod_id,
                confirmed_at=now,
                confirmed_by=confirmed_by,
                received=[
                    {"medicine_name": r["medicine_name"], "units": int(r["units"])} for r in received
                ],
                condition=condition,  # type: ignore[arg-type]
                note=note,
            )
            self._record_pod(s, pod, now)
            self.log(confirmed_by, "pod", s.id, condition)
            self._save(force=True)
            return {"shipment": self.detail(s.id), "already_confirmed": False, "stock_applied_by": applied_by}

    def stock_applied(self, shipment_id: str, pod_id: str) -> dict:
        """The CRM committed the stock increment: re-read the data and refresh recommendations."""
        with self._lock:
            s = self.get_state_shipment(shipment_id)
            if s.pod is None:
                raise ShipmentStateError(f"Shipment {s.id} has no proof of delivery yet")
            self.repo.invalidate()
            self._refresh_recs(self.now())
            self._save(force=True)
            return {"ok": True}

    # ------------------------------------------------------------------ views: shipments

    def _vehicle_ref(self, s: Shipment) -> dict | None:
        if s.trip is None:
            return None
        v = self.vehicle_by_id[s.trip.vehicle_id]
        return {"id": v.id, "registration": v.registration, "class": v.vehicle_class}

    def _progress(self, s: Shipment, now: datetime, status: str) -> float:
        if status in ("arrived", "delivered"):
            return 1.0
        if s.trip is None or status in ("recommended", "approved", "cancelled"):
            return 0.0
        pos = sim.position(s, now, self.routes)
        return pos.progress if pos else 0.0

    def summary_model(self, s: Shipment, now: datetime | None = None) -> ShipmentSummary:
        now = now or self.now()
        status = sim.derive_status(s, now)
        trip = s.trip
        driver = self.driver_by_id.get(trip.driver_id) if trip else None
        return ShipmentSummary(
            id=s.id,
            status=status,
            priority=s.priority,
            kind=s.kind,
            district_id=s.district_id,
            origin=NodeRef(id=s.origin_id, name=self.node_name(s.origin_id), kind="warehouse"),
            destination=NodeRef(id=s.destination_facility_id, name=self.node_name(s.destination_facility_id)),
            lines_summary=", ".join(f"{_short_med(x.medicine_name)} {x.units}" for x in s.lines),
            weight_kg=s.weight_kg,
            pallet_slots=s.pallet_slots,
            cold_chain=s.cold_chain,
            created_at=s.created_at,
            planned_start=trip.planned_start if trip else None,
            planned_arrival=trip.planned_arrival if trip else None,
            eta=trip.projected_arrival if trip else None,
            delay_minutes=sim.delay_minutes(s),
            progress=self._progress(s, now, status),
            vehicle=self._vehicle_ref(s),
            driver=DriverRef(id=driver.id, name=driver.name) if driver else None,
            source_recommendation_id=s.source_recommendation_id,
            blocked_reason=s.blocked_reason,
        )

    def summary(self, s: Shipment, now: datetime | None = None) -> dict:
        return self.summary_model(s, now).model_dump(mode="json")

    def _path(self, s: Shipment) -> list[list[float]]:
        if s.trip is None:
            return []
        keys: list[str] = []
        for seg in s.trip.segments:
            if seg.kind == "drive" and seg.route_key and (not keys or keys[-1] != seg.route_key):
                keys.append(seg.route_key)
        points: list[list[float]] = []
        for key in keys:
            coords, _ = roads.decoded(self.routes[key]["polyline"])
            points.extend([round(lat, 5), round(lng, 5)] for lat, lng in coords)
        if len(points) > PATH_MAX_POINTS:
            step = (len(points) - 1) / (PATH_MAX_POINTS - 1)
            points = [points[round(i * step)] for i in range(PATH_MAX_POINTS)]
        return points

    def _temperature(self, s: Shipment, now: datetime) -> list[TemperaturePoint]:
        if not s.cold_chain or s.trip is None:
            return []
        end = min(now, sim.trip_end(s.trip))
        begin = max(s.trip.planned_start, end - timedelta(minutes=60))
        out = []
        t = begin
        while t <= end:
            temp = sim.temperature_at(s, t)
            if temp is not None:
                out.append(TemperaturePoint(at=t, temp_c=temp))
            t += timedelta(minutes=2)
        return out

    def detail_model(self, s: Shipment, now: datetime | None = None) -> ShipmentDetail:
        now = now or self.now()
        base = self.summary_model(s, now)
        path = self._path(s)
        stops = []
        for st in s.stops:
            lat, lng = self.node_position(st.node_id)
            stops.append(
                StopView(
                    node_id=st.node_id,
                    node_kind=st.node_kind,
                    name=self.node_name(st.node_id),
                    purpose=st.purpose,
                    lat=lat,
                    lng=lng,
                )
            )
        position = sim.position(s, now, self.routes) if s.trip else None
        travelled = round(base.progress * (len(path) - 1)) if path else 0
        rec = None
        if s.source_recommendation_id:
            try:
                r = self.recs.get(s.source_recommendation_id)
                rec = RecommendationRef(
                    id=r["id"],
                    subject=r["subject"],
                    priority=r["priority"],
                    confidence=r["confidence"],
                    reasons=r["reasons"],
                )
            except Exception:
                rec = None
        events = sim.derive_events(s, now, self.routes, self._event_ctx(s))
        return ShipmentDetail(
            **base.model_dump(),
            lines=s.lines,
            stops=stops,
            segments=s.trip.segments if s.trip else [],
            path=path,
            travelled_index=travelled,
            position=position,
            events=events,
            pod=s.pod,
            recommendation=rec,
            temperature=self._temperature(s, now),
        )

    def detail(self, shipment_id: str) -> dict:
        with self._lock:
            s = self.get_state_shipment(shipment_id)
            return self.detail_model(s).model_dump(mode="json")

    def get_shipment(self, shipment_id: str) -> dict:
        return self.detail(shipment_id)

    def query_shipments(
        self,
        district_id: str | None = None,
        statuses: list[str] | None = None,
        priority: str | None = None,
        kind: str | None = None,
        facility_id: str | None = None,
        q: str | None = None,
        sort: str = "eta",
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        with self._lock:
            now = self.now()
            rows: list[ShipmentSummary] = []
            needle = q.lower() if q else None
            for s in self.state.shipments.values():
                if district_id and s.district_id != district_id:
                    continue
                if priority and s.priority != priority:
                    continue
                if kind and s.kind != kind:
                    continue
                if facility_id and facility_id not in {s.destination_facility_id, *(x.node_id for x in s.stops)}:
                    continue
                m = self.summary_model(s, now)
                if statuses and m.status not in statuses:
                    continue
                haystack = f"{m.id} {m.origin.name} {m.destination.name} {m.lines_summary}".lower()
                if needle and needle not in haystack:
                    continue
                rows.append(m)
            rank = {"critical": 0, "high": 1, "normal": 2}
            far = datetime.max.replace(tzinfo=UTC)
            if sort == "created_at":
                rows.sort(key=lambda m: (m.created_at, m.id), reverse=True)
            elif sort == "priority":
                rows.sort(key=lambda m: (rank[m.priority], m.created_at, m.id))
            else:
                rows.sort(key=lambda m: (m.eta or far, m.id))
            total = len(rows)
            page = rows[offset : offset + limit]
            return {"items": [m.model_dump(mode="json") for m in page], "total": total}

    def list_shipments(
        self,
        district_id: str | None = None,
        facility_id: str | None = None,
        statuses: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict]:
        return self.query_shipments(
            district_id=district_id, facility_id=facility_id, statuses=statuses, limit=limit
        )["items"]

    def latest_active_for_facility(self, facility_id: str) -> dict | None:
        with self._lock:
            now = self.now()
            best: ShipmentSummary | None = None
            for s in self.active_shipments():
                if s.destination_facility_id != facility_id:
                    continue
                m = self.summary_model(s, now)
                if m.status not in ACTIVE_STATUSES:
                    continue
                if best is None or (m.created_at, m.id) > (best.created_at, best.id):
                    best = m
            return best.model_dump(mode="json") if best else None

    def facility_inbound(self, facility_id: str) -> list[dict]:
        with self._lock:
            now = self.now()
            cat = medicines()
            active: list[tuple[Any, ShipmentSummary, Shipment]] = []
            delivered: list[tuple[datetime, ShipmentSummary, Shipment]] = []
            far = datetime.max.replace(tzinfo=UTC)
            for s in self.state.shipments.values():
                if s.destination_facility_id != facility_id:
                    continue
                m = self.summary_model(s, now)
                if m.status in ACTIVE_STATUSES:
                    active.append((m.eta or far, m, s))
                elif m.status == "delivered" and s.pod:
                    delivered.append((s.pod.confirmed_at, m, s))
            active.sort(key=lambda x: (x[0], x[1].id))
            delivered.sort(key=lambda x: x[0], reverse=True)
            out = []
            for _, m, s in [*active, *delivered[:5]]:
                lines = [
                    InboundLine(
                        medicine_name=x.medicine_name,
                        units=x.units,
                        unit=cat[x.medicine_name]["unit"],
                        cold_chain=x.cold_chain,
                        base_daily_consumption=cat[x.medicine_name]["base_daily_consumption"],
                    )
                    for x in s.lines
                ]
                out.append(InboundItem(**m.model_dump(), lines=lines).model_dump(mode="json"))
            return out

    def positions(self, district_id: str | None = None) -> dict:
        with self._lock:
            now = self.now()
            items = []
            for s in self.active_shipments():
                if district_id and s.district_id != district_id:
                    continue
                if sim.derive_status(s, now) not in MOVING_STATUSES:
                    continue
                pos = sim.position(s, now, self.routes)
                if pos is not None:
                    items.append(pos.model_dump(mode="json"))
            return {"sim_now": iso(now), "items": items}

    # ------------------------------------------------------------------ views: fleet

    def _trips_for_vehicle(self, vehicle_id: str) -> list[Shipment]:
        return [
            s
            for s in self.state.shipments.values()
            if s.trip is not None and s.trip.vehicle_id == vehicle_id and s.status != "cancelled"
        ]

    def vehicle_live_status(self, v: Vehicle, now: datetime) -> tuple[str, str | None]:
        override = self.state.fleet.get(v.id, {}).get("status_override")
        if v.status == "maintenance" or override == "maintenance":
            return "maintenance", None
        upcoming: Shipment | None = None
        returning: Shipment | None = None
        for s in self._trips_for_vehicle(v.id):
            status = sim.derive_status(s, now)
            if status in MOVING_STATUSES:
                return status, s.id
            if (
                status == "approved"
                and s.trip
                and s.trip.planned_start > now
                and (upcoming is None or s.trip.planned_start < upcoming.trip.planned_start)  # type: ignore[union-attr]
            ):
                upcoming = s
            if status in ("arrived", "delivered") and s.trip:
                end = sim.trip_end(s.trip)
                if end <= now < end + planner.RETURN_BUFFER:
                    returning = s
        if upcoming is not None:
            return "scheduled", upcoming.id
        if returning is not None:
            return "returning", returning.id
        return "available", None

    def _history_for(self, field: str, ids: set[str]) -> list[dict]:
        index = self._hist_by.get(field)
        if index is None:
            index = {}
            for row in self._history:
                key = row.get(field)
                if key:
                    index.setdefault(key, []).append(row)
            self._hist_by[field] = index
        return [row for i in ids for row in index.get(i, [])]

    def _utilisation(self, vehicles: list[Vehicle], now: datetime) -> dict[str, float]:
        rows = analytics.vehicle_utilisation(
            None,
            now,
            self._history_for("vehicle_id", {v.id for v in vehicles}),
            self.analytics_shipments(),
            vehicles,
        )
        return {r["vehicle_id"]: r["utilisation_7d"] for r in rows}

    def vehicle_summary(self, v: Vehicle, now: datetime, util: dict[str, float] | None = None) -> dict:
        if util is None:
            util = self._utilisation([v], now)
        status, shipment_id = self.vehicle_live_status(v, now)
        position = None
        if status in MOVING_STATUSES and shipment_id:
            pos = sim.position(self.state.shipments[shipment_id], now, self.routes)
            position = pos.model_dump(mode="json") if pos else None
        row = self.state.fleet.get(v.id, {})
        km_since = row.get("km_since_service", v.km_since_service)
        return {
            "id": v.id,
            "registration": v.registration,
            "class": v.vehicle_class,
            "label": v.label,
            "capacity_kg": v.capacity_kg,
            "pallet_slots": v.pallet_slots,
            "cold_chain": v.cold_chain,
            "home_warehouse_id": v.home_warehouse_id,
            "district_id": v.district_id,
            "live_status": status,
            "current_shipment_id": shipment_id,
            "position": position,
            "utilisation_7d": util.get(v.id, 0.0),
            "km_since_service": km_since,
            "service_due": km_since >= v.service_interval_km,
            "fuel_pct": v.fuel_pct,
        }

    def vehicles_list(self, district_id: str | None = None, status: str | None = None) -> dict:
        with self._lock:
            now = self.now()
            fleet = [v for v in self.vehicles if not district_id or v.district_id == district_id]
            util = self._utilisation(fleet, now)
            items = [self.vehicle_summary(v, now, util) for v in fleet]
            if status:
                items = [i for i in items if i["live_status"] == status]
            return {"items": items}

    def fleet_status(self, district_id: str | None = None) -> dict:
        """Compact fleet picture for the voice tool `get_fleet_status`."""
        with self._lock:
            now = self.now()
            counts: dict[str, int] = {}
            for v in self.vehicles:
                if district_id and v.district_id != district_id:
                    continue
                status, _ = self.vehicle_live_status(v, now)
                counts[status] = counts.get(status, 0) + 1
            on_shift = 0
            for d in self.drivers:
                if district_id and self.warehouses[d.home_warehouse_id]["district_id"] != district_id:
                    continue
                if self.driver_live_status(d, now)[0] != "off_shift":
                    on_shift += 1
            queued = [
                {"shipment_id": s.id, "reason": s.blocked_reason or "Waiting for a vehicle and driver"}
                for s in self._queued()
                if not district_id or s.district_id == district_id
            ]
            return {"vehicles_by_status": counts, "drivers_on_shift": on_shift, "queued": queued}

    def get_vehicle(self, vehicle_id: str) -> Vehicle:
        v = self.vehicle_by_id.get(vehicle_id)
        if v is None:
            raise VehicleNotFoundError(vehicle_id)
        return v

    def _cargo(self, s: Shipment | None, capacity_slots: int, state: str) -> dict:
        slots: list[dict] = []
        used_kg = 0.0
        if s is not None:
            for line in s.lines:
                per_slot = round(line.weight_kg / line.pallet_slots, 3) if line.pallet_slots else 0.0
                for _ in range(line.pallet_slots):
                    if len(slots) >= capacity_slots:
                        break
                    slots.append(
                        {
                            "index": len(slots),
                            "state": state,
                            "medicine_name": line.medicine_name,
                            "shipment_id": s.id,
                            "cold_chain": line.cold_chain,
                            "weight_kg": per_slot,
                        }
                    )
                    used_kg += per_slot
        used = len(slots)
        while len(slots) < capacity_slots:
            slots.append(
                {"index": len(slots), "state": "empty", "medicine_name": None, "shipment_id": None,
                 "cold_chain": False, "weight_kg": None}
            )
        return {"slots": slots, "used_kg": round(used_kg, 3), "used_slots": used}

    def vehicle_detail(self, vehicle_id: str) -> dict:
        with self._lock:
            v = self.get_vehicle(vehicle_id)
            now = self.now()
            summary = self.vehicle_summary(v, now)
            current = self.state.shipments.get(summary["current_shipment_id"] or "")
            state = "loaded" if summary["live_status"] in MOVING_STATUSES else "reserved"
            cargo = self._cargo(current, v.pallet_slots, state)
            trips = self._day_trips(lambda s: s.trip is not None and s.trip.vehicle_id == vehicle_id, now)
            week = now - timedelta(days=7)
            trips_7d = sum(
                1
                for r in self._history_for("vehicle_id", {vehicle_id})
                if r["status"] != "cancelled" and r.get("departed_at") and parse_iso(r["departed_at"]) >= week
            )
            trips_7d += sum(
                1
                for s in self._trips_for_vehicle(vehicle_id)
                if s.trip and week <= s.trip.planned_start <= now
            )
            row = self.state.fleet.get(vehicle_id, {})
            return {
                **summary,
                "cargo": cargo,
                "schedule": self._gantt(trips, now),
                "trips_7d": trips_7d,
                "odometer_km": round(row.get("odometer_km", v.odometer_km), 1),
            }

    def _day_trips(self, match: Callable[[Shipment], bool], now: datetime) -> list[Shipment]:
        start, end = self._day_window(now)
        trips = [
            s
            for s in self.state.shipments.values()
            if s.status != "cancelled"
            and match(s)
            and s.trip is not None
            and s.trip.planned_start < end
            and sim.trip_end(s.trip) > start
        ]
        trips.sort(key=lambda s: s.trip.planned_start)  # type: ignore[union-attr]
        return trips

    @staticmethod
    def _day_window(now: datetime) -> tuple[datetime, datetime]:
        day = now.astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0)
        return (
            (day + timedelta(hours=SCHEDULE_START_HOUR)).astimezone(UTC),
            (day + timedelta(hours=SCHEDULE_END_HOUR)).astimezone(UTC),
        )

    def driver_live_status(self, d: Driver, now: datetime) -> tuple[str, str | None, str | None]:
        override = self.state.crew.get(d.id, {}).get("status_override")
        if override == "off":
            return "off_shift", None, None
        scheduled: Shipment | None = None
        resting = False
        for s in self.state.shipments.values():
            if s.trip is None or s.trip.driver_id != d.id or s.status == "cancelled":
                continue
            status = sim.derive_status(s, now)
            if status in ("in_transit", "delayed"):
                return "driving", s.id, s.trip.vehicle_id
            if status == "loading":
                return "assigned", s.id, s.trip.vehicle_id
            if status == "approved" and s.trip.planned_start > now:
                scheduled = scheduled or s
            end = sim.trip_end(s.trip)
            if status in ("arrived", "delivered") and end <= now < end + planner.RETURN_BUFFER:
                resting = True
        if scheduled is not None and scheduled.trip is not None:
            return "assigned", scheduled.id, scheduled.trip.vehicle_id
        if resting:
            return "resting", None, None
        if planner.in_shift(d, now):
            return "available", None, None
        return "off_shift", None, None

    def driver_summary(self, d: Driver, now: datetime) -> dict:
        status, shipment_id, vehicle_id = self.driver_live_status(d, now)
        hours = planner.drive_hours_today(d.id, self.state.shipments.values(), now)
        stats = analytics.driver_stats(
            d.id, now, self._history_for("driver_id", {d.id}), self.analytics_shipments(), d.rating
        )
        return {
            "id": d.id,
            "name": d.name,
            "home_warehouse_id": d.home_warehouse_id,
            "district_id": self.warehouses[d.home_warehouse_id]["district_id"],
            "shift": d.shift,
            "live_status": status,
            "rating": d.rating,
            "deliveries_30d": stats["deliveries_30d"],
            "on_time_rate_30d": stats["on_time_rate_30d"],
            "hours_today": round(hours, 2),
            "current_shipment_id": shipment_id,
            "vehicle_id": vehicle_id,
        }

    def drivers_list(self, district_id: str | None = None, status: str | None = None) -> dict:
        with self._lock:
            now = self.now()
            items = [
                self.driver_summary(d, now)
                for d in self.drivers
                if not district_id or self.warehouses[d.home_warehouse_id]["district_id"] == district_id
            ]
            if status:
                items = [i for i in items if i["live_status"] == status]
            return {"items": items}

    def driver_detail(self, driver_id: str) -> dict:
        with self._lock:
            d = self.driver_by_id.get(driver_id)
            if d is None:
                raise DriverNotFoundError(driver_id)
            now = self.now()
            trips = self._day_trips(lambda s: s.trip is not None and s.trip.driver_id == driver_id, now)
            mine = [s for s in self.state.shipments.values() if s.trip and s.trip.driver_id == driver_id]
            mine.sort(key=lambda s: (s.trip.planned_start, s.id), reverse=True)  # type: ignore[union-attr]
            return {
                **self.driver_summary(d, now),
                "phone_masked": d.phone_masked,
                "license_masked": d.license_masked,
                "license_expiry": d.license_expiry,
                "years_experience": d.years_experience,
                "languages": d.languages,
                "schedule": self._gantt(trips, now),
                "recent": [self.summary(s, now) for s in mine[:10]],
            }

    # ------------------------------------------------------------------ views: warehouses and analytics

    def _scope_consumption(self, district_id: str | None) -> dict[str, float]:
        use: dict[str, float] = {}
        for f in self.repo.facilities_in(district_id):
            for row in self.repo.medicine_stock_for(f["id"]):
                use[row["medicine_name"]] = use.get(row["medicine_name"], 0.0) + max(
                    float(row["avg_daily_consumption"] or 0), 0.0
                )
        return use

    def _warehouse_flow(self, warehouse_id: str, now: datetime) -> dict:
        wh = self.warehouses[warehouse_id]
        rows = [r for (w, _), r in self.base_stock.items() if w == warehouse_id]
        district = None if wh["type"] == "central" else wh["district_id"]
        return analytics.warehouse_flow(
            warehouse_id,
            now,
            self._history_for("origin_id", {warehouse_id}),
            self.analytics_shipments(),
            rows,
            reservations=self.state.reservations.get(warehouse_id, {}),
            adjustments=self.state.warehouse_adjust.get(warehouse_id, {}),
            daily_consumption=self._scope_consumption(district),
        )

    def _warehouse_summary(self, warehouse_id: str, now: datetime, flow: dict) -> dict:
        wh = self.warehouses[warehouse_id]
        return {
            "id": wh["id"],
            "name": wh["name"],
            "type": wh["type"],
            "district_id": wh["district_id"],
            "lat": wh["location"]["lat"],
            "lng": wh["location"]["lng"],
            "capacity_pallets": wh["capacity_pallets"],
            "docks": wh["docks"],
            "cold_room": wh["cold_room"],
            "outbound_today": flow["outbound_today"],
            "reserved_units": flow["reserved_units"],
            "low_cover_medicines": flow["low_cover_medicines"],
        }

    def warehouses_list(self, district_id: str | None = None) -> dict:
        with self._lock:
            now = self.now()
            items = [
                self._warehouse_summary(w["id"], now, self._warehouse_flow(w["id"], now))
                for w in self.warehouses.values()
                if not district_id or w["district_id"] == district_id
            ]
            return {"items": items}

    def warehouse_detail(self, warehouse_id: str) -> dict:
        with self._lock:
            if warehouse_id not in self.warehouses:
                raise WarehouseNotFoundError(warehouse_id)
            now = self.now()
            flow = self._warehouse_flow(warehouse_id, now)
            outbound = [
                s
                for s in self.state.shipments.values()
                if s.origin_id == warehouse_id and s.status != "cancelled"
            ]
            outbound.sort(key=lambda s: (s.created_at, s.id), reverse=True)
            return {
                **self._warehouse_summary(warehouse_id, now, flow),
                "stock": flow["stock"],
                "outbound": [self.summary(s, now) for s in outbound[:20]],
            }

    def kpis(self, district_id: str | None = None) -> dict:
        with self._lock:
            unavailable = [
                vid for vid, f in self.state.fleet.items() if f.get("status_override") == "maintenance"
            ]
            return analytics.kpis(
                district_id,
                self.now(),
                self._history,
                self.analytics_shipments(),
                self.vehicles,
                unavailable,
            )

    def volume_series(self, district_id: str | None = None, days: int = 90) -> dict:
        with self._lock:
            return analytics.volume_series(
                district_id, self.now(), self._history, self.analytics_shipments(), days
            )

    def status_breakdown(self, district_id: str | None = None) -> dict:
        with self._lock:
            return analytics.status_breakdown(district_id, self.now(), self.state.shipments.values())

    def inbound_shipment_for(self, facility_id: str, medicine_name: str) -> str | None:
        """Soonest active shipment to the facility that carries the medicine."""
        with self._lock:
            now = self.now()
            best: tuple[datetime, str] | None = None
            far = datetime.max.replace(tzinfo=UTC)
            for s in self.active_shipments():
                if s.destination_facility_id != facility_id:
                    continue
                if sim.derive_status(s, now) not in ACTIVE_STATUSES:
                    continue
                if not any(x.medicine_name == medicine_name for x in s.lines):
                    continue
                key = (s.trip.projected_arrival if s.trip else far, s.id)
                if best is None or key < best:
                    best = key
            return best[1] if best else None

    def inbound_eta_hours(self, facility_id: str) -> float | None:
        """Hours until the earliest active inbound shipment arrives (None if nothing is coming)."""
        with self._lock:
            now = self.now()
            etas = [
                s.trip.projected_arrival
                for s in self.active_shipments()
                if s.destination_facility_id == facility_id
                and s.trip is not None
                and sim.derive_status(s, now) in ACTIVE_STATUSES
            ]
            if not etas:
                return None
            return round(max(0.0, (min(etas) - now).total_seconds() / 3600.0), 1)

    def facility_history_30d(self, facility_id: str) -> dict:
        with self._lock:
            now = self.now()
            window = now - timedelta(days=30)
            units: dict[str, int] = {}
            deliveries = 0
            for r in self._history_for("destination_id", {facility_id}):
                if r["status"] != "delivered" or not r.get("delivered_at"):
                    continue
                if window <= parse_iso(r["delivered_at"]) <= now:
                    deliveries += 1
                    for item in r.get("items", []):
                        units[item["medicine_name"]] = units.get(item["medicine_name"], 0) + int(item["units"])
            for s in self.state.shipments.values():
                if s.destination_facility_id == facility_id and s.pod and window <= s.pod.confirmed_at <= now:
                    deliveries += 1
                    for item in s.pod.received:
                        units[item["medicine_name"]] = units.get(item["medicine_name"], 0) + int(item["units"])
            return {"deliveries": deliveries, "units_received_by_medicine": units}

    def _gantt(self, shipments: list[Shipment], now: datetime) -> list[dict]:
        out = []
        for s in shipments:
            if s.trip is None:
                continue
            gt = GanttTrip(
                shipment_id=s.id,
                status=sim.derive_status(s, now),
                segments=[GanttSegment(kind=g.kind, start=g.start, end=g.end) for g in s.trip.segments],
                label=f"{self.node_name(s.origin_id)} to {self.node_name(s.destination_facility_id)}",
            )
            out.append(gt.model_dump(mode="json"))
        return out

    def schedule(self, district_id: str | None = None, warehouse_id: str | None = None) -> dict:
        with self._lock:
            now = self.now()
            local = now.astimezone(IST)
            day = local.replace(hour=0, minute=0, second=0, microsecond=0)
            win_start = (day + timedelta(hours=SCHEDULE_START_HOUR)).astimezone(UTC)
            win_end = (day + timedelta(hours=SCHEDULE_END_HOUR)).astimezone(UTC)
            rows = []
            util = self._utilisation(self.vehicles, now)
            for v in self.vehicles:
                if district_id and v.district_id != district_id:
                    continue
                if warehouse_id and v.home_warehouse_id != warehouse_id:
                    continue
                trips = [
                    s
                    for s in self._trips_for_vehicle(v.id)
                    if s.trip and s.trip.planned_start < win_end and sim.trip_end(s.trip) > win_start
                ]
                trips.sort(key=lambda s: s.trip.planned_start)  # type: ignore[union-attr]
                rows.append({"vehicle": self.vehicle_summary(v, now, util), "trips": self._gantt(trips, now)})
            return {
                "date": day.strftime("%Y-%m-%d"),
                "window": {"start": iso(win_start), "end": iso(win_end)},
                "rows": rows,
            }

    def planner_run(self) -> dict:
        with self._lock:
            result = self.run_planner(self.now())
            self._save(force=True)
            return result


def _event_signature(s: Shipment) -> tuple:
    """Everything `sim.derive_events` reads besides the time (used to skip unchanged shipments)."""
    trip = s.trip
    return (
        s.approved_at,
        s.cancelled_at,
        s.pod is not None,
        None
        if trip is None
        else (trip.assigned_at, trip.planned_start, trip.projected_arrival, len(trip.segments), trip.vehicle_id),
    )


def _short_med(name: str) -> str:
    """`Anti-Rabies Vaccine (ARV)` -> `ARV`; names without a bracket stay as they are."""
    if name.endswith(")") and "(" in name:
        return name[name.rindex("(") + 1 : -1]
    return name


def build_logistics_service(
    repo: DistrictRepository,
    forecast: ForecastService,
    recs: RecommendationService,
    settings: Settings | None = None,
) -> LogisticsService:
    settings = settings or get_settings()
    store = JsonFileStateStore(settings.logistics_state_path)
    return LogisticsService(repo, forecast, recs, store, settings=settings)
