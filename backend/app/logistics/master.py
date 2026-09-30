"""Logistics master data: warehouses, warehouse stock, fleet and crew (section 5.3)."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.logistics.models import Driver, Vehicle

MASTER_PATH = Path(__file__).resolve().parents[2] / "data" / "seed_logistics.json"
HISTORY_PATH = Path(__file__).resolve().parents[2] / "data" / "seed_logistics_history.json"
CENTRAL_ID = "wh_central"


@lru_cache
def load_master() -> dict[str, Any]:
    with open(MASTER_PATH, encoding="utf-8") as f:
        return json.load(f)


@lru_cache
def load_history() -> list[dict[str, Any]]:
    """Raw history rows (read-only, never mixed into live state)."""
    with open(HISTORY_PATH, encoding="utf-8") as f:
        return json.load(f)["shipments"]


def warehouses() -> list[dict[str, Any]]:
    return load_master()["warehouses"]


def warehouse(warehouse_id: str) -> dict[str, Any]:
    for w in warehouses():
        if w["id"] == warehouse_id:
            return w
    raise KeyError(warehouse_id)


def vehicles() -> list[Vehicle]:
    return [Vehicle.model_validate(v) for v in load_master()["vehicles"]]


def drivers() -> list[Driver]:
    return [Driver.model_validate(d) for d in load_master()["drivers"]]


def base_warehouse_stock() -> dict[tuple[str, str], dict[str, Any]]:
    """Seed stock rows keyed by `(warehouse_id, medicine_name)`."""
    return {(r["warehouse_id"], r["medicine_name"]): r for r in load_master()["warehouse_stock"]}


def ddw_for_district(district_id: str) -> str:
    return "ddw_" + district_id.removeprefix("district_")
