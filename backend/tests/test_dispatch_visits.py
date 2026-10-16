"""Fresh visits replay independently; ordinary navigation keeps the same world."""

from datetime import timedelta

from fastapi.testclient import TestClient

from app.logistics.visits import _visits, visit_world
from app.main import app


def test_visit_reuses_world_but_new_visitor_starts_fresh():
    _visits.clear()
    try:
        first, _ = visit_world("first-visitor-123456")
        start = first.now()
        first.clock.reanchor(start + timedelta(hours=12))
        again, _ = visit_world("first-visitor-123456")
        second, _ = visit_world("second-visitor-12345")
        assert again is first
        assert second is not first
        assert second.repo is not first.repo
        assert second.now() < first.now() - timedelta(hours=11)
        assert any(s.status in ("in_transit", "delayed") for s in second.active_shipments())
    finally:
        _visits.clear()


def test_dispatch_endpoints_accept_visit_and_reject_invalid_id():
    _visits.clear()
    try:
        client = TestClient(app)
        query = "?demo_session=browser-document-12345"
        assert client.get("/api/v1/logistics/clock" + query).status_code == 200
        assert client.get("/api/v1/logistics/positions" + query).status_code == 200
        assert client.get("/api/v1/logistics/clock?demo_session=bad").status_code == 400
    finally:
        _visits.clear()


def test_each_district_opens_with_multiple_distinct_moving_shipments():
    _visits.clear()
    try:
        service, _ = visit_world("dense-opening-visitor-123")
        assert service.clock.scale == 10
        for district in service.repo.districts:
            moving = [s for s in service.active_shipments()
                      if s.district_id == district["id"] and s.status in ("in_transit", "delayed")]
            assert len(moving) == 8, district["id"]
            assert len({s.destination_facility_id for s in moving}) == min(
                8, len(service.repo.facilities_in(district["id"])),
            )
            assert len({s.trip.vehicle_id for s in moving}) == len(moving)
    finally:
        _visits.clear()


def test_production_speed_controls_are_private_to_the_visit(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("LOGISTICS_ADMIN_ENABLED", "false")
    get_settings.cache_clear()
    _visits.clear()
    try:
        client = TestClient(app)
        base = "/api/v1/logistics"
        first = "?demo_session=speed-first-visitor-123"
        other = "?demo_session=speed-other-visitor-123"
        changed = client.post(base + "/admin/time-scale" + first, json={"scale": 120})
        assert changed.status_code == 200
        assert changed.json()["scale"] == 120
        assert client.get(base + "/clock" + other).json()["scale"] == 10
        assert client.post(base + "/admin/time-scale", json={"scale": 120}).status_code == 403
        assert client.post(base + "/admin/reset" + first, json={}).status_code == 200
        assert client.post(base + "/admin/reset").status_code == 403
    finally:
        _visits.clear()
        get_settings.cache_clear()
