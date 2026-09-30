"""Export the offline fixtures the frontend hooks fall back to (plan 9.1, task A10).

Runs the real app in process (no network, no Sarvam, seed data, tick loop off) with the
simulation clock frozen at scenario start + 2 hours, calls every hook endpoint for scope
`all`, validates each body with its pydantic model where one exists, and writes
`frontend/src/data/fixtures/<path with /api/v1/ removed and / replaced by __>.json`.

Usage (from backend/): python scripts/export_frontend_fixtures.py
"""

import json
import os
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ.update(
    {
        "DATA_SOURCE": "seed",
        "LOGISTICS_TICK": "false",
        "SARVAM_API_KEY": "",
        "GEMINI_API_KEY": "",
        "LOGISTICS_STATE_PATH": str(Path(tempfile.mkdtemp()) / "state.json"),
    }
)

OUT_DIR = BACKEND.parent / "frontend" / "src" / "data" / "fixtures"
SCENARIO_START = datetime(2026, 9, 26, 3, 0, tzinfo=UTC)  # 08:30 IST, the history anchor
SIM_AT = SCENARIO_START + timedelta(hours=2)


def fixture_name(path: str) -> str:
    return path.removeprefix("/api/v1/").replace("/", "__")


def main() -> int:
    from fastapi.testclient import TestClient

    from app.api import deps
    from app.main import app
    from app.schemas import insights as si
    from app.schemas import logistics as sl
    from app.schemas import recommendation as sr

    _, logistics = deps._world()
    logistics._forced_start = SCENARIO_START
    logistics.boot()
    logistics.clock.reanchor(SIM_AT)
    frozen = logistics.clock.anchor_real
    logistics.clock.time_fn = lambda: frozen  # the world stays at start + 2 h
    logistics.tick(SIM_AT)

    models = {
        "/api/v1/insights/state-summary": si.StateSummary,
        "/api/v1/insights/facility-matrix": si.FacilityMatrix,
        "/api/v1/insights/medicine-matrix": si.MedicineMatrix,
        "/api/v1/insights/briefing": si.Briefing,
        "/api/v1/recommendations": sr.RecommendationList,
        "/api/v1/logistics/clock": sl.ClockState,
        "/api/v1/logistics/kpis": sl.LogisticsKpis,
        "/api/v1/logistics/series/volume": sl.VolumeSeries,
        "/api/v1/logistics/status-breakdown": sl.StatusBreakdown,
        "/api/v1/logistics/shipments": sl.ShipmentList,
        "/api/v1/logistics/vehicles": sl.VehicleList,
        "/api/v1/logistics/drivers": sl.DriverList,
        "/api/v1/logistics/warehouses": sl.WarehouseList,
        "/api/v1/logistics/schedule": sl.ScheduleResponse,
        "/api/v1/logistics/positions": sl.PositionsResponse,
    }
    requests = [
        "/api/v1/districts",
        "/api/v1/facilities",
        "/api/v1/insights/state-summary",
        "/api/v1/insights/facility-matrix",
        "/api/v1/insights/medicine-matrix",
        "/api/v1/insights/briefing",
        "/api/v1/medicines",
        "/api/v1/footfall/forecast",
        "/api/v1/beds/forecast",
        "/api/v1/doctors/attendance",
        "/api/v1/diagnostics",
        "/api/v1/alerts",
        "/api/v1/performance",
        "/api/v1/recommendations",
        "/api/v1/logistics/clock",
        "/api/v1/logistics/kpis",
        "/api/v1/logistics/series/volume",
        "/api/v1/logistics/status-breakdown",
        "/api/v1/logistics/shipments?limit=500",
        "/api/v1/logistics/vehicles",
        "/api/v1/logistics/drivers",
        "/api/v1/logistics/warehouses",
        "/api/v1/logistics/schedule",
        "/api/v1/logistics/positions",
    ]
    client = TestClient(app)
    districts = client.get("/api/v1/districts").json()["districts"]
    requests += [f"/api/v1/footfall/forecast?district_id={d['id']}" for d in districts]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for request in requests:
        path, _, query = request.partition("?")
        res = client.get(request)
        if res.status_code != 200:
            print(f"FAILED {request}: {res.status_code} {res.text[:200]}")
            return 1
        body = res.json()
        model = models.get(path)
        if model is not None:
            model.model_validate(body)
        name = fixture_name(path)
        if path == "/api/v1/footfall/forecast" and query:
            name += "__" + query.split("=", 1)[1]
        target = OUT_DIR / f"{name}.json"
        target.write_text(json.dumps(body, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        written.append((target.name, target.stat().st_size, model is not None))

    for name, size, validated in written:
        print(f"{name:52s} {size / 1024:8.1f} KB  {'validated' if validated else 'json only'}")
    print(f"Wrote {len(written)} fixtures to {OUT_DIR} at sim time {SIM_AT.isoformat()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
