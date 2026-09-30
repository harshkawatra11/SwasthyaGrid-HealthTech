"""Generates backend/data/seed_districts.json: five Rajasthan districts, forty
facilities in total, in the shape DistrictRepository/ForecastService expect.

Deterministic: a fixed random seed means re-running this script reproduces the
same file byte for byte (modulo dict key order), so it is reviewable in a diff
rather than being a one-time hand-edit. This is a clearly synthetic operations
dataset for a demo district-health control room, not a claim about any real
district's actual medicine stock or staffing.

The original eight Jaipur Rural facilities and their exact numbers are kept
verbatim, so nothing already demoed against them changes.

Run from backend/: python scripts/generate_districts.py
"""

import json
import random
from pathlib import Path

random.seed(20260913)

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_PATH = ROOT / "data" / "fixtures" / "jaipur_rural_original.json"
NEW_SEED_PATH = ROOT / "data" / "seed_districts.json"

MEDICINE_CATALOG = [
    "Paracetamol",
    "ORS",
    "Anti-Snake Venom (ASV)",
    "Anti-Rabies Vaccine (ARV)",
    "Oxytocin",
    "Adrenaline (Epinephrine)",
    "Tetanus Toxoid (TT)",
]

# Consumption rate is per medicine, so "stock 60 against a base of 18/day" reads
# the same shape across every district, not a random number attached to a
# random name.
BASE_DAILY_CONSUMPTION = {
    "Paracetamol": 15,
    "ORS": 17,
    "Anti-Snake Venom (ASV)": 2,
    "Anti-Rabies Vaccine (ARV)": 5,
    "Oxytocin": 5,
    "Adrenaline (Epinephrine)": 2,
    "Tetanus Toxoid (TT)": 7,
}

DOCTOR_NAMES = [
    "Dr. Kavita Sharma", "Dr. Rajesh Meena", "Dr. Priya Chundawat", "Dr. Sanjay Bishnoi",
    "Dr. Anjali Rathore", "Dr. Vikram Solanki", "Dr. Neha Gurjar", "Dr. Mohit Jangid",
]
SPECIALTIES = ["General Physician", "General Physician", "Gynaecologist", "Pediatrician"]

# Real district centers; facilities are placed on a small jitter grid around
# each one so the map view is spread out rather than stacked on one point.
DISTRICTS = [
    {
        "id": "district_alwar",
        "name": "Alwar District",
        "state": "Rajasthan",
        "center": (27.5530, 76.6346),
        "facility_prefix": "alwar",
        "rto_code": "RJ02",
        "hq_city": "Alwar",
    },
    {
        "id": "district_bikaner",
        "name": "Bikaner District",
        "state": "Rajasthan",
        "center": (28.0229, 73.3119),
        "facility_prefix": "bikaner",
        "rto_code": "RJ07",
        "hq_city": "Bikaner",
    },
    {
        "id": "district_udaipur",
        "name": "Udaipur District",
        "state": "Rajasthan",
        "center": (24.5854, 73.7125),
        "facility_prefix": "udaipur",
        "rto_code": "RJ27",
        "hq_city": "Udaipur",
    },
    {
        "id": "district_kota",
        "name": "Kota District",
        "state": "Rajasthan",
        "center": (25.2138, 75.8648),
        "facility_prefix": "kota",
        "rto_code": "RJ20",
        "hq_city": "Kota",
    },
]

FACILITY_PLAN = [
    ("PHC", 18), ("PHC", 22), ("CHC", 55), ("PHC", 20),
    ("PHC", 24), ("CHC", 60), ("PHC", 20), ("PHC", 26),
]

CAUSAL_NARRATIVES = [
    ("Rainfall across the district", "Waterlogging near {facility}", "Vector-borne case cluster reported",
     "Higher fever-case footfall"),
    ("Heatwave advisory issued", "Crop-harvest labour influx near {facility}", "Heatstroke admissions rising",
     "Higher emergency-case footfall"),
    ("Seasonal festival travel", "Crowd density increase near {facility}", "Road-injury cases reported",
     "Higher trauma-case footfall"),
    ("Cold wave across the region", "Respiratory complaints near {facility}", "Pediatric OPD cluster reported",
     "Higher pediatric footfall"),
]


def load_original() -> dict:
    with open(ORIGINAL_PATH, encoding="utf-8") as f:
        return json.load(f)


def jitter(center: tuple[float, float], i: int) -> tuple[float, float]:
    lat, lng = center
    return (
        round(lat + random.uniform(-0.18, 0.18), 4),
        round(lng + random.uniform(-0.18, 0.18), 4),
    )


def build_facility_id(prefix: str, kind: str, idx: int) -> str:
    return f"{prefix}_{kind.lower()}_{idx}"


def dedupe_stock(rows: list[dict]) -> list[dict]:
    """Keep only the lowest-stock row per (facility_id, medicine_name).

    Runs after all random draws so the generator's sequence is unchanged. The
    forced-shortage branch can pick a medicine the facility already carries; the
    shortage row is the one that must survive.
    """
    lowest: dict[tuple[str, str], int] = {}
    for i, row in enumerate(rows):
        key = (row["facility_id"], row["medicine_name"])
        if key not in lowest or row["units_remaining"] < rows[lowest[key]]["units_remaining"]:
            lowest[key] = i
    keep = set(lowest.values())
    return [row for i, row in enumerate(rows) if i in keep]


def generate_district(district: dict) -> dict:
    prefix = district["facility_prefix"]
    facilities = []
    medicine_stock = []
    beds = []
    doctors = []
    diagnostics = []
    demand_factors = {}

    for idx, (kind, beds_total) in enumerate(FACILITY_PLAN, start=1):
        fid = build_facility_id(prefix, kind, idx)
        lat, lng = jitter(district["center"], idx)
        facilities.append(
            {
                "id": fid,
                "district_id": district["id"],
                "name": f"{kind} {district['name'].split()[0]}-{idx}",
                "type": kind,
                "lat": lat,
                "lng": lng,
                "beds_total": beds_total,
            }
        )

        # Every fourth facility across the district gets a critical
        # (days_remaining < 3) shortage on one of the emergency medicines
        # carried forward from the Jaipur Rural pattern (ASV/ARV/Oxytocin/
        # Adrenaline/TT), so roughly a quarter of the state's facilities read
        # critical or stress, matching the plan's target distribution.
        emergency_meds = MEDICINE_CATALOG[2:]
        n_meds = random.randint(1, 3)
        chosen = random.sample(MEDICINE_CATALOG, n_meds)
        for med_idx, med in enumerate(chosen):
            base_consumption = BASE_DAILY_CONSUMPTION[med]
            consumption = max(1, round(base_consumption * random.uniform(0.7, 1.3)))
            if idx % 4 == 0 and med_idx == 0:
                # Force a critical emergency-medicine shortage on this facility.
                med = random.choice(emergency_meds)
                consumption = max(1, round(BASE_DAILY_CONSUMPTION[med] * random.uniform(0.8, 1.2)))
                units = round(consumption * random.uniform(1.0, 2.5))
            elif idx % 5 == 0 and med_idx == 0:
                # A second, milder (medium-risk) shortage pattern.
                units = round(consumption * random.uniform(3.0, 5.5))
            else:
                units = round(consumption * random.uniform(6.0, 45.0))
            medicine_stock.append(
                {
                    "facility_id": fid,
                    "medicine_name": med,
                    "units_remaining": int(units),
                    "avg_daily_consumption": int(consumption),
                    "reorder_threshold_days": 5,
                }
            )

        occupied = round(beds_total * random.uniform(0.4, 0.95))
        predicted_tomorrow = min(99, round(occupied / beds_total * 100 + random.uniform(-3, 12)))
        predicted_next_week = min(99, round(predicted_tomorrow + random.uniform(-2, 10)))
        beds.append(
            {
                "facility_id": fid,
                "occupied": int(occupied),
                "predicted_occupancy_tomorrow_pct": int(predicted_tomorrow),
                "predicted_occupancy_next_week_pct": int(predicted_next_week),
            }
        )

        if idx in (1, 4):
            high_risk = idx == 1
            doctors.append(
                {
                    "facility_id": fid,
                    "doctor_id": f"{fid}_doc",
                    "doctor_name": random.choice(DOCTOR_NAMES),
                    "specialty": random.choice(SPECIALTIES),
                    "absence_pattern": "5 consecutive Mondays" if high_risk else None,
                    "risk_level": "high" if high_risk else "low",
                    "patient_delay_pct": random.randint(30, 42) if high_risk else random.randint(2, 8),
                }
            )

        if idx in (2, 6):
            broken = idx == 6
            diagnostics.append(
                {
                    "facility_id": fid,
                    "test_name": "X-Ray" if broken else "Blood Test",
                    "status": "machine_failure" if broken else "available",
                    "nearest_alternative_facility_id": (
                        build_facility_id(prefix, "CHC", 3) if broken else None
                    ),
                    "distance_km": random.randint(3, 9) if broken else None,
                }
            )

        if idx % 4 == 0:
            demand_factors[fid] = [
                "Rain forecast increasing fever cases districtwide",
                f"Recent disease-cluster trend near {facilities[-1]['name']}",
                "Projected seasonal demand increase next 5 days",
            ]

    causal_facility = facilities[0]
    trigger, local, cluster, footfall = random.choice(CAUSAL_NARRATIVES)
    causal_chain = {
        "facility_id": causal_facility["id"],
        "headline": "Why medicine demand increased this week",
        "chain": [trigger, local.format(facility=causal_facility["name"]), cluster, footfall],
    }

    base_footfall = random.randint(150, 230)
    footfall_forecast = []
    for i, day in enumerate(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]):
        predicted = base_footfall + random.randint(-15, 25) + i * random.randint(0, 4)
        entry = {"day": day, "predicted": predicted}
        if day not in ("Sat", "Sun"):
            entry = {"day": day, "actual": predicted - random.randint(-8, 8), "predicted": predicted}
        footfall_forecast.append(entry)

    total_tomorrow = footfall_forecast[3]["predicted"]
    footfall_breakdown_tomorrow = {
        "children": round(total_tomorrow * 0.19),
        "women": round(total_tomorrow * 0.30),
        "elderly": round(total_tomorrow * 0.20),
        "emergency": round(total_tomorrow * 0.10),
        "general": round(total_tomorrow * 0.21),
    }

    return {
        "district": {
            "id": district["id"],
            "name": district["name"],
            "state": district["state"],
            "center": {"lat": district["center"][0], "lng": district["center"][1]},
            "rto_code": district["rto_code"],
            "hq_city": district["hq_city"],
        },
        "facilities": facilities,
        "medicine_stock": dedupe_stock(medicine_stock),
        "beds": beds,
        "doctors": doctors,
        "diagnostics": diagnostics,
        "footfall_forecast": footfall_forecast,
        "footfall_breakdown_tomorrow": footfall_breakdown_tomorrow,
        "causal_chain": causal_chain,
        "demand_factors": demand_factors,
    }


def main() -> None:
    original = load_original()
    jaipur_facilities = [{**f, "district_id": original["district"]["id"]} for f in original["facilities"]]
    jaipur_center = {
        "lat": round(sum(f["lat"] for f in jaipur_facilities) / len(jaipur_facilities), 4),
        "lng": round(sum(f["lng"] for f in jaipur_facilities) / len(jaipur_facilities), 4),
    }
    jaipur = {
        "district": {**original["district"], "center": jaipur_center, "rto_code": "RJ14", "hq_city": "Jaipur"},
        "facilities": jaipur_facilities,
        "medicine_stock": original["medicine_stock"],
        "beds": original["beds"],
        "doctors": original["doctors"],
        "diagnostics": original["diagnostics"],
        "footfall_forecast": original["footfall_forecast"],
        "footfall_breakdown_tomorrow": original["footfall_breakdown_tomorrow"],
        "causal_chain": original["causal_chain"],
        "demand_factors": original.get("demand_factors", {}),
    }

    generated = [generate_district(d) for d in DISTRICTS]
    all_districts = [jaipur] + generated

    out = {
        "districts": [d["district"] for d in all_districts],
        "facilities": [f for d in all_districts for f in d["facilities"]],
        "medicine_stock": [m for d in all_districts for m in d["medicine_stock"]],
        "beds": [b for d in all_districts for b in d["beds"]],
        "doctors": [doc for d in all_districts for doc in d["doctors"]],
        "diagnostics": [dg for d in all_districts for dg in d["diagnostics"]],
        "footfall_forecast": {d["district"]["id"]: d["footfall_forecast"] for d in all_districts},
        "footfall_breakdown_tomorrow": {
            d["district"]["id"]: d["footfall_breakdown_tomorrow"] for d in all_districts
        },
        "causal_chain": {d["district"]["id"]: d["causal_chain"] for d in all_districts},
        "demand_factors": {k: v for d in all_districts for k, v in d["demand_factors"].items()},
    }

    n_facilities = len(out["facilities"])
    n_districts = len(out["districts"])
    assert n_districts == 5, f"expected 5 districts, got {n_districts}"
    assert n_facilities == 40, f"expected 40 facilities, got {n_facilities}"
    ids = [f["id"] for f in out["facilities"]]
    assert len(ids) == len(set(ids)), "duplicate facility id generated"

    with open(NEW_SEED_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")

    print(f"Wrote {NEW_SEED_PATH} with {n_districts} districts and {n_facilities} facilities.")


if __name__ == "__main__":
    main()
