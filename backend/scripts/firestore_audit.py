"""Read-only Firestore audit: prints document counts per collection and the
sorted facility ids. No field values are printed and nothing is written.

Credentials: FIREBASE_SERVICE_ACCOUNT (base64 or raw JSON) or the path in
FIREBASE_SERVICE_ACCOUNT_FILE.
"""

import base64
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings

COLLECTIONS = (
    "facilities",
    "medicine_stock",
    "beds",
    "doctors",
    "diagnostics",
    "districts",
    "footfall_today",
    "crm_users",
    "deliveries",
)


def _credentials_info() -> dict:
    s = get_settings()
    raw = s.firebase_service_account
    if raw:
        raw = raw.strip()
        if not raw.startswith("{"):
            raw = base64.b64decode(raw).decode()
        return json.loads(raw)
    path = s.firebase_service_account_file or os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE")
    if path:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    sys.exit("Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_FILE")


def main() -> None:
    from google.cloud import firestore
    from google.oauth2 import service_account

    info = _credentials_info()
    creds = service_account.Credentials.from_service_account_info(info)
    client = firestore.Client(project=info["project_id"], credentials=creds)
    for name in COLLECTIONS:
        docs = list(client.collection(name).stream())
        print(f"{name}: {len(docs)}")
        if name == "facilities":
            ids = sorted(d.id for d in docs)
            with_district = sum(1 for d in docs if (d.to_dict() or {}).get("district_id"))
            print("  ids:", ", ".join(ids))
            print(f"  with district_id: {with_district}")


if __name__ == "__main__":
    main()
