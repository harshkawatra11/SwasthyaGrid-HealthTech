"""Recommendation engine v2 (A5): stable ids, district-bound logic, status machine, refresh."""

import copy
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_recommendation_service
from app.core.exceptions import InvalidTransitionError, RecommendationNotFoundError
from app.logistics import master, roads
from app.main import app
from app.repositories.district_repository import get_district_repository
from app.services.forecast_service import ForecastService
from app.services.recommendation_service import RecommendationService, plural

NOW = datetime(2026, 9, 26, 3, 0, tzinfo=UTC)
ADRENALINE = "Adrenaline (Epinephrine)"


def make_service(**kwargs) -> RecommendationService:
    repo = get_district_repository()
    return RecommendationService(
        repo, ForecastService(repo), now_provider=lambda: NOW, **kwargs
    )


def slow_ddw_routes() -> roads.Routes:
    """Real routes with DDW-to-facility legs made 10x slower so lateral transfers win."""
    routes = copy.deepcopy(roads.load_routes())
    for key, r in routes.items():
        if key.startswith("ddw_") and key.split("->")[1] not in {w["id"] for w in master.warehouses()}:
            r["duration_s"] *= 10
    return routes


class FakeHooks:
    def __init__(self):
        self.created, self.updated, self.cancelled, self.approved = [], [], [], []
        self.fail = False

    def create_draft(self, rec):
        self.created.append(rec["id"])

    def update_draft(self, rec):
        self.updated.append(rec["id"])

    def cancel_draft(self, rec, reason):
        self.cancelled.append((rec["id"], reason))

    def approve_draft(self, rec, actor, quantity):
        if self.fail:
            raise RuntimeError("planner exploded")
        self.approved.append((rec["id"], actor, quantity))
        return "SHP-200001"


def replenishments(svc):
    return [r for r in svc.list() if r["type"] == "replenishment"]


# --------------------------------------------------------------------------- generation


def test_real_seed_generates_all_types_with_v2_shape():
    recs = make_service().list()
    assert {r["type"] for r in recs} >= {"replenishment", "bed_redirect", "staff_transfer"}
    old_fields = {
        "id", "type", "source_facility_id", "target_facility_id",
        "subject", "quantity_or_detail", "confidence", "reasons", "status",
    }  # fmt: skip
    new_fields = {
        "district_id", "source_kind", "source_id", "medicine_name", "quantity", "unit",
        "priority", "created_at", "resolved_at", "resolved_by", "resolution_note",
        "shipment_id", "distance_km", "eta_minutes", "episode",
    }  # fmt: skip
    for r in recs:
        assert (old_fields | new_fields) <= set(r)
        assert r["status"] == "pending"
        assert r["source_facility_id"] == r["source_id"]
        assert r["id"].startswith("rec_") and r["created_at"].endswith("Z")
        assert 40 <= r["confidence"] <= 98
        assert r["reasons"]
    stock = replenishments(make_service())
    assert stock and all(r["source_kind"] == "warehouse" for r in stock)
    assert all(r["quantity"] > 0 and r["quantity_or_detail"].startswith(str(r["quantity"])) for r in stock)
    assert stock[0]["reasons"][0].startswith("Projected stock-out in ")


def test_no_stock_transfer_crosses_districts_or_exceeds_40_km():
    repo = get_district_repository()
    for routes in (None, slow_ddw_routes()):
        svc = make_service(routes=routes)
        transfers = [r for r in svc.list() if r["type"] == "stock_transfer"]
        if routes is not None:
            assert transfers, "lateral path must be exercised"
        for r in transfers:
            assert repo.district_id_for_facility(r["source_id"]) == r["district_id"]
            assert repo.district_id_for_facility(r["target_facility_id"]) == r["district_id"]
            assert r["source_id"] != r["target_facility_id"]
            assert r["distance_km"] <= 40
            assert r["source_kind"] == "facility"


def test_lateral_surplus_is_never_double_allocated():
    svc = make_service(routes=slow_ddw_routes())
    repo = get_district_repository()
    used: dict[tuple[str, str], int] = {}
    for r in svc.list(type="stock_transfer"):
        used[(r["source_id"], r["medicine_name"])] = used.get((r["source_id"], r["medicine_name"]), 0) + r["quantity"]
    assert used
    for (src, med), total in used.items():
        row = next(m for m in repo.medicine_stock_for(src) if m["medicine_name"] == med)
        surplus = row["units_remaining"] - 14 * max(row["avg_daily_consumption"], 0.1)
        assert 0 < total <= surplus


def test_replenishment_never_overdraws_a_warehouse():
    stock = {}
    svc = make_service(warehouse_stock=lambda wh, med: stock.get((wh, med), 100))
    recs = replenishments(svc)
    drawn: dict[tuple[str, str], int] = {}
    for r in recs:
        drawn[(r["source_id"], r["medicine_name"])] = drawn.get((r["source_id"], r["medicine_name"]), 0) + r["quantity"]
    assert all(v <= 100 for v in drawn.values())


def test_short_district_warehouse_falls_back_to_central():
    def stock(wh, med):
        return 0 if wh.startswith("ddw_") else 100000

    svc = make_service(warehouse_stock=stock)
    recs = replenishments(svc)
    assert recs and all(r["source_id"] == "wh_central" for r in recs)
    assert all("District warehouse stock insufficient" in r["reasons"] for r in recs)
    assert all(r["source_id"] != r["target_facility_id"] for r in recs)


def test_bed_redirects_stay_in_district_and_target_has_room():
    repo = get_district_repository()
    beds = {b["facility_id"]: b for b in repo.beds}
    redirects = make_service().list(type="bed_redirect")
    assert redirects
    for r in redirects:
        target = repo.facility(r["target_facility_id"])
        assert target["type"] == "CHC"
        assert repo.district_id_for_facility(r["source_id"]) == target["district_id"] == r["district_id"]
        assert beds[r["target_facility_id"]]["predicted_occupancy_next_week_pct"] < 85
        assert beds[r["source_id"]]["predicted_occupancy_next_week_pct"] > 90
        assert r["subject"] == "Redirect new admissions"
    # The old behaviour sent every district to the first CHC in the state.
    assert len({r["target_facility_id"] for r in redirects}) > 1
    assert not any(r["district_id"] == "district_kota" and r["target_facility_id"] == "chc_east" for r in redirects)


def test_staff_transfers_use_healthy_helpers_in_the_same_district():
    repo = get_district_repository()
    forecast = ForecastService(repo)
    staff = make_service().list(type="staff_transfer")
    assert staff
    for r in staff:
        assert repo.district_id_for_facility(r["source_id"]) == repo.district_id_for_facility(r["target_facility_id"])
        assert forecast.facility_risk_level(r["source_id"]) in ("healthy", "monitor")
        assert r["subject"].startswith("Relief ") and " to " in r["subject"]
        assert r["quantity_or_detail"].startswith("Temporary 2-week cover for ")


# --------------------------------------------------------------------------- ids


def test_ids_are_stable_across_instances_and_situations():
    a = [r["id"] for r in make_service().list()]
    b = [r["id"] for r in make_service().list()]
    assert a == b and len(set(a)) == len(a)
    svc = make_service()
    first = {r["id"] for r in svc.list()}
    svc.refresh()
    assert {r["id"] for r in svc.list()} == first


def test_plural_helper():
    assert plural("vial", 120) == "vials"
    assert plural("vial", 1) == "vial"
    assert plural("strip of 10 tablets", 3) == "strips of 10 tablets"


# --------------------------------------------------------------------------- status machine


def test_status_machine_and_unknown_ids():
    svc = make_service()
    rec = svc.list(type="bed_redirect")[0]
    out = svc.resolve(rec["id"], "approved", actor="Dr Rao", note="ok")
    assert out["status"] == "approved" and out["resolved_by"] == "Dr Rao" and out["resolved_at"]
    with pytest.raises(InvalidTransitionError):
        svc.resolve(rec["id"], "rejected")
    with pytest.raises(InvalidTransitionError):
        svc.resolve(rec["id"], "approved")
    with pytest.raises(InvalidTransitionError):
        svc.resolve(rec["id"], "not_a_status")
    with pytest.raises(RecommendationNotFoundError):
        svc.resolve("rec_missing", "approved")
    with pytest.raises(RecommendationNotFoundError):
        svc.get("rec_missing")
    assert svc.mark_dispatched(rec["id"])["status"] == "dispatched"
    assert svc.mark_dispatched(rec["id"])["status"] == "dispatched"  # idempotent
    with pytest.raises(InvalidTransitionError):
        svc.resolve(rec["id"], "expired")
    assert svc.mark_fulfilled(rec["id"])["status"] == "fulfilled"
    with pytest.raises(InvalidTransitionError):
        svc.mark_cancelled(rec["id"])
    assert svc.mark_fulfilled("rec_missing") is None


def test_cancel_path_from_dispatched():
    svc = make_service()
    rec = svc.list(type="staff_transfer")[0]
    svc.resolve(rec["id"], "modified", quantity_override="Cover for 3 weeks")
    assert svc.get(rec["id"])["quantity_or_detail"] == "Cover for 3 weeks"
    svc.mark_dispatched(rec["id"])
    out = svc.mark_cancelled(rec["id"], "Vehicle breakdown")
    assert out["status"] == "cancelled" and out["resolution_note"] == "Vehicle breakdown"


def test_api_returns_409_for_illegal_transition_and_404_for_unknown():
    svc = make_service()
    app.dependency_overrides[get_recommendation_service] = lambda: svc
    try:
        client = TestClient(app)
        rec_id = svc.list(type="bed_redirect")[0]["id"]
        ok = client.post(f"/api/v1/recommendations/{rec_id}/approve", json={"quantity_override": "Redirect all"})
        assert ok.status_code == 200
        assert ok.json()["status"] == "approved"
        again = client.post(f"/api/v1/recommendations/{rec_id}/approve")
        assert again.status_code == 409
        assert again.json()["code"] == "invalid_transition"
        assert client.post(f"/api/v1/recommendations/{rec_id}/reject").status_code == 409
        missing = client.post("/api/v1/recommendations/rec_nope/approve")
        assert missing.status_code == 404
        assert missing.json()["code"] == "recommendation_not_found"
        listing = client.get("/api/v1/recommendations", params={"status": "pending"}).json()
        assert all(r["status"] == "pending" for r in listing["recommendations"])
    finally:
        app.dependency_overrides.pop(get_recommendation_service, None)


def test_stock_override_updates_quantity_and_calls_hooks():
    svc = make_service()
    hooks = FakeHooks()
    svc.bind(hooks)
    svc.refresh()
    rec = replenishments(svc)[0]
    out = svc.resolve(rec["id"], "modified", quantity_override="80 vials please", actor="Officer A")
    assert out["quantity"] == 80
    assert out["quantity_or_detail"] == f"80 {plural(out['unit'], 80)}"
    assert out["shipment_id"] == "SHP-200001"
    assert hooks.approved == [(rec["id"], "Officer A", 80)]
    other = replenishments(svc)[1]
    svc.resolve(other["id"], "rejected", note="Not needed")
    assert (other["id"], "Not needed") in hooks.cancelled


def test_failing_hook_leaves_recommendation_pending():
    svc = make_service()
    hooks = FakeHooks()
    hooks.fail = True
    svc.bind(hooks)
    rec = replenishments(svc)[0]
    with pytest.raises(RuntimeError):
        svc.resolve(rec["id"], "approved")
    assert svc.get(rec["id"])["status"] == "pending"


def test_list_filters():
    svc = make_service()
    kota = svc.list(district_id="district_kota")
    assert kota and all(r["district_id"] == "district_kota" for r in kota)
    assert all(r["type"] == "bed_redirect" for r in svc.list(type="bed_redirect"))
    crit = svc.list(priority="critical")
    assert crit and all(r["priority"] == "critical" for r in crit)
    assert svc.list(status="approved") == []


# --------------------------------------------------------------------------- refresh


def target_of(svc):
    rec = next(r for r in svc.list() if r["type"] == "replenishment" and r["medicine_name"] == ADRENALINE)
    return rec


def test_refresh_expires_pending_when_condition_clears_and_recreates_when_it_returns():
    repo = get_district_repository()
    svc = make_service()
    hooks = FakeHooks()
    svc.bind(hooks)
    svc.refresh()
    rec = target_of(svc)
    assert rec["id"] in hooks.created

    entries = [{"facility_id": rec["target_facility_id"], "medicine_name": ADRENALINE, "units": 500}]
    repo.set_stock_overlay(lambda: entries)
    repo.invalidate()
    listing = svc.list()  # version changed, so the list refreshes itself
    assert rec["id"] not in {r["id"] for r in listing if r["status"] == "pending"}
    expired = svc.get(rec["id"])
    assert expired["status"] == "expired" and expired["resolution_note"] == "Condition cleared"
    assert (rec["id"], "Condition cleared") in hooks.cancelled

    entries.clear()
    repo.invalidate()
    again = [r for r in svc.list() if r["medicine_name"] == ADRENALINE and r["target_facility_id"] == rec["target_facility_id"]]
    assert {r["id"] for r in again} == {rec["id"], rec["id"] + "_2"}
    fresh = next(r for r in again if r["id"].endswith("_2"))
    assert fresh["status"] == "pending" and fresh["episode"] == 2


def test_rejected_stays_rejected_until_the_condition_clears():
    repo = get_district_repository()
    svc = make_service()
    rec = target_of(svc)
    svc.resolve(rec["id"], "rejected")
    svc.refresh()
    svc.refresh()
    same = [r for r in svc.list() if r["target_facility_id"] == rec["target_facility_id"] and r["medicine_name"] == ADRENALINE]
    assert [r["id"] for r in same] == [rec["id"]]

    entries = [{"facility_id": rec["target_facility_id"], "medicine_name": ADRENALINE, "units": 500}]
    repo.set_stock_overlay(lambda: entries)
    repo.invalidate()
    svc.refresh()
    entries.clear()
    repo.invalidate()
    svc.refresh()
    ids = {r["id"] for r in svc.list() if r["target_facility_id"] == rec["target_facility_id"] and r["medicine_name"] == ADRENALINE}
    assert ids == {rec["id"], rec["id"] + "_2"}


def test_active_recommendation_blocks_duplicates_for_the_same_target():
    svc = make_service()
    rec = target_of(svc)
    svc.resolve(rec["id"], "approved")
    svc.refresh()
    same = [r for r in svc.list() if r["target_facility_id"] == rec["target_facility_id"] and r["medicine_name"] == ADRENALINE]
    assert [r["status"] for r in same] == ["approved"]


def test_suppression_window_after_a_delivery():
    base = make_service()
    rec = target_of(base)
    pair = {"facility_id": rec["target_facility_id"], "medicine_name": ADRENALINE}

    recent = [{**pair, "at": NOW - timedelta(minutes=30)}]
    svc = make_service(delivery_provider=lambda: recent)
    assert not [r for r in svc.list() if r["id"] == rec["id"]]

    old = [{**pair, "at": (NOW - timedelta(minutes=180)).strftime("%Y-%m-%dT%H:%M:%SZ")}]
    svc = make_service(delivery_provider=lambda: old)
    assert [r for r in svc.list() if r["id"] == rec["id"]]


def test_state_round_trip_preserves_ids_and_episodes():
    svc = make_service()
    rec = target_of(svc)
    svc.resolve(rec["id"], "rejected")
    state = svc.export_state()
    clone = make_service()
    clone.load_state(state)
    assert clone.get(rec["id"])["status"] == "rejected"
    clone.refresh()
    assert {r["id"] for r in clone.list()} == {r["id"] for r in svc.list()}
    assert clone.key_for(rec["id"]).startswith("replenishment|")


def test_recommendation_table_by_type_and_district(capsys):
    recs = make_service().list()
    table: dict[str, dict[str, int]] = {}
    for r in recs:
        table.setdefault(r["district_id"], {}).setdefault(r["type"], 0)
        table[r["district_id"]][r["type"]] += 1
    with capsys.disabled():
        print("\nrecommendations by district and type")
        for district, row in sorted(table.items()):
            print(f"  {district:24s} {row}")
        print(f"  total {len(recs)}")
    assert sum(sum(row.values()) for row in table.values()) == len(recs)
