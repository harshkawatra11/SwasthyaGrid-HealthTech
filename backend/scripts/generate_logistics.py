"""Generates the synthetic logistics master data and 90-day history.

Outputs (deterministic, seed 20260926):
  backend/data/seed_logistics.json          warehouses, stock, vehicle classes, vehicles, drivers
  backend/data/seed_logistics_history.json  90 days of delivered and cancelled shipments

All figures are synthetic operational data for a demo, not statistics about
Rajasthan. Dates are absolute and anchored on REFERENCE_START (the scenario
start the data was generated for); history covers the 90 days before it.

The history needs road durations, so it is generated only when
data/routes.json is complete. Order of use:

  python scripts/generate_logistics.py     # master data (history skipped if no routes)
  python scripts/build_routes.py           # needs seed_logistics.json for warehouse locations
  python scripts/generate_logistics.py     # master data again (identical) plus history

Run from backend/.
"""

import json
import math
import os
import random
import string
import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("DATA_SOURCE", "seed")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.logistics.catalog import line_for, medicines

SEED = 20260926
DATA = ROOT / "data"
DISTRICTS_PATH = DATA / "seed_districts.json"
LOGISTICS_PATH = DATA / "seed_logistics.json"
HISTORY_PATH = DATA / "seed_logistics_history.json"
ROUTES_PATH = DATA / "routes.json"

# 2026-09-26 08:30 IST expressed in UTC.
REFERENCE_START = datetime(2026, 9, 26, 3, 0, tzinfo=UTC)
IST = timezone(timedelta(hours=5, minutes=30))
HISTORY_DAYS = 90

CENTRAL_ID = "wh_central"
CENTRAL_LOCATION = {"lat": 26.9196, "lng": 75.7878}

VEHICLE_CLASSES = [
    {"class": "van", "label": "Light van (0.75 t)", "capacity_kg": 750, "pallet_slots": 2,
     "cold_chain": False, "speed_factor": 1.25},
    {"class": "light_truck", "label": "Light truck (2.5 t)", "capacity_kg": 2500, "pallet_slots": 6,
     "cold_chain": False, "speed_factor": 1.35},
    {"class": "reefer_van", "label": "Refrigerated van (1.2 t, 2 to 8 C)", "capacity_kg": 1200,
     "pallet_slots": 3, "cold_chain": True, "speed_factor": 1.30},
    {"class": "medium_truck", "label": "Medium truck (7 t)", "capacity_kg": 7000, "pallet_slots": 12,
     "cold_chain": False, "speed_factor": 1.50},
    {"class": "reefer_truck", "label": "Refrigerated truck (3 t, 2 to 8 C)", "capacity_kg": 3000,
     "pallet_slots": 6, "cold_chain": True, "speed_factor": 1.45},
]
CLASS_BY_NAME = {c["class"]: c for c in VEHICLE_CLASSES}

MALE_NAMES = [
    "Rajesh", "Suresh", "Mahesh", "Ramesh", "Dinesh", "Mukesh", "Naresh", "Ashok", "Vijay", "Sanjay",
    "Anil", "Sunil", "Manoj", "Rakesh", "Deepak", "Vikram", "Amit", "Rohit", "Mohan", "Kailash",
    "Bhanwar", "Gopal", "Hanuman", "Kishan", "Lokesh", "Pankaj", "Ravi", "Sandeep", "Yogesh", "Jitendra",
]
FEMALE_NAMES = [
    "Sunita", "Anita", "Kavita", "Savita", "Rekha", "Geeta", "Seema", "Meena", "Pooja", "Neha",
    "Priya", "Anjali", "Sarita", "Kamla", "Manju", "Radha", "Laxmi", "Sushila", "Babita", "Poonam",
    "Rani", "Sapna", "Deepika", "Nirmala", "Shanti", "Mamta", "Champa", "Durga", "Indira", "Jyoti",
]
SURNAMES = [
    "Meena", "Gurjar", "Sharma", "Jat", "Rathore", "Solanki", "Bishnoi", "Choudhary", "Saini", "Verma",
    "Khan", "Singh", "Joshi", "Kumawat", "Prajapat", "Yadav", "Jain", "Swami", "Charan", "Bairwa",
]
SHIFTS_DAY = ["06:00-14:00", "14:00-22:00", "08:00-18:00"]
NIGHT_SHIFT = "22:00-06:00"

CANCEL_REASONS = ["Duplicate indent", "Facility received stock locally", "Vehicle breakdown before dispatch"]
DAILY_LAMBDA = {
    "district_jaipur_rural": 5,
    "district_alwar": 4,
    "district_bikaner": 3,
    "district_udaipur": 4,
    "district_kota": 4,
}
COLD_CHAIN_UNSTOCKED_DAYS = 40


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_districts() -> dict:
    with open(DISTRICTS_PATH, encoding="utf-8") as f:
        return json.load(f)


def ddw_id(district_id: str) -> str:
    return "ddw_" + district_id.removeprefix("district_")


def build_warehouses(districts: list[dict]) -> list[dict]:
    warehouses = [
        {
            "id": CENTRAL_ID,
            "name": "State Central Drug Warehouse, Jaipur",
            "type": "central",
            "district_id": "district_jaipur_rural",
            "location": dict(CENTRAL_LOCATION),
            "capacity_pallets": 400,
            "docks": 6,
            "cold_room": True,
        }
    ]
    for d in districts:
        warehouses.append(
            {
                "id": ddw_id(d["id"]),
                "name": f"District Drug Warehouse, {d['name'].removesuffix(' District')}",
                "type": "district",
                "district_id": d["id"],
                "location": {
                    "lat": round(d["center"]["lat"] + 0.012, 4),
                    "lng": round(d["center"]["lng"] + 0.012, 4),
                },
                "capacity_pallets": 120,
                "docks": 2,
                "cold_room": True,
            }
        )
    return warehouses


def build_warehouse_stock(rng: random.Random, seed: dict, warehouses: list[dict]) -> list[dict]:
    catalog = medicines()
    rows: list[dict] = []
    ddw_totals: dict[str, int] = {}
    for w in warehouses:
        if w["type"] != "district":
            continue
        fids = {f["id"] for f in seed["facilities"] if f["district_id"] == w["district_id"]}
        for name, m in catalog.items():
            total = sum(
                s["avg_daily_consumption"]
                for s in seed["medicine_stock"]
                if s["facility_id"] in fids and s["medicine_name"] == name
            )
            units = round(30 * total) if total else 40 * m["base_daily_consumption"]
            ddw_totals[name] = ddw_totals.get(name, 0) + units
            rows.append({"warehouse_id": w["id"], "medicine_name": name, "units": units})
    for name in catalog:
        rows.append({"warehouse_id": CENTRAL_ID, "medicine_name": name, "units": 5 * ddw_totals[name]})

    ddw_rows = [i for i, r in enumerate(rows) if r["warehouse_id"] != CENTRAL_ID]
    expiring_soon = set(rng.sample(ddw_rows, 2))
    for i, r in enumerate(rows):
        days = rng.randint(10, 44) if i in expiring_soon else rng.randint(180, 720)
        made = REFERENCE_START - timedelta(days=rng.randint(30, 180))
        r["batch_no"] = f"B{made:%y}{made:%m}{i % 100:02d}"
        r["expiry_date"] = (REFERENCE_START + timedelta(days=days)).strftime("%Y-%m-%d")
    return rows


def build_vehicles(rng: random.Random, warehouses: list[dict], districts: list[dict]) -> list[dict]:
    rto = {d["id"]: d["rto_code"] for d in districts}
    plan: list[tuple[dict, str]] = []
    for w in warehouses:
        if w["type"] == "central":
            plan += [(w, "medium_truck")] * 4 + [(w, "reefer_truck")] * 2
        else:
            plan += [(w, "van")] * 2 + [(w, "light_truck")] * 2 + [(w, "reefer_van")]

    used: set[str] = set()
    vehicles = []
    for w, cls_name in plan:
        code = rto[w["district_id"]]
        while True:
            reg = f"{code} G{rng.choice(string.ascii_uppercase)} {rng.randint(1000, 9999)}"
            vid = reg.replace(" ", "")
            if vid not in used:
                used.add(vid)
                break
        cls = CLASS_BY_NAME[cls_name]
        vehicles.append(
            {
                "id": vid,
                "registration": reg,
                "class": cls_name,
                "label": cls["label"],
                "capacity_kg": cls["capacity_kg"],
                "pallet_slots": cls["pallet_slots"],
                "cold_chain": cls["cold_chain"],
                "home_warehouse_id": w["id"],
                "district_id": w["district_id"],
                "odometer_km": rng.randint(12000, 180000),
                "km_since_service": rng.randint(0, 16000),
                "service_interval_km": 15000,
                "fuel_pct": rng.randint(35, 95),
                "status": "available",
            }
        )

    ddw_vehicles = [v for v in vehicles if v["home_warehouse_id"] != CENTRAL_ID]
    van = rng.choice([v for v in ddw_vehicles if v["class"] == "van"])
    truck = rng.choice(
        [v for v in ddw_vehicles if v["class"] == "light_truck" and v["district_id"] != van["district_id"]]
    )
    van["status"] = "maintenance"
    truck["status"] = "maintenance"
    return vehicles


def build_drivers(rng: random.Random, warehouses: list[dict], districts: list[dict]) -> list[dict]:
    rto = {d["id"]: d["rto_code"] for d in districts}
    firsts = MALE_NAMES + FEMALE_NAMES
    used_names: set[str] = set()
    drivers = []
    n = 0
    for w in warehouses:
        count = 5 if w["type"] == "central" else 7
        shifts = [NIGHT_SHIFT] + [rng.choice(SHIFTS_DAY) for _ in range(count - 1)]
        rng.shuffle(shifts)
        for shift in shifts:
            while True:
                name = f"{rng.choice(firsts)} {rng.choice(SURNAMES)}"
                if name not in used_names:
                    used_names.add(name)
                    break
            n += 1
            code = rto[w["district_id"]]
            year = rng.randint(2008, 2022)
            languages = ["Hindi", "Rajasthani"] + (["English"] if rng.random() < 0.3 else [])
            drivers.append(
                {
                    "id": f"drv_{n:03d}",
                    "name": name,
                    "phone_masked": f"+91 9xxxx x{rng.randint(0, 9999):04d}",
                    "license_masked": f"{code} {year} ●●●●{rng.randint(0, 999):03d}",
                    "license_expiry": f"{rng.randint(2027, 2032)}-{rng.randint(1, 12):02d}-28",
                    "home_warehouse_id": w["id"],
                    "shift": shift,
                    "rating": round(rng.uniform(3.9, 4.9), 1),
                    "years_experience": rng.randint(2, 24),
                    "languages": languages,
                }
            )
    return drivers


def build_master(seed: dict) -> dict:
    rng = random.Random(SEED)
    warehouses = build_warehouses(seed["districts"])
    return {
        "_meta": {
            "seed": SEED,
            "reference_start": iso(REFERENCE_START),
            "note": "Simulated operational data. Synthetic, not real statistics.",
        },
        "warehouses": warehouses,
        "warehouse_stock": build_warehouse_stock(rng, seed, warehouses),
        "vehicle_classes": VEHICLE_CLASSES,
        "vehicles": build_vehicles(rng, warehouses, seed["districts"]),
        "drivers": build_drivers(rng, warehouses, seed["districts"]),
    }


# ---------------------------------------------------------------- history


def poisson(rng: random.Random, lam: float) -> int:
    limit = math.exp(-lam)
    k = 0
    p = 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def load_routes() -> dict | None:
    if not ROUTES_PATH.exists():
        return None
    with open(ROUTES_PATH, encoding="utf-8") as f:
        return json.load(f)["routes"]


def build_history(seed: dict, master: dict, routes: dict) -> list[dict]:
    from app.repositories.district_repository import DistrictRepository
    from app.services.forecast_service import ForecastService

    rng = random.Random(SEED + 1)
    repo = DistrictRepository(DISTRICTS_PATH)
    forecast = ForecastService(repo)
    catalog = medicines()

    stressed = {
        f["id"]: forecast.facility_risk_level(f["id"]) in ("stress", "critical") for f in seed["facilities"]
    }
    consumption: dict[tuple[str, str], int] = {
        (s["facility_id"], s["medicine_name"]): s["avg_daily_consumption"] for s in seed["medicine_stock"]
    }
    facs_by_district: dict[str, list[dict]] = {}
    for f in seed["facilities"]:
        facs_by_district.setdefault(f["district_id"], []).append(f)

    vehicles_by_wh: dict[str, list[dict]] = {}
    for v in master["vehicles"]:
        if v["status"] == "available":
            vehicles_by_wh.setdefault(v["home_warehouse_id"], []).append(v)
    drivers_by_wh: dict[str, list[dict]] = {}
    for d in master["drivers"]:
        drivers_by_wh.setdefault(d["home_warehouse_id"], []).append(d)

    med_names = list(catalog)
    rows: list[dict] = []

    def make_shipment(day: datetime, district_id: str, origin: str, dest: str, items: list[dict], kind: str) -> None:
        lines = [line_for(i["medicine_name"], i["units"]) for i in items]
        weight = round(sum(line.weight_kg for line in lines), 1)
        pallets = sum(line.pallet_slots for line in lines)
        cold = any(line.cold_chain for line in lines)
        pool = [
            v for v in vehicles_by_wh[origin]
            if v["capacity_kg"] >= weight and v["pallet_slots"] >= pallets and (v["cold_chain"] or not cold)
        ] or vehicles_by_wh[origin]
        vehicle = rng.choice(pool)
        driver = rng.choice(drivers_by_wh[origin])
        priority = "critical" if (kind == "replenishment" and stressed.get(dest)) else "normal"
        if kind == "replenishment" and priority == "normal" and rng.random() < 0.25:
            priority = "high"

        minute = rng.uniform(7 * 60, 15 * 60)
        created = (day.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=minute)).astimezone(
            UTC
        )
        route = routes[f"{origin}->{dest}"]
        factor = CLASS_BY_NAME[vehicle["class"]]["speed_factor"]
        planned = round(route["duration_s"] / 60 * factor, 1)
        loading = min(45, 12 + 6 * pallets)
        departed = created + timedelta(minutes=loading)
        row = {
            "id": f"SHP-{100000 + len(rows)}",
            "district_id": district_id,
            "origin_id": origin,
            "destination_id": dest,
            "kind": kind,
            "priority": priority,
            "created_at": iso(created),
            "departed_at": None,
            "arrived_at": None,
            "delivered_at": None,
            "status": "delivered",
            "planned_minutes": planned,
            "actual_minutes": None,
            "on_time": None,
            "weight_kg": weight,
            "pallet_slots": pallets,
            "cold_chain": cold,
            "items": [{"medicine_name": i["medicine_name"], "units": i["units"]} for i in items],
            "vehicle_id": vehicle["id"],
            "driver_id": driver["id"],
        }
        if rng.random() < 0.03:
            row["status"] = "cancelled"
            row["cancel_reason"] = rng.choice(CANCEL_REASONS)
        else:
            actual = round(planned * min(1.8, max(0.9, rng.gauss(1.12, 0.12))), 1)
            arrived = departed + timedelta(minutes=actual)
            row["departed_at"] = iso(departed)
            row["arrived_at"] = iso(arrived)
            row["delivered_at"] = iso(arrived + timedelta(minutes=rng.randint(5, 40)))
            row["actual_minutes"] = actual
            row["on_time"] = actual <= planned * 1.15
        rows.append(row)

    ref_day = REFERENCE_START.astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    for offset in range(HISTORY_DAYS, 0, -1):
        day = ref_day - timedelta(days=offset)
        for district_id, lam in DAILY_LAMBDA.items():
            mult = 0.4 if day.weekday() == 6 else 1.0
            uptick = offset <= 30
            n = poisson(rng, lam * mult)
            facs = facs_by_district[district_id]
            weights = [2 if stressed[f["id"]] else 1 for f in facs]
            origin = ddw_id(district_id)
            for _ in range(n):
                dest = rng.choices(facs, weights=weights)[0]["id"]
                items = []
                for name in rng.sample(med_names, rng.randint(1, 3)):
                    per_day = consumption.get((dest, name), catalog[name]["base_daily_consumption"])
                    units = round(per_day * rng.uniform(20, 40))
                    if uptick and name in ("Paracetamol", "ORS"):
                        units = round(units * 1.1)
                    items.append({"medicine_name": name, "units": max(1, units)})
                make_shipment(day, district_id, origin, dest, items, "replenishment")
            if offset % 6 == 0:
                items = []
                for name in rng.sample(med_names, 3):
                    fids = {f["id"] for f in facs}
                    total = sum(v for (fid, m), v in consumption.items() if fid in fids and m == name)
                    per_day = total or catalog[name]["base_daily_consumption"]
                    items.append({"medicine_name": name, "units": max(1, round(per_day * 30))})
                make_shipment(day, district_id, CENTRAL_ID, origin, items, "restock")
    rows.sort(key=lambda r: r["created_at"])
    for i, r in enumerate(rows):
        r["id"] = f"SHP-{100000 + i}"
    return rows


def main() -> None:
    seed = load_districts()
    master = build_master(seed)
    assert len(master["warehouses"]) == 6
    assert len(master["vehicles"]) == 31
    assert len(master["drivers"]) == 40
    with open(LOGISTICS_PATH, "w", encoding="utf-8") as f:
        json.dump(master, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Wrote {LOGISTICS_PATH.name}: {len(master['warehouses'])} warehouses, "
          f"{len(master['warehouse_stock'])} stock rows, {len(master['vehicles'])} vehicles, "
          f"{len(master['drivers'])} drivers.")

    routes = load_routes()
    if routes is None:
        print("routes.json missing: history skipped. Run build_routes.py, then re-run this script.")
        return
    history = build_history(seed, master, routes)
    out = {
        "_meta": {
            "seed": SEED + 1,
            "reference_start": iso(REFERENCE_START),
            "days": HISTORY_DAYS,
            "note": "Simulated operational data. Synthetic, not real statistics.",
        },
        "shipments": history,
    }
    with open(HISTORY_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    cancelled = sum(1 for r in history if r["status"] == "cancelled")
    print(f"Wrote {HISTORY_PATH.name}: {len(history)} shipments ({cancelled} cancelled), "
          f"{HISTORY_PATH.stat().st_size / 1024:.0f} KB.")


if __name__ == "__main__":
    main()
