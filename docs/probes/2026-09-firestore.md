# Firestore audit, 26 Sep 2026 (read-only)

Script: `backend/scripts/firestore_audit.py` (no write calls; prints counts and facility ids only). Project `swasthyagrid-ai-54886`.

| Collection | Documents |
|---|---|
| facilities | 8 (`chc_east, chc_north, phc_04, phc_09, phc_12, phc_18, phc_21, phc_27`), 0 carry `district_id` |
| medicine_stock | 16 |
| beds | 4 |
| doctors | 2 |
| diagnostics | 2 |
| districts | 1 |
| footfall_today | 0 |
| crm_users | 4 |
| deliveries | 0 |

Findings:

- Firestore holds the legacy 8 Jaipur facilities only, with no `district_id`. The 40-facility seed lives only in `backend/data/seed_districts.json`.
- `DistrictRepository` requires `district_id` on every facility, so pointing the backend at this Firestore would break it. Until the upsert (task G2) is approved and run, the backend runs with `DATA_SOURCE=seed`.
- The CRM has 4 login users; only 3 map to facilities, all in Jaipur Rural.
