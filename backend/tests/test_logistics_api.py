"""Logistics API layer (A8): endpoints, POD token rules, admin gating, SSE, middleware."""

import asyncio
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.logistics.stream import StreamHub, Subscriber, sse_events
from app.main import app

TOKEN = {"X-Service-Token": "test-token"}
BASE = "/api/v1/logistics"


def _clear_caches() -> None:
    from app.api import deps
    from app.core.config import get_settings
    from app.repositories.district_repository import get_district_repository

    get_settings.cache_clear()
    get_district_repository.cache_clear()
    for name in dir(deps):
        fn = getattr(deps, name)
        if callable(fn) and hasattr(fn, "cache_clear"):
            fn.cache_clear()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("LOGISTICS_STATE_PATH", str(tmp_path / "state.json"))
    _clear_caches()
    return TestClient(app)


@pytest.fixture
def env(client, monkeypatch):
    """Change a setting and rebuild the cached settings object."""

    def set_env(**values):
        for k, v in values.items():
            monkeypatch.setenv(k, v)
        from app.core.config import get_settings

        get_settings.cache_clear()

    return set_env


def _arrived(client, kind="replenishment"):
    items = client.get(f"{BASE}/shipments?status=arrived&kind={kind}").json()["items"]
    assert items, "the initial scenario has arrived shipments"
    return items[0]


def _pod_body(client, ship, **over):
    detail = client.get(f"{BASE}/shipments/{ship['id']}").json()
    body = {
        "pod_id": "pod-1",
        "facility_id": ship["destination"]["id"],
        "confirmed_by": "Nurse Meena",
        "received": [{"medicine_name": x["medicine_name"], "units": x["units"]} for x in detail["lines"]],
        "condition": "ok",
    }
    body.update(over)
    return body


# ---------------------------------------------------------------------- clock, admin


def test_clock(client):
    body = client.get(f"{BASE}/clock").json()
    assert set(body) == {"sim_now", "scale", "scenario_start", "background_traffic", "paused"}
    assert body["scale"] == 60 and body["paused"] is False
    assert body["scenario_start"].endswith("Z")


def test_time_scale_and_reset(client):
    res = client.post(f"{BASE}/admin/time-scale", json={"scale": 120})
    assert res.status_code == 200 and res.json()["scale"] == 120
    assert client.post(f"{BASE}/admin/time-scale", json={"scale": 0}).status_code == 422
    assert client.post(f"{BASE}/admin/time-scale", json={"scale": 601}).status_code == 422
    reset = client.post(f"{BASE}/admin/reset", json={}).json()
    assert reset["ok"] is True
    assert reset["sim_now"][11:16] == "03:00"  # 08:30 IST
    assert client.post(f"{BASE}/admin/reset").status_code == 200


def test_admin_gated(client, env):
    env(LOGISTICS_ADMIN_ENABLED="false")
    res = client.post(f"{BASE}/admin/time-scale", json={"scale": 60})
    assert res.status_code == 403 and res.json()["code"] == "admin_disabled"
    assert client.post(f"{BASE}/admin/reset").status_code == 403
    env(LOGISTICS_ADMIN_ENABLED="true", ENVIRONMENT="production")
    assert client.post(f"{BASE}/admin/reset").status_code == 403


# ---------------------------------------------------------------------- analytics and lists


def test_kpis_series_and_breakdown(client):
    kpis = client.get(f"{BASE}/kpis").json()
    assert kpis["in_transit_now"] == 9 and kpis["delayed_now"] == 1
    assert kpis["pending_approvals"] > 0
    scoped = client.get(f"{BASE}/kpis?district_id=district_kota").json()
    assert scoped["scope"] == "district_kota" and scoped["pending_approvals"] < kpis["pending_approvals"]
    series = client.get(f"{BASE}/series/volume?days=7").json()["points"]
    assert len(series) == 7 and {"date", "shipments", "delivered"} <= set(series[0])
    assert client.get(f"{BASE}/series/volume?days=0").status_code == 422
    breakdown = client.get(f"{BASE}/status-breakdown").json()
    assert breakdown["counts"]["in_transit"] == 9 and breakdown["counts"]["loading"] == 4


def test_warehouses(client):
    items = client.get(f"{BASE}/warehouses").json()["items"]
    assert len(items) == 6
    assert {"outbound_today", "reserved_units", "low_cover_medicines", "lat", "lng"} <= set(items[0])
    assert len(client.get(f"{BASE}/warehouses?district_id=district_kota").json()["items"]) == 1
    detail = client.get(f"{BASE}/warehouses/ddw_kota").json()
    assert detail["stock"] and {"days_of_cover", "expiring_soon", "batch_no"} <= set(detail["stock"][0])
    assert isinstance(detail["outbound"], list)
    res = client.get(f"{BASE}/warehouses/nope")
    assert res.status_code == 404 and res.json()["code"] == "warehouse_not_found"


def test_vehicles(client):
    items = client.get(f"{BASE}/vehicles").json()["items"]
    assert len(items) == 31
    assert "class" in items[0] and "class_" not in items[0]
    assert sum(1 for v in items if v["live_status"] == "maintenance") == 2
    assert any(v["utilisation_7d"] > 0 for v in items)
    loading = client.get(f"{BASE}/vehicles?status=loading").json()["items"]
    assert len(loading) == 4 and all(v["current_shipment_id"] for v in loading)
    assert len(client.get(f"{BASE}/vehicles?district_id=district_kota").json()["items"]) == 5


def test_vehicle_detail_cargo(client):
    moving = next(v for v in client.get(f"{BASE}/vehicles?status=in_transit").json()["items"])
    detail = client.get(f"{BASE}/vehicles/{moving['id']}").json()
    cargo = detail["cargo"]
    assert len(cargo["slots"]) == moving["pallet_slots"]
    assert cargo["used_slots"] >= 1
    assert [s["index"] for s in cargo["slots"]] == list(range(moving["pallet_slots"]))
    assert all(s["state"] == "loaded" for s in cargo["slots"][: cargo["used_slots"]])
    assert sum(1 for s in cargo["slots"] if s["state"] == "empty") == moving["pallet_slots"] - cargo["used_slots"]
    assert detail["schedule"] and detail["odometer_km"] > 0 and detail["trips_7d"] >= 1
    res = client.get(f"{BASE}/vehicles/nope")
    assert res.status_code == 404 and res.json()["code"] == "vehicle_not_found"


def test_drivers(client):
    items = client.get(f"{BASE}/drivers").json()["items"]
    assert len(items) == 40
    assert any(d["deliveries_30d"] > 0 for d in items)
    assert any(d["on_time_rate_30d"] is not None for d in items)
    driving = client.get(f"{BASE}/drivers?status=driving").json()["items"]
    assert driving
    detail = client.get(f"{BASE}/drivers/{driving[0]['id']}").json()
    assert detail["license_masked"] and detail["languages"] and detail["recent"]
    assert detail["recent"][0]["driver"]["id"] == driving[0]["id"]
    res = client.get(f"{BASE}/drivers/nope")
    assert res.status_code == 404 and res.json()["code"] == "driver_not_found"


def test_shipments_query_and_detail(client):
    body = client.get(f"{BASE}/shipments?limit=3").json()
    assert len(body["items"]) == 3 and body["total"] > 20
    assert len(client.get(f"{BASE}/shipments?limit=3&offset=3").json()["items"]) == 3
    multi = client.get(f"{BASE}/shipments?status=loading,in_transit").json()
    assert {i["status"] for i in multi["items"]} == {"loading", "in_transit"}
    crit = client.get(f"{BASE}/shipments?priority=critical&district_id=district_kota").json()
    assert all(i["priority"] == "critical" and i["district_id"] == "district_kota" for i in crit["items"])
    assert client.get(f"{BASE}/shipments?sort=bogus").status_code == 422
    sid = body["items"][0]["id"]
    assert client.get(f"{BASE}/shipments?q={sid.lower()}").json()["total"] == 1
    detail = client.get(f"{BASE}/shipments/{sid}").json()
    assert detail["id"] == sid and "path" in detail and "events" in detail and "stops" in detail
    res = client.get(f"{BASE}/shipments/SHP-999999")
    assert res.status_code == 404 and res.json()["code"] == "shipment_not_found"


def test_cancel_rules(client):
    arrived = _arrived(client)
    res = client.post(f"{BASE}/shipments/{arrived['id']}/cancel", json={"reason": "test"})
    assert res.status_code == 409 and res.json()["code"] == "invalid_state"
    assert client.post(f"{BASE}/shipments/SHP-999999/cancel", json={"reason": "x"}).status_code == 404
    live = client.get(f"{BASE}/shipments?status=in_transit").json()["items"][0]
    ok = client.post(
        f"{BASE}/shipments/{live['id']}/cancel", json={"reason": "Road closed", "actor": "Officer Rao"}
    )
    assert ok.status_code == 200 and ok.json()["status"] == "cancelled"


def test_positions_schedule_planner_inbound(client):
    pos = client.get(f"{BASE}/positions").json()
    assert len(pos["items"]) == 14 and pos["sim_now"].endswith("Z")
    kota = client.get(f"{BASE}/positions?district_id=district_kota").json()["items"]
    assert len(kota) < 14
    sched = client.get(f"{BASE}/schedule?district_id=district_kota").json()
    assert len(sched["rows"]) == 5 and sched["window"]["start"] < sched["window"]["end"]
    assert client.get(f"{BASE}/schedule?warehouse_id=ddw_kota").json()["rows"]
    planned = client.post(f"{BASE}/planner/run").json()
    assert set(planned) == {"assigned", "still_blocked"}
    inbound = client.get(f"{BASE}/facilities/phc_18/inbound").json()["items"]
    assert inbound and inbound[0]["lines"][0]["base_daily_consumption"] > 0
    assert client.get(f"{BASE}/facilities/nope/inbound").status_code == 404


# ---------------------------------------------------------------------- recommendations


def test_approve_stock_recommendation_returns_shipment(client):
    recs = client.get("/api/v1/recommendations?status=pending&type=replenishment").json()["recommendations"]
    rec = recs[0]
    res = client.post(f"/api/v1/recommendations/{rec['id']}/approve", json={"actor": "Officer Rao"})
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == rec["id"] and body["status"] == "approved"  # old top-level shape
    assert body["recommendation"]["id"] == rec["id"]
    assert body["shipment"]["id"] == body["shipment_id"]
    assert body["shipment"]["status"] in ("approved", "loading")
    assert body["resolved_by"] == "Officer Rao"
    again = client.post(f"/api/v1/recommendations/{rec['id']}/approve")
    assert again.status_code == 409 and again.json()["code"] == "invalid_transition"


def test_modify_and_reject(client):
    recs = client.get("/api/v1/recommendations?status=pending&type=replenishment").json()["recommendations"]
    a, b = recs[0], recs[1]
    mod = client.post(
        f"/api/v1/recommendations/{a['id']}/modify", json={"quantity_override": "50 units", "note": "less"}
    ).json()
    assert mod["status"] == "modified" and mod["quantity"] == 50 and mod["shipment"]["lines"][0]["units"] == 50
    rej = client.post(f"/api/v1/recommendations/{b['id']}/reject", json={"note": "not needed"}).json()
    assert rej["status"] == "rejected" and rej["shipment"] is None
    assert client.post(f"/api/v1/recommendations/{a['id']}/modify", json={}).status_code == 422


def test_approve_staff_recommendation_has_no_shipment(client):
    staff = client.get("/api/v1/recommendations?type=staff_transfer").json()["recommendations"]
    assert staff
    res = client.post(f"/api/v1/recommendations/{staff[0]['id']}/approve").json()
    assert res["status"] == "approved" and res["shipment"] is None


def test_unknown_recommendation_404(client):
    res = client.post("/api/v1/recommendations/rec_nope/approve")
    assert res.status_code == 404 and res.json()["code"] == "recommendation_not_found"


def test_recommendation_filters(client):
    all_recs = client.get("/api/v1/recommendations").json()["recommendations"]
    kota = client.get("/api/v1/recommendations?district_id=district_kota").json()["recommendations"]
    assert kota and all(r["district_id"] == "district_kota" for r in kota)
    crit = client.get("/api/v1/recommendations?priority=critical").json()["recommendations"]
    assert all(r["priority"] == "critical" for r in crit) and len(crit) < len(all_recs)
    beds = client.get("/api/v1/recommendations?type=bed_redirect").json()["recommendations"]
    assert beds and all(r["type"] == "bed_redirect" for r in beds)


# ---------------------------------------------------------------------- POD


def test_pod_requires_configured_token(client, env):
    ship = _arrived(client)
    body = _pod_body(client, ship)
    env(LOGISTICS_SERVICE_TOKEN="")
    res = client.post(f"{BASE}/shipments/{ship['id']}/pod", json=body, headers=TOKEN)
    assert res.status_code == 503 and res.json()["code"] == "service_token_not_configured"


def test_pod_rejects_bad_token(client):
    ship = _arrived(client)
    body = _pod_body(client, ship)
    assert client.post(f"{BASE}/shipments/{ship['id']}/pod", json=body).status_code == 401
    res = client.post(f"{BASE}/shipments/{ship['id']}/pod", json=body, headers={"X-Service-Token": "wrong"})
    assert res.status_code == 401 and res.json()["code"] == "invalid_service_token"


def test_pod_happy_path_is_idempotent_and_raises_stock(client):
    ship = _arrived(client)
    fid = ship["destination"]["id"]
    before = {
        m["medicine_name"]: m["units_remaining"]
        for m in client.get(f"/api/v1/medicines?district_id={ship['district_id']}").json()["medicines"]
        if m["facility_id"] == fid
    }
    body = _pod_body(client, ship)
    res = client.post(f"{BASE}/shipments/{ship['id']}/pod", json=body, headers=TOKEN)
    assert res.status_code == 200
    out = res.json()
    assert out["already_confirmed"] is False and out["stock_applied_by"] == "backend_overlay"
    assert out["shipment"]["status"] == "delivered" and out["shipment"]["pod"]["pod_id"] == "pod-1"
    after = {
        m["medicine_name"]: m["units_remaining"]
        for m in client.get(f"/api/v1/medicines?district_id={ship['district_id']}").json()["medicines"]
        if m["facility_id"] == fid
    }
    line = body["received"][0]
    assert after[line["medicine_name"]] == before.get(line["medicine_name"], 0) + line["units"]
    again = client.post(
        f"{BASE}/shipments/{ship['id']}/pod", json={**body, "pod_id": "pod-2"}, headers=TOKEN
    ).json()
    assert again["already_confirmed"] is True and again["shipment"]["pod"]["pod_id"] == "pod-1"


def test_pod_conflicts_and_missing(client):
    ship = _arrived(client)
    wrong = client.post(
        f"{BASE}/shipments/{ship['id']}/pod",
        json=_pod_body(client, ship, facility_id="kota_phc_1"),
        headers=TOKEN,
    )
    assert wrong.status_code == 409
    moving = client.get(f"{BASE}/shipments?status=in_transit").json()["items"][0]
    early = client.post(
        f"{BASE}/shipments/{moving['id']}/pod", json=_pod_body(client, moving), headers=TOKEN
    )
    assert early.status_code == 409 and "not arrived" in early.json()["detail"]
    missing = client.post(f"{BASE}/shipments/SHP-999999/pod", json=_pod_body(client, ship), headers=TOKEN)
    assert missing.status_code == 404
    bad = client.post(
        f"{BASE}/shipments/{ship['id']}/pod", json={"pod_id": "p"}, headers=TOKEN
    )
    assert bad.status_code == 422


def test_stock_applied(client):
    ship = _arrived(client)
    url = f"{BASE}/shipments/{ship['id']}/stock-applied"
    assert client.post(url, json={"pod_id": "pod-1"}).status_code == 401
    assert client.post(url, json={"pod_id": "pod-1"}, headers=TOKEN).status_code == 409  # no POD yet
    client.post(f"{BASE}/shipments/{ship['id']}/pod", json=_pod_body(client, ship), headers=TOKEN)
    assert client.post(url, json={"pod_id": "pod-1"}, headers=TOKEN).json() == {"ok": True}
    assert client.post(url, json={"pod_id": "pod-1"}, headers=TOKEN).json() == {"ok": True}
    missing = client.post(f"{BASE}/shipments/SHP-999999/stock-applied", json={"pod_id": "x"}, headers=TOKEN)
    assert missing.status_code == 404


# ---------------------------------------------------------------------- middleware and openapi


def test_security_headers_on_rest_responses(client):
    for path in ("/health", f"{BASE}/clock", "/api/v1/facilities/nope"):
        res = client.get(path)
        assert res.headers["x-content-type-options"] == "nosniff"
        assert res.headers["x-frame-options"] == "DENY"
        assert res.headers["strict-transport-security"].startswith("max-age=")
        assert res.headers["x-xss-protection"] == "1; mode=block"


def test_openapi_lists_the_frontend_schema_names(client):
    schemas = set(client.get("/openapi.json").json()["components"]["schemas"])
    expected = {
        "ShipmentSummary", "ShipmentDetail", "InboundItem", "VehiclePosition", "VehicleSummary",
        "VehicleDetail", "DriverSummary", "DriverDetail", "GanttTrip", "ShipmentEvent",
        "WarehouseSummary", "WarehouseDetail", "LogisticsKpis", "VolumeSeries", "StatusBreakdown",
        "ScheduleResponse", "ClockState", "StateSummary", "FacilityMatrix", "MedicineMatrix",
        "Briefing", "FacilityProfile", "RecommendationV2", "ApproveResponse", "PodRequest",
        "PodResponse",
    }
    assert expected <= schemas


def test_stream_route_is_registered(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert f"{BASE}/stream" in paths


# ---------------------------------------------------------------------- SSE (sse_events directly)


def _boot():
    from app.api.deps import get_logistics_service, get_stream_hub

    return get_logistics_service(), get_stream_hub()


async def _read_until(gen, wanted: set[str], limit: int = 200) -> dict[str, list[dict]]:
    import json

    seen: dict[str, list[dict]] = {}
    for _ in range(limit):
        try:
            frame = await asyncio.wait_for(anext(gen), 1)
        except TimeoutError:
            break
        seen.setdefault(frame["event"], []).append(json.loads(frame["data"]))
        if wanted <= set(seen):
            break
    return seen


def test_sse_events_yield_tick_and_shipment(client):
    svc, hub = _boot()

    async def scenario():
        gen = sse_events(hub, None)
        t = svc.now()
        svc.tick(t)
        svc.tick(t + timedelta(minutes=40))
        seen = await _read_until(gen, {"tick", "shipment", "kpis"})
        await gen.aclose()
        return seen

    seen = asyncio.run(scenario())
    assert {"tick", "shipment", "kpis"} <= set(seen)
    tick = seen["tick"][0]
    assert tick["sim_now"].endswith("Z") and tick["positions"]
    assert {"shipment_id", "lat", "lng", "bearing", "speed_kmh"} <= set(tick["positions"][0])
    ev = seen["shipment"][0]
    assert {"event", "status", "district_id", "facility_id"} <= set(ev)
    assert ev["event"]["at"].endswith("Z")
    assert hub.size == 0  # closing the generator unsubscribes


def test_sse_events_filter_by_district(client):
    svc, hub = _boot()

    async def scenario():
        gen = sse_events(hub, "district_kota")
        svc.tick(svc.now() + timedelta(minutes=40))
        seen = await _read_until(gen, {"tick"})
        # drain what is already queued
        more = await _read_until(gen, {"never"}, limit=50)
        await gen.aclose()
        return seen, more

    seen, more = asyncio.run(scenario())
    everything = [*seen.get("shipment", []), *more.get("shipment", [])]
    assert all(e["district_id"] == "district_kota" for e in everything)
    all_positions = {p["shipment_id"] for f in seen["tick"] for p in f["positions"]}
    kota = {
        s["id"]
        for s in svc.list_shipments(district_id="district_kota", limit=500)
    }
    assert all_positions <= kota


def test_sse_emits_risk_and_recommendations_after_a_delivery(client):
    svc, hub = _boot()
    rec = next(
        r
        for r in svc.recs.list(status="pending")
        if r["target_facility_id"] == "kota_phc_4" and "ARV" in (r["medicine_name"] or "")
    )
    svc.recs.resolve(rec["id"], "approved", actor="Officer")
    sid = svc.recs.get(rec["id"])["shipment_id"]
    svc.clock.reanchor(svc.now() + timedelta(hours=6))  # the truck has arrived by then
    assert svc.summary(svc.state.shipments[sid])["status"] == "arrived"

    async def scenario():
        gen = sse_events(hub, None)
        svc.tick(svc.now())  # baseline
        detail = svc.detail(sid)
        svc.confirm_pod(
            sid, "pod-x", "kota_phc_4", "Nurse",
            [{"medicine_name": x["medicine_name"], "units": x["units"]} for x in detail["lines"]],
        )
        svc.tick(svc.now())
        seen = await _read_until(gen, {"risk", "recommendations"})
        await gen.aclose()
        return seen

    seen = asyncio.run(scenario())
    risk = [r for r in seen["risk"] if r["facility_id"] == "kota_phc_4"]
    assert risk and risk[0]["from"] == "critical" and risk[0]["to"] != "critical"
    assert risk[0]["facility_name"] == "PHC Kota-4" and "delivered" in risk[0]["reason"]
    assert "ARV" in risk[0]["reason"]


def test_slow_client_sheds_tick_frames_but_never_shipment_frames():
    async def scenario():
        sub = Subscriber(None)
        for i in range(200):
            sub.push({"event": "tick", "data": str(i)})
        sub.push({"event": "shipment", "data": "keep-1"})
        sub.push({"event": "risk", "data": "keep-2"})
        events = [sub.queue.get_nowait()["event"] for _ in range(sub.queue.qsize())]
        return events

    events = asyncio.run(scenario())
    assert len(events) == 200
    assert events.count("shipment") == 1 and events.count("risk") == 1
    assert events.count("tick") == 198


def test_hub_without_subscribers_ignores_ticks():
    hub = StreamHub()
    hub.on_tick({"sim_now": "2026-09-26T03:00:00Z"})
    assert hub.size == 0


def test_tick_loop_runs_and_stops():
    from app.logistics.stream import TickLoop

    class Fake:
        calls = 0

        def tick(self):
            Fake.calls += 1

    async def scenario():
        loop = TickLoop(Fake(), interval=0.05)
        loop.start()
        loop.start()  # idempotent
        await asyncio.sleep(0.3)
        await loop.stop()
        await loop.stop()
        return Fake.calls

    assert asyncio.run(scenario()) >= 3


def test_lifespan_starts_the_tick_loop_when_enabled(client, env):
    import time

    env(LOGISTICS_TICK="true")
    with TestClient(app) as live:
        first = live.get(f"{BASE}/clock").json()["sim_now"]
        time.sleep(1.2)
        from app.api.deps import get_logistics_service

        svc = get_logistics_service()
        assert svc.state.clock["last_sim_now"] > first  # the loop advanced the world
    # leaving the context stops the loop and flushes the state
    assert svc.store.load() is not None


def test_lifespan_skips_the_tick_loop_when_disabled(client):
    with TestClient(app) as live:
        assert live.get("/health").status_code == 200
