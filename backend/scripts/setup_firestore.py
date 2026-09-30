"""Seed Firestore with the district dataset so it becomes the live source of
truth shared between the SwasthyaGrid backend (DistrictRepository) and the
SwasthyaGrid Intake CRM (ai-healthcare-crm). Run once (or whenever the JSON
seed changes and you want to reset Firestore to match it):

    python scripts/setup_firestore.py

Requires Application Default Credentials with Firestore access
(`gcloud auth application-default login`, or running on Cloud Run/a service
account with roles/datastore.user) and GOOGLE_CLOUD_PROJECT set.
"""

import json
from pathlib import Path

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "seed_districts.json"


def main() -> None:
    from google.cloud import firestore  # deferred import: only needed here

    with open(SEED_PATH, encoding="utf-8") as f:
        data = json.load(f)

    db = firestore.Client()

    for district in data["districts"]:
        db.collection("districts").document(district["id"]).set(district)
    print(f"Seeded {len(data['districts'])} districts.")

    for facility in data["facilities"]:
        db.collection("facilities").document(facility["id"]).set(facility)
    print(f"Seeded {len(data['facilities'])} facilities.")

    for med in data["medicine_stock"]:
        db.collection("medicine_stock").add(med)
    print(f"Seeded {len(data['medicine_stock'])} medicine_stock entries.")

    facility_beds_total = {f["id"]: f["beds_total"] for f in data["facilities"]}
    for bed in data["beds"]:
        facility_id = bed["facility_id"]
        occupancy_pct = round(bed["occupied"] / facility_beds_total[facility_id] * 100)
        db.collection("beds").document(facility_id).set(
            {
                **bed,
                # Simple heuristic projection, editable later by the forecast
                # engine — CRM only ever edits `occupied`.
                "predicted_occupancy_tomorrow_pct": bed.get(
                    "predicted_occupancy_tomorrow_pct", min(occupancy_pct + 6, 100)
                ),
                "predicted_occupancy_next_week_pct": bed.get(
                    "predicted_occupancy_next_week_pct", min(occupancy_pct + 15, 100)
                ),
            }
        )
    print(f"Seeded {len(data['beds'])} beds documents.")

    for doctor in data["doctors"]:
        db.collection("doctors").document(doctor["doctor_id"]).set(
            {**doctor, "present": doctor.get("risk_level") != "high"}
        )
    print(f"Seeded {len(data['doctors'])} doctors.")

    for i, diag in enumerate(data["diagnostics"]):
        db.collection("diagnostics").document(f"diag_{i}").set(diag)
    print(f"Seeded {len(data['diagnostics'])} diagnostics.")

    print("\nFirestore is now the live source of truth for SwasthyaGrid + the CRM.")


if __name__ == "__main__":
    main()
