from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_five_districts_listed():
    res = client.get("/api/v1/districts")
    assert res.status_code == 200
    districts = res.json()["districts"]
    assert len(districts) == 5
    ids = {d["id"] for d in districts}
    assert ids == {
        "district_jaipur_rural",
        "district_alwar",
        "district_bikaner",
        "district_udaipur",
        "district_kota",
    }


def test_forty_facilities_total():
    res = client.get("/api/v1/facilities")
    assert res.status_code == 200
    facilities = res.json()["facilities"]
    assert len(facilities) == 40
    assert all("district_id" in f and "risk_level" in f for f in facilities)


def test_facilities_filtered_by_district_preserves_original_eight():
    res = client.get("/api/v1/facilities?district_id=district_jaipur_rural")
    assert res.status_code == 200
    facilities = res.json()["facilities"]
    ids = {f["id"] for f in facilities}
    assert ids == {"phc_18", "phc_12", "chc_east", "phc_09", "phc_04", "phc_21", "chc_north", "phc_27"}


def test_unknown_district_id_404s():
    res = client.get("/api/v1/district?district_id=district_nowhere")
    assert res.status_code == 404


def test_footfall_forecast_defaults_to_jaipur_rural():
    res = client.get("/api/v1/footfall/forecast")
    assert res.status_code == 200
    body = res.json()
    assert body["district_id"] == "district_jaipur_rural"
    assert len(body["series"]) == 7


def test_footfall_forecast_by_district():
    res = client.get("/api/v1/footfall/forecast?district_id=district_kota")
    assert res.status_code == 200
    assert res.json()["district_id"] == "district_kota"


def test_district_summary_state_rollup_covers_all_facilities():
    res = client.get("/api/v1/district")
    assert res.status_code == 200
    body = res.json()
    assert body["facility_count"] == 40
    assert sum(body["risk_counts"].values()) == 40


def test_performance_scores_can_be_filtered_by_district():
    res = client.get("/api/v1/performance?district_id=district_bikaner")
    assert res.status_code == 200
    scores = res.json()["performance"]
    assert len(scores) == 8
    assert all(s["district_id"] == "district_bikaner" for s in scores)
