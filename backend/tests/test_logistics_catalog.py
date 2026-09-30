import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from app.logistics.catalog import line_for, medicines
from app.repositories.district_repository import DistrictRepository
from app.services.forecast_service import ForecastService

BACKEND = Path(__file__).resolve().parents[1]
SEED = BACKEND / "data" / "seed_districts.json"
NEW_DISTRICT_FIELDS = {"center", "rto_code", "hq_city"}
REMOVED_DUPLICATES = [
    ("kota_phc_4", "Anti-Rabies Vaccine (ARV)", 255),
    ("alwar_phc_4", "Anti-Rabies Vaccine (ARV)", 37),
]


def _regenerate(tmp_path: Path) -> dict:
    """Run the generator into a temp file by patching its output path."""
    out = tmp_path / "regen.json"
    code = (
        "import sys, runpy, pathlib;"
        "sys.path.insert(0, 'scripts');"
        "import generate_districts as g;"
        f"g.NEW_SEED_PATH = pathlib.Path(r'{out}');"
        "g.main()"
    )
    subprocess.run([sys.executable, "-c", code], cwd=BACKEND, check=True, capture_output=True)
    return json.loads(out.read_text(encoding="utf-8"))


def test_regeneration_is_identical_to_committed_file(tmp_path):
    committed = json.loads(SEED.read_text(encoding="utf-8"))
    regen = _regenerate(tmp_path)
    assert regen == committed


def test_seed_has_new_district_fields_and_no_removed_duplicates():
    committed = json.loads(SEED.read_text(encoding="utf-8"))
    for key in ("facilities", "beds", "doctors", "diagnostics", "footfall_forecast", "causal_chain"):
        assert committed[key], key
    for d in committed["districts"]:
        assert NEW_DISTRICT_FIELDS <= set(d)
        assert set(d["center"]) == {"lat", "lng"}
    rows = {(m["facility_id"], m["medicine_name"], m["units_remaining"]) for m in committed["medicine_stock"]}
    for row in REMOVED_DUPLICATES:
        assert row not in rows


def test_stock_rows_unique_per_facility_and_medicine():
    committed = json.loads(SEED.read_text(encoding="utf-8"))
    keys = [(m["facility_id"], m["medicine_name"]) for m in committed["medicine_stock"]]
    assert len(keys) == 79
    assert len(set(keys)) == 79


def test_risk_mix_unchanged():
    repo = DistrictRepository(SEED)
    fs = ForecastService(repo)
    mix = Counter(fs.facility_risk_level(f["id"]) for f in repo.facilities)
    assert (mix["healthy"], mix["monitor"], mix["stress"], mix["critical"]) == (15, 7, 8, 10)


def test_catalog_covers_every_stocked_medicine():
    committed = json.loads(SEED.read_text(encoding="utf-8"))
    names = {m["medicine_name"] for m in committed["medicine_stock"]}
    assert names <= set(medicines())


def test_line_for_arv():
    line = line_for("Anti-Rabies Vaccine (ARV)", 120)
    assert line.cartons == 2
    assert line.weight_kg == 4.4
    assert line.pallet_slots == 1
    assert line.cold_chain is True


def test_line_for_non_cold_chain():
    line = line_for("Paracetamol", 1000)
    assert line.cartons == 2
    assert line.cold_chain is False
    assert line.weight_kg == 14.0
