# Next Tasks

## Immediate / small
- [x] ~~Push `.github/workflows/ci-cd.yml`~~ — done; user completed `gh auth refresh -s workflow`, pushed in commit `ded6253`.
- [x] ~~Deploy backend to GCP~~ — done in Session 4: Cloud Run service `swasthyagrid-api` live in project `swasthyagrid-ai-54886` (`asia-south1`).
- [x] ~~Point frontend at live backend~~ — done: Vercel `NEXT_PUBLIC_API_BASE` set to the Cloud Run URL, verified via live network requests.
- [x] ~~Replace the placeholder Gemini key~~ — done, real key active in Secret Manager and Vercel.
- [x] ~~Live Firestore wiring behind `DistrictRepository`~~ — done in Session 5, JSON fallback preserved.
- [x] ~~Facility data-entry UI~~ — done in Session 5 as a separate app, **SwasthyaGrid Intake** (`ai-healthcare-crm/`, own repo, own Vercel deploy).
- [ ] Optional cleanup: the SwasthyaGrid AI Vercel project's dashboard "Root Directory" setting is still `.` (not `frontend`) since there's no CLI/MCP write path for it — the root `vercel.json` works around this. Cosmetic only, not blocking.
- [ ] Connect the CRM's GitHub repo to its Vercel project for auto-deploy — currently CLI-deploy-only because the linked Vercel team (a teammate's account) lacks admin on the personal GitHub repo. Either grant that Vercel team's GitHub App access to `harshkawatra11/SwasthyaGrid-CRM`, or relink the Vercel project under an account that has both.
- [ ] Cost hygiene: Cloud Run is scale-to-zero (`min-instances=0`) so idle cost should be near-zero, but periodically check `gcloud billing accounts list` / the Cloud Console billing page. Tear-down command if needed: `gcloud projects delete swasthyagrid-ai-54886` (this also removes the CRM's Firestore data, since they share the project).

## Next milestones
- [ ] PHC Staff role in the main SwasthyaGrid AI dashboard still shows a read-only framing note for data entry — the actual entry now happens in the separate CRM app; consider linking to `swasthyagrid-crm.vercel.app` directly from that gated view instead of just a note.
- [ ] CRM: migrate to Firebase Authentication + client-scoped security rules once Identity Platform is enabled on the project (currently server-only JWT sessions + deny-all Firestore rules — see `memory/decision-log.md`).
- [ ] CRM: doctor present/absent toggle doesn't yet feed back into `ForecastService.doctor_attendance_risk()` — that's still static from the seed (`absence_pattern`, `risk_level`, `patient_delay_pct`). Deriving these from a real attendance log is a real feature, not done tonight.
- [ ] CRM: SMS/WhatsApp intake fallback, Cloud Translation, Speech-to-Text — named in the finale speech as roadmap, not built.
- [ ] Replace mock forecast generators with real XGBoost/LightGBM per `docs/06-forecasting.md`, once historical data accumulates in Firestore/BigQuery.
- [ ] Multilingual i18n — out of scope so far.

## Deferred (explicitly out of scope)
- Real trained XGBoost/LightGBM models
- BigQuery / Pub/Sub / Cloud Scheduler (named in the speech as the scale path, not built)
- SMS/WhatsApp intake, Cloud Translation, Speech-to-Text voice entry
- Firebase Auth migration for the CRM
- Multilingual i18n

- Sarvam audio follow-up (2026-10-17): deployed and verified end-to-end. If sound is still absent on a particular device after refreshing, inspect site sound permission, tab mute, output device and browser version; do not rotate working provider credentials.
