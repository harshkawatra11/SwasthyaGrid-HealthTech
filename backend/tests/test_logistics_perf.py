"""Tick budget regression tests (Appendix E R5): the world must stay cheap as it grows."""

import statistics
import time
from datetime import timedelta

from app.logistics.models import Stop
from tests.test_logistics_service import ARV, T0, kota_shipment, make_service


def _bulk(svc, queued: int, terminal: int) -> None:
    """Fill the state with `terminal` delivered shipments and `queued` approved, unassigned ones."""
    donor = kota_shipment(svc)
    from app.logistics import planner

    result = planner.assign(donor, T0 - timedelta(days=2), svc.fleet_state())
    assert not isinstance(result, planner.BlockedReason)
    plan = result
    donor.status = "cancelled"  # keep the donor out of the way (it stays a terminal row)
    for i in range(terminal):
        s = svc.build_shipment(
            kind="routine",
            district_id="district_kota",
            origin_id="ddw_kota",
            stops=[Stop(node_id="kota_phc_4", node_kind="facility", purpose="dropoff")],
            lines=[("Paracetamol", 50)],
            priority="normal",
            created_at=T0 - timedelta(hours=3),
        )
        s.status = "delivered"
        s.approved_at = T0 - timedelta(hours=3)
        s.trip = plan
    for i in range(queued):
        s = svc.build_shipment(
            kind="replenishment",
            district_id="district_kota",
            origin_id="ddw_kota",
            stops=[Stop(node_id="kota_phc_4", node_kind="facility", purpose="dropoff")],
            lines=[(ARV, 5)],
            priority=("critical", "high", "normal")[i % 3],
            created_at=T0 + timedelta(seconds=i),
        )
        s.status = "approved"
        s.approved_at = T0
        s.origin_id = "ddw_kota"


def _median_tick_seconds(svc, ticks: int = 7) -> float:
    svc.planner_interval = 0.0  # force a planner pass on every tick
    svc.tick(T0 + timedelta(minutes=1))  # warm up (recommendation refresh, index build)
    svc.tick(T0 + timedelta(minutes=2))
    samples = []
    for i in range(ticks):
        now = T0 + timedelta(minutes=3 + i)
        t = time.perf_counter()
        svc.tick(now)
        samples.append(time.perf_counter() - t)
    return statistics.median(samples)


def test_tick_stays_under_100ms_with_2000_shipments():
    svc, _ = make_service(background=False)
    _bulk(svc, queued=50, terminal=1950)
    assert len(svc.state.shipments) >= 2000
    assert _median_tick_seconds(svc) < 0.1


def test_a_600_strong_queue_does_not_slow_the_tick():
    small, _ = make_service(background=False)
    _bulk(small, queued=50, terminal=1400)
    baseline = _median_tick_seconds(small)

    big, _ = make_service(background=False)
    _bulk(big, queued=600, terminal=1400)
    loaded = _median_tick_seconds(big)
    assert loaded <= 3 * max(baseline, 0.005), (baseline, loaded)


def test_metrics_report_tick_time_and_counts():
    svc, _ = make_service(background=False)
    _bulk(svc, queued=8, terminal=20)
    svc.tick(T0 + timedelta(minutes=1))
    m = svc.metrics_snapshot()
    assert m["queued"] >= 1 and m["active"] >= m["queued"]
    assert m["tick_ms"]["last"] >= 0 and m["tick_ms"]["p95"] >= m["tick_ms"]["last"] * 0
    assert m["tick_ms"]["samples"] == 1


def test_slow_ticks_log_a_warning(caplog, monkeypatch):
    svc, _ = make_service(background=False)
    monkeypatch.setattr("app.logistics.service.TICK_WARN_MS", -1.0)
    with caplog.at_level("WARNING", logger="swasthyagrid"):
        svc.tick(T0 + timedelta(minutes=1))
    assert any("logistics tick took" in r.message for r in caplog.records)
