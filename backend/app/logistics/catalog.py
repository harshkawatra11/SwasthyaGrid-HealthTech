"""Medicine catalogue and per-line shipment maths (section 5.2)."""

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.logistics.models import ShipmentLine

CATALOG_PATH = Path(__file__).resolve().parents[2] / "data" / "medicine_catalog.json"


@lru_cache
def _load() -> dict[str, Any]:
    with open(CATALOG_PATH, encoding="utf-8") as f:
        return json.load(f)


def medicines() -> dict[str, dict[str, Any]]:
    """Catalogue rows keyed by medicine name."""
    return {m["name"]: m for m in _load()["medicines"]}


def medicine(medicine_name: str) -> dict[str, Any]:
    try:
        return medicines()[medicine_name]
    except KeyError:
        raise KeyError(f"Unknown medicine: {medicine_name}") from None


def line_for(medicine_name: str, units: int) -> ShipmentLine:
    """Derive cartons, weight, pallet slots and cold chain for `units` of a medicine."""
    if units <= 0:
        raise ValueError("units must be positive")
    m = medicine(medicine_name)
    cartons = math.ceil(units / m["units_per_carton"])
    weight_kg = units * m["unit_weight_kg"] + cartons * _load()["packaging_kg_per_carton"]
    pallet_slots = max(1, math.ceil(cartons / m["cartons_per_pallet"]))
    return ShipmentLine(
        medicine_name=medicine_name,
        units=units,
        cartons=cartons,
        weight_kg=round(weight_kg, 3),
        pallet_slots=pallet_slots,
        cold_chain=bool(m["cold_chain"]),
    )
