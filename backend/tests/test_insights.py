"""Insight endpoints (6.2): state summary, matrices, facility profile, risk index."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.insights_service import MATRIX_DIMENSIONS, risk_index


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.api import deps
    from app.core.config import get_settings
    from app.repositories.district_repository import get_district_repository

    monkeypatch.setenv("LOGISTICS_STATE_PATH", str(tmp_path / "state.json"))
    get_settings.cache_clear()
    get_district_repository.cache_clear()
    for name in dir(deps):
        fn = getattr(deps, name)
        if callable(fn) and hasattr(fn, "cache_clear"):
            fn.cache_clear()
    return TestClient(app)


def test_risk_index_hand_case():
    # 8 facilities, 2 critical (25%), 1 stress (12.5%), 3 stockouts, beds 80, one high-risk doctor:
    # 0.4*25 + 0.2*12.5 + 6 + 3.3 + 10 = 31.8
    assert (
        risk_index(
            facilities=8,
            critical=2,
            stress=1,
            stockout_items=3,
            bed_next_week_avg=80,
            doctors_high_risk=1,
        )
        == 32
    )


def test_risk_index_is_clamped_and_handles_empty_scope():
    assert risk_index(facilities=0, critical=0, stress=0, stockout_items=0,
                      bed_next_week_avg=None, doctors_high_risk=0) == 0
    assert risk_index(facilities=4, critical=4, stress=0, stockout_items=40,
                      bed_next_week_avg=500, doctors_high_risk=3) == 100


def test_state_summary_all(client):
    res = client.get("/api/v1/insights/state-summary")
    assert res.status_code == 200
    body = res.json()
    assert body["scope"] == "all"
    totals = body["totals"]
    assert totals["facilities"] == 40
    assert totals["risk_counts"] == {"healthy": 15, "monitor": 7, "stress": 8, "critical": 10}
    assert len(body["districts"]) == 5
    assert sum(d["stockout_items"] for d in body["districts"]) == totals["stockout_items"]
    assert sum(d["facilities"] for d in body["districts"]) == 40
    assert all(0 <= d["risk_index"] <= 100 for d in body["districts"])
    assert totals["pending_recommendations"] == sum(
        d["pending_recommendations"] for d in body["districts"]
    )
    assert body["generated_at"].endswith("Z")


def test_state_summary_top_risks_are_ordered_and_capped(client):
    top = client.get("/api/v1/insights/state-summary").json()["top_risks"]
    assert len(top) == 10
    days = [r["days_remaining"] for r in top]
    assert days == sorted(days)
    assert top[0]["priority"] in ("critical", "high")
    assert all(r["facility_name"] and r["district_id"] for r in top)


def test_state_summary_district_scope(client):
    res = client.get("/api/v1/insights/state-summary?district_id=district_kota")
    body = res.json()
    assert body["scope"] == "district_kota"
    assert body["totals"]["facilities"] == 8
    assert [d["district_id"] for d in body["districts"]] == ["district_kota"]
    assert all(r["district_id"] == "district_kota" for r in body["top_risks"])
    assert client.get("/api/v1/insights/state-summary?district_id=nope").status_code == 404


def test_state_summary_matches_service_counts(client):
    from app.api.deps import get_forecast_service

    fc = get_forecast_service()
    rows = [r for f in fc.repo.facilities for r in fc.medicine_forecast(f["id"])]
    body = client.get("/api/v1/insights/state-summary").json()
    assert body["totals"]["stockout_items"] == sum(1 for r in rows if r["days_remaining"] < 3)
    assert body["totals"]["low_cover_items"] == sum(1 for r in rows if 3 <= r["days_remaining"] < 7)


def test_facility_matrix_shape(client):
    body = client.get("/api/v1/insights/facility-matrix").json()
    assert body["dimensions"] == MATRIX_DIMENSIONS
    assert len(body["rows"]) == 40
    row = next(r for r in body["rows"] if r["facility_id"] == "kota_phc_4")
    assert set(row["values"]) == {d["id"] for d in MATRIX_DIMENSIONS}
    assert row["risk_level"] == "critical"
    assert row["values"]["inventory"] < 3
    assert row["values"]["staffing"] in (0, 1)
    scoped = client.get("/api/v1/insights/facility-matrix?district_id=district_alwar").json()
    assert len(scoped["rows"]) == 8


def test_facility_matrix_supply_is_hours_or_null(client):
    rows = client.get("/api/v1/insights/facility-matrix").json()["rows"]
    supply = [r["values"]["supply"] for r in rows]
    assert any(v is not None and v >= 0 for v in supply)
    assert any(v is None for v in supply)


def test_medicine_matrix_covers_every_pair(client):
    body = client.get("/api/v1/insights/medicine-matrix").json()
    assert len(body["districts"]) == 5
    assert len(body["cells"]) == len(body["medicines"]) * 5
    arv = next(m for m in body["medicines"] if "ARV" in m["name"])
    assert arv["emergency"] is True and arv["cold_chain"] is True
    kota = [c for c in body["cells"] if c["district_id"] == "district_kota" and c["medicine_name"] == arv["name"]]
    assert kota[0]["min_days_remaining"] is not None and kota[0]["min_days_remaining"] < 3
    assert kota[0]["facilities_below_threshold"] >= 1
    scoped = client.get("/api/v1/insights/medicine-matrix?district_id=district_kota").json()
    assert len(scoped["districts"]) == 1


def test_briefing_falls_back_to_template_without_key(client):
    body = client.get("/api/v1/insights/briefing").json()
    assert body["model"] == "template"
    assert body["text"] and 3 <= len(body["bullets"]) <= 5
    assert body["cached"] is False


def test_facility_profile(client):
    res = client.get("/api/v1/facilities/phc_18/profile")
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == "phc_18"
    assert body["district_name"] == "Jaipur Rural District"
    assert body["performance"]["facility_id"] == "phc_18"
    assert body["risk_level"] in ("healthy", "monitor", "stress", "critical")
    assert any(r["target_facility_id"] == "phc_18" for r in body["recommendations"])
    assert body["inbound"] and body["inbound"][0]["destination"]["id"] == "phc_18"
    assert set(body["history_30d"]) == {"deliveries", "units_received_by_medicine"}
    assert client.get("/api/v1/facilities/nope/profile").status_code == 404


def test_existing_endpoint_additions(client):
    meds = client.get("/api/v1/medicines?district_id=district_kota").json()["medicines"]
    row = meds[0]
    assert {"facility_name", "district_id", "unit", "cold_chain", "emergency"} <= set(row)
    alerts = client.get("/api/v1/alerts").json()["alerts"]
    assert alerts and all(a["detail"] and a["facility_name"] for a in alerts)
    docs = client.get("/api/v1/doctors/attendance?district_id=district_kota").json()["doctors"]
    assert docs and all(d["district_id"] == "district_kota" and d["facility_name"] for d in docs)
    diag = client.get("/api/v1/diagnostics?district_id=district_kota").json()["diagnostics"]
    assert diag and all(d["district_id"] == "district_kota" and d["facility_name"] for d in diag)
    beds = client.get("/api/v1/beds/forecast?district_id=district_kota").json()["beds"]
    assert len(beds) == 8
    assert len(client.get("/api/v1/beds/forecast").json()["beds"]) == 40


# ---------------------------------------------------------------------- briefing (A9), Sarvam mocked


class _Settings:
    sarvam_api_key = "key-not-real"
    sarvam_chat_model = "sarvam-105b"


class _Logistics:
    def now(self):
        from datetime import UTC, datetime

        return datetime(2026, 9, 26, 3, 0, tzinfo=UTC)


REPLY = (
    "Rajasthan has 40 facilities and 10 are critical. Stock cover is the main pressure.\n"
    "- PHC Kota-4 needs attention on stock\n"
    "- Alwar District has a risk index of 27\n"
    "- 25 recommendations are waiting for approval\n"
)


def _summary(client):
    return client.get("/api/v1/insights/state-summary").json()


def _service(reply, clock=None, key="key-not-real"):
    from app.services.briefing_service import BriefingService

    settings = _Settings()
    settings.sarvam_api_key = key
    svc = BriefingService(settings, None, _Logistics(), **({"clock": clock} if clock else {}))
    calls = []

    def post(payload):
        calls.append(payload)
        if isinstance(reply, Exception):
            raise reply
        return {"choices": [{"message": {"content": reply}}]}

    svc._post = post
    return svc, calls


def test_briefing_parses_sarvam_reply_and_sends_the_contract(client):
    summary = _summary(client)
    svc, calls = _service(REPLY)
    out = svc.briefing(summary, 1)
    assert out["model"] == "sarvam-105b" and out["cached"] is False
    assert out["text"].startswith("Rajasthan has 40 facilities")
    assert out["bullets"][0] == "PHC Kota-4 needs attention on stock" and len(out["bullets"]) == 3
    payload = calls[0]
    assert payload["reasoning_effort"] is None and payload["temperature"] == 0.3
    assert payload["max_tokens"] == 400 and payload["stream"] is False
    assert "never invent" in payload["messages"][0]["content"]
    assert '"totals"' in payload["messages"][1]["content"]


def test_briefing_cache_hit_and_expiry(client):
    summary = _summary(client)
    now = [0.0]
    svc, calls = _service(REPLY, clock=lambda: now[0])
    assert svc.briefing(summary, 1)["cached"] is False
    assert svc.briefing(summary, 1)["cached"] is True
    assert len(calls) == 1
    svc.briefing(summary, 2)  # repo version is part of the key
    assert len(calls) == 2
    now[0] = 601.0
    assert svc.briefing(summary, 1)["cached"] is False
    assert len(calls) == 3


def test_briefing_template_without_key(client):
    svc, calls = _service(REPLY, key=None)
    out = svc.briefing(_summary(client), 1)
    assert out["model"] == "template" and calls == []


def test_briefing_template_on_error_or_bad_shape(client):
    summary = _summary(client)
    for reply in (RuntimeError("boom"), "just a paragraph, no bullets", ""):
        svc, _ = _service(reply)
        assert svc.briefing(summary, 1)["model"] == "template"


def test_briefing_rejects_invented_numbers(client):
    bad = REPLY.replace("40 facilities", "41 facilities").replace("10 are", "9999 are")
    svc, _ = _service(bad)
    assert svc.briefing(_summary(client), 1)["model"] == "template"


def test_template_numbers_all_come_from_the_summary(client):
    from app.services.briefing_service import stray_numbers, template_briefing

    summary = _summary(client)
    out = template_briefing(summary, _Logistics().now())
    assert stray_numbers(out["text"], out["bullets"], summary) == []
