"""Tool set v2 against the real seed services and fake logistics/insights objects
that follow `app.logistics.protocol`."""

import inspect
import json
from datetime import UTC, datetime, timedelta

import pytest

from app.api.deps import get_district_service, get_forecast_service, get_recommendation_service
from app.tools import v2
from app.tools.schemas import TOOL_NAMES, TOOL_SCHEMAS

NOW = datetime(2026, 9, 26, 8, 0, tzinfo=UTC)


def _iso(minutes: int) -> str:
    return (NOW + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _summary(sid, status, to, eta_min, delay=0, driver="Ramesh", dest="kota_phc_4"):
    return {
        "id": sid,
        "status": status,
        "priority": "critical",
        "district_id": "district_kota",
        "origin": {"id": "wh_kota", "name": "District Drug Warehouse, Kota", "kind": "warehouse"},
        "destination": {"id": dest, "name": to},
        "lines_summary": "ARV 120 vials",
        "eta": _iso(eta_min) if eta_min is not None else None,
        "delay_minutes": delay,
        "progress": 0.42,
        "vehicle": {"id": "veh_1", "registration": "RJ 20 GA 1234", "class": "reefer van"},
        "driver": {"id": "drv_1", "name": driver},
        "blocked_reason": None,
    }


class FakeLogistics:
    def __init__(self):
        self.calls = []

    def now(self):
        return NOW

    def list_shipments(self, district_id=None, facility_id=None, statuses=None, limit=50):
        self.calls.append(("list", district_id, facility_id, statuses))
        rows = [
            _summary("SHP-200101", "in_transit", "PHC Kota-4", 90),
            _summary("SHP-200102", "delayed", "CHC Kota-3", 200, delay=25, dest="kota_chc_3"),
        ]
        if statuses:
            rows = [r for r in rows if r["status"] in statuses]
        if facility_id:
            rows = [r for r in rows if r["destination"]["id"] == facility_id]
        return rows

    def get_shipment(self, shipment_id):
        if shipment_id != "SHP-200101":
            raise KeyError(shipment_id)
        return {
            **_summary("SHP-200101", "in_transit", "PHC Kota-4", 90),
            "events": [
                {"type": "departed", "title": "Departed District Drug Warehouse, Kota", "detail": None},
                {"type": "incident_started", "title": "Delay: Checkpost inspection (18 min)",
                 "detail": "Checkpost inspection"},
            ],
            "temperature": [{"at": _iso(-4), "temp_c": 4.44}, {"at": _iso(-2), "temp_c": 4.83}],
        }

    def latest_active_for_facility(self, facility_id):
        return _summary("SHP-200101", "in_transit", "PHC Kota-4", 90) if facility_id == "kota_phc_4" else None

    def fleet_status(self, district_id=None):
        return {
            "vehicles": {"available": 4, "in_transit": 3, "delayed": 1},
            "drivers_on_shift": 6,
            "queued": [{"id": "SHP-200110", "destination": {"name": "PHC Alwar-2"},
                        "blocked_reason": "No cold-chain vehicle free"}],
        }

    def facility_inbound(self, facility_id):
        return [_summary("SHP-200101", "in_transit", "PHC Kota-4", 90)] if facility_id == "kota_phc_4" else []

    def kpis(self, district_id=None):
        return {}


class FakeInsights:
    def state_summary(self, district_id=None):
        def d(did, idx, crit, stock, recs, rate):
            return {
                "district_id": did,
                "risk_counts": {"healthy": 3, "monitor": 1, "stress": 2, "critical": len(crit)},
                "risk_index": idx,
                "critical_facilities": crit,
                "stockout_items": stock,
                "bed_next_week_avg": 70.0 + idx / 10,
                "pending_recommendations": recs,
                "shipments_in_transit": 2,
                "on_time_rate_7d": rate,
            }

        ds = [
            d("district_kota", 62, [{"id": "kota_phc_4", "name": "PHC Kota-4"}], 3, 4, 0.9),
            d("district_alwar", 40, [], 1, 2, 0.95),
            d("district_bikaner", 55, [], 2, 3, 0.8),
            d("district_udaipur", 20, [], 0, 1, 0.99),
            d("district_jaipur_rural", 70, [], 4, 5, 0.85),
        ]
        if district_id:
            ds = [x for x in ds if x["district_id"] == district_id]
        return {
            "totals": {"facilities": 40, "risk_counts": {"healthy": 15, "monitor": 7, "stress": 8, "critical": 10},
                       "stockout_items": 10, "low_cover_items": 20, "pending_recommendations": 15,
                       "shipments_in_transit": 11, "on_time_rate_7d": 0.87},
            "districts": ds,
            "top_risks": [],
        }


@pytest.fixture
def tools():
    return v2.build_tool_functions(
        get_district_service(),
        get_forecast_service(),
        get_recommendation_service(),
        FakeLogistics(),
        FakeInsights(),
    )


def test_thirteen_tools_match_schema(tools):
    assert set(tools) == TOOL_NAMES
    assert len(tools) == 13


def test_schema_parameters_match_callable_signatures(tools):
    for spec in TOOL_SCHEMAS:
        fn = spec["function"]
        params = set(inspect.signature(tools[fn["name"]]).parameters)
        assert set(fn["parameters"]["properties"]) == params, fn["name"]
        assert set(fn["parameters"]["required"]) <= params


def test_llm_payloads_are_json_serialisable_and_small(tools):
    calls = {
        "get_state_briefing": {},
        "get_district_briefing": {"district": "Kota"},
        "find_facility": {"query": "Kota ka PHC chaar"},
        "get_facility_status": {"facility": "kota_phc_4"},
        "get_shortages": {},
        "compare_districts": {"metric": "risk_index"},
        "get_recommendations": {},
        "get_shipments": {},
        "get_shipment": {"shipment": "SHP-200101"},
        "get_fleet_status": {},
        "get_footfall_forecast": {"district": "Alwar"},
        "get_causal_chain": {"facility": "rural fourteen"},
        "get_performance": {},
    }
    assert set(calls) == set(tools)
    for name, args in calls.items():
        res = tools[name](**args)
        text = json.dumps(res.llm)
        assert "error" not in res.llm, (name, res.llm)
        assert len(text) < 6000, (name, len(text))
        # no raw internal ids for facilities in llm payloads
        assert "kota_phc_4" not in text, name


def test_state_briefing_names_districts_and_critical_facilities(tools):
    res = tools["get_state_briefing"]()
    kota = next(d for d in res.llm["districts"] if d["district"] == "Kota")
    assert kota["critical_facilities"] == ["PHC Kota-4"]
    assert kota["risk_index"] == 62
    assert kota["shipments_delayed"] == 1
    assert res.card["type"] == "ranking"
    assert res.card["rows"][0]["name"] == "Jaipur Rural"  # highest risk index first
    assert res.llm["state"]["on_time_rate_percent"] == 87


def test_district_briefing_accepts_spoken_and_hindi_names(tools):
    a = tools["get_district_briefing"]("Kota")
    b = tools["get_district_briefing"]("कोटा")
    assert a.llm["district"] == b.llm["district"] == "Kota"
    assert a.card["type"] == "district_summary"
    assert a.card["district_id"] == "district_kota"
    assert a.card["risk_index"] == 62
    assert a.llm["inbound_shipments"]["items"][0]["eta_in_minutes"] == 90
    assert len(a.llm["facilities"]) <= 8


def test_unknown_district_is_an_error_not_an_exception(tools):
    res = tools["get_district_briefing"]("Atlantis")
    assert "error" in res.llm
    assert "Kota" in res.llm["error"]


def test_find_facility_returns_scored_matches(tools):
    res = tools["find_facility"]("Kota ka PHC chaar")
    top = res.llm["matches"][0]
    assert top["name"] == "PHC Kota-4"
    assert top["district"] == "Kota"
    assert "match_score" in top and "risk" in top
    assert len(res.llm["matches"]) <= 3


def test_facility_status_has_medicines_beds_inbound_and_card(tools):
    res = tools["get_facility_status"]("PHC Kota-4")
    assert res.llm["facility"] == "PHC Kota-4"
    assert res.llm["district"] == "Kota"
    assert res.llm["risk"] == "critical"
    assert res.llm["medicines"][0]["days"] < 3
    assert res.llm["inbound_shipments"][0]["eta_in_minutes"] == 90
    assert res.card["type"] == "facility"
    assert res.card["facility_id"] == "kota_phc_4"


def test_facility_status_ambiguous_asks_for_clarification(tools):
    res = tools["get_facility_status"]("Kota")
    assert "error" in res.llm and res.llm["candidates"]
    assert res.card is None


def test_shortages_sorted_capped_and_filterable(tools):
    res = tools["get_shortages"]()
    days = [r["days"] for r in res.llm["rows"]]
    assert days == sorted(days)
    assert len(res.llm["rows"]) <= 8
    if res.llm["total"] > 8:
        assert res.llm["more"] == res.llm["total"] - 8
    assert res.card["type"] == "shortages"
    kota = tools["get_shortages"](district="Kota", medicine="ARV", max_days=3)
    assert kota.llm["medicine"] == "Anti-Rabies Vaccine (ARV)"
    assert all(r["district"] == "Kota" for r in kota.llm["rows"])
    assert any(r["facility"] == "PHC Kota-4" for r in kota.llm["rows"])


def test_shortages_unknown_medicine(tools):
    assert "error" in tools["get_shortages"](medicine="unobtainium").llm


def test_compare_districts_ranks_and_rejects_unknown_metric(tools):
    res = tools["compare_districts"]("risk_index")
    assert [r["district"] for r in res.llm["ranking"]][:2] == ["Jaipur Rural", "Kota"]
    assert res.card["type"] == "ranking" and res.card["metric"] == "risk_index"
    on_time = tools["compare_districts"]("on_time_rate")
    assert on_time.llm["ranking"][0]["district"] == "Bikaner"  # lowest first
    assert on_time.llm["ranking"][0]["value"] == 80.0
    assert "error" in tools["compare_districts"]("vibes").llm


def test_recommendations_are_read_only_rows(tools):
    res = tools["get_recommendations"](limit=3)
    assert len(res.llm["recommendations"]) <= 3
    for r in res.llm["recommendations"]:
        assert {"subject", "type", "facility", "district", "status"} <= set(r)
    assert res.llm["status"] == "pending"


def test_shipments_filter_and_accept_string_status(tools):
    res = tools["get_shipments"](district="Kota", status="delayed")
    assert [s["id"] for s in res.llm["shipments"]] == ["SHP-200102"]
    assert res.llm["shipments"][0]["delay_minutes"] == 25
    assert res.card["type"] == "shipments"
    assert res.card["rows"][0]["eta"] == _iso(200)
    by_fac = tools["get_shipments"](facility="PHC Kota-4")
    assert [s["id"] for s in by_fac.llm["shipments"]] == ["SHP-200101"]


def test_get_shipment_by_id_and_by_facility_name(tools):
    a = tools["get_shipment"]("SHP-200101")
    b = tools["get_shipment"]("PHC Kota-4")
    assert a.llm == b.llm
    assert a.llm["progress_percent"] == 42
    assert a.llm["eta_in_minutes"] == 90
    assert a.llm["delay_reason"] == "Checkpost inspection"
    assert a.llm["temperature_c"] == 4.8
    assert a.llm["driver"] == "Ramesh"
    assert a.llm["vehicle"] == "RJ 20 GA 1234 reefer van"
    assert a.llm["last_event"].startswith("Delay")
    assert a.card["type"] == "shipment" and a.card["progress"] == 42


def test_get_shipment_not_found_and_none_active(tools):
    assert "error" in tools["get_shipment"]("SHP-999999").llm
    assert "error" in tools["get_shipment"]("CHC Kota-3").llm


def test_fleet_status(tools):
    res = tools["get_fleet_status"]("Kota")
    assert res.llm["vehicles"]["in_transit"] == 3
    assert res.llm["drivers_on_shift"] == 6
    assert res.llm["queued"][0]["blocked_reason"] == "No cold-chain vehicle free"
    assert res.card["type"] == "fleet"


def test_footfall_causal_chain_and_performance(tools):
    ff = tools["get_footfall_forecast"]("Jaipur")
    assert len(ff.llm["next_7_days"]) == 7
    chain = tools["get_causal_chain"]("rural fourteen")
    assert chain.llm["facility"] == "PHC Rural-14"
    assert chain.llm["chain"]
    perf = tools["get_performance"](district="Alwar", worst_n=3)
    assert len(perf.llm["lowest_scores"]) == 3
    assert all(r["district"] == "Alwar" for r in perf.llm["lowest_scores"])


def test_logistics_tools_degrade_without_service():
    tools = v2.build_tool_functions(
        get_district_service(), get_forecast_service(), get_recommendation_service()
    )
    # deps stubs raise NotImplementedError until lane A merges, or return the real service after.
    res = tools["get_shipments"]()
    assert isinstance(res.llm, dict)


def test_gemini_wrappers_return_dicts_and_keep_signatures():
    wrappers = v2.build_tools(
        get_district_service(), get_forecast_service(), get_recommendation_service(),
        FakeLogistics(), FakeInsights(),
    )  # fmt: skip
    assert len(wrappers) == 13
    by_name = {w.__name__: w for w in wrappers}
    sig = inspect.signature(by_name["get_shortages"])
    assert list(sig.parameters) == ["district", "medicine", "max_days"]
    assert sig.return_annotation is dict
    assert by_name["get_shortages"].__doc__
    assert isinstance(by_name["get_district_briefing"](district="Kota"), dict)


def test_tool_labels():
    assert v2.tool_label("get_district_briefing", {"district": "Kota"}) == "Checking Kota district data"
    assert v2.tool_label("get_facility_status", {"facility": "kota phc 4"}) == "Checking PHC Kota-4"
    assert v2.tool_label("get_state_briefing") == "Reviewing all five districts"
    assert v2.tool_label("get_shipment") == "Tracking the shipment"
