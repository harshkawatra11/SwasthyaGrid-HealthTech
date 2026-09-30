# Final audit, 27 Sep 2026

Scope: checklist E.3 of the build plan, run on branch `feat/swasthyagrid-v2` after the backend performance remediation. Every result below was produced by a command run during the audit; nothing is quoted from an agent report without re-checking it.

## Result summary

| # | Check | Result |
|---|---|---|
| 1 | Backend tests and lint | Pass: 348 tests, ruff clean |
| 1 | Frontend tests, types, build | Pass: 272 tests at the default timeout, `tsc` clean, `next build` clean |
| 2 | Endpoint latency | Pass: 35 GET endpoints, all 200, worst p95 65 ms (limit 250 ms) |
| 2 | Tick cost and queue | Pass: tick p95 4 ms, queue 0 on a fresh scenario; 10 minute soak at 120x held tick p95 under 8 ms and CPU under 1 percent of a core |
| 3 | API contract | Pass: 48 paths, none removed; regenerated OpenAPI types differ only by the `/metrics` fields |
| 4 | Approve to delivery loop, backend half | Pass (details below) |
| 4 | Approve to delivery loop, CRM half | Not run: needs the Firestore upsert and 40 CRM logins, which the user has not approved |
| 5 | Data honesty | Pass: the provenance footer "Simulated operational data. Routes: OpenStreetMap contributors via OSRM. Boundaries: geoBoundaries (ODbL)." is a shared component on the supply pages |
| 6 | Voice evaluation | Partial pass: 37 of 40 on the full run, 3 of 3 after fixes on a targeted rerun (details below); not a second full run |
| 6 | Voice latency | Pass on 2 of 3 targets, the third missed by 49 ms (details below) |
| 7 | Security | Pass (details below) |
| 8 | Hygiene | Pass: 0 em or en dashes on lines added since master; stray processes stopped |

## 1. Tests

- Backend: `python -m pytest -q` gave 348 passed; `ruff check .` clean.
- Frontend: `npm run test` gave 29 files, 272 tests passed at the default 5 second timeout. Earlier in the session the same suite showed intermittent timeouts; the cause was leftover scratch servers using several cores (one Python process had used 10,753 CPU seconds), not the code. After those were stopped the suite passed without a raised timeout.

## 2. Performance

Before the remediation the live backend froze: `/health` timed out at 30 s, the process had used 806 CPU seconds, and the state held 839 shipments of which 595 were queued. The cause was the planner re-checking every queued shipment on every tick while rebuilding a full copy of the shipment list for each check.

After the remediation (bounded queue, active-set iteration, one fleet index per planner pass, throttled passes, dirty-flag saves with an archive file, tick metrics):

- `endpoint_sweep.py` against the live server on port 8080, 35 endpoints, 10 requests each: every status 200, p50 about 16 ms, worst p95 65 ms (`insights/briefing`).
- `/metrics`: `tick_ms` last 0.8, p95 3.96 over 36 samples, queued 0, active 37.
- Remediation soak (10 minutes at 120x, run by the fixing agent on a scratch port): tick p95 6.1, 5.5 and 7.3 ms at minutes 1, 5 and 10; queued 0, 2 and 5; CPU 0.8, 0.7 and 0.5 percent of a core; 610 SSE tick frames in 616 s; sweep passed at every mark.
- The event stream on port 8080 delivered 32 `tick` events in a 30 second window.

## 3. Contract

OpenAPI on port 8080 lists 48 paths. Regenerating `frontend/src/lib/api/openapi.ts` produced a 5 line diff, all for the new `/metrics` fields.

## 4. The approve to delivery loop (backend half)

Run through the API against the live simulator, then the scenario was reset to its 08:30 IST start at 60x.

1. Pending critical recommendation `rec_fd4a96dc`: 119 vials of Anti-Rabies Vaccine (ARV) to PHC Kota-4. Kota-4 stock before: 7 units, 1.2 days of cover, risk critical.
2. `POST .../approve` created shipment SHP-200001 with a refrigerated van (RJ20 GQ 3827) and a driver, status `approved`.
3. The shipment moved through the event trail: created, approved, vehicle assigned, loading at the District Drug Warehouse Kota, departed, arrived at PHC Kota-4.
4. `POST .../pod` with the service token and the shipped quantities returned 200; the shipment became `delivered` with the confirming name recorded.
5. Stock after: 126 units (7 + 119), 21.0 days of cover. Kota-4 risk moved from critical to stress; it remains stress because of other factors (bed pressure), which is correct.
6. A second POD returned 200 with `already_confirmed: true` and stock stayed at 126.
7. The recommendation moved to `fulfilled`.

Not verified: the CRM half (the facility confirming receipt in the CRM, with the Firestore increment and the `stock-applied` callback). The CRM code and its 22 unit tests exist, but the Firestore project holds only the 8 legacy facilities (see `docs/probes/2026-09-firestore.md`), so the loop cannot run end to end until the upsert and logins are approved and applied.

## 6. Voice

Evaluation (`python -m evals.voice_eval`, real Sarvam chat, 40 cases, at least 15 in Hindi or Hinglish, live ground truth):

- Full run on the new key: 37 of 40 (92.5 percent). Earlier full run on the previous key, before two tool description fixes: 35 of 40 (87.5 percent).
- The 3 failures: `find_02` and `find_03` expected the tool `find_facility` but the model called `get_facility_status`, which also resolves the spoken name and gave a correct, grounded answer (PHC Kota-4 and PHC Rural-14); the harness was too strict, so cases can now list several acceptable tools. `facility_05_hindi` ("पीएचसी कोटा दो का हाल क्या है?") was a real failure: the model answered with no tool call, so its statements about the facility were not grounded. The system prompt now requires a tool call for any named facility, district or shipment in any script, including Devanagari and number words.
- Targeted rerun of those 3 cases: 3 of 3 pass, and the Hindi case now resolves to `kota_phc_2` and is grounded.
- A second full 40 case run was not made after the prompt change, so the 40 of 40 figure is not claimed.

Latency (`python -m evals.voice_latency_probe`, 5 turns, real Sarvam STT/LLM/TTS over the WebSocket, typed input):

| Target (plan 7.1) | Measured | Result |
|---|---|---|
| Median to first answer audio, no tools, at most 1.8 s | 836 ms | Met |
| Median to first audio of any kind, with tools, at most 1.2 s | 1,249 ms | Missed by 49 ms |
| Median to first answer audio, with a tool round, at most 3.2 s | 1,249 ms | Met |

Audio was verified by frame counts reaching the playback queue and phase changes, not by ear.

## 7. Security

- No `.env`, `.env.local`, service-account or secret file is tracked (`git ls-files`); the only match is the pre-existing `backend/scripts/setup_secrets.sh`, which contains no values.
- No key string is committed (word-boundary scan for the Sarvam key prefix and the Gemini key prefix printed nothing).
- Security headers on REST: `x-content-type-options: nosniff`, `strict-transport-security`, `x-frame-options: DENY`.
- `POST .../pod` returns 401 with no token and with a wrong token.
- Admin endpoints are gated by `LOGISTICS_ADMIN_ENABLED` and `ENVIRONMENT`; production disables them (covered by unit tests).
- API keys were supplied through chat during the session. They are stored only in the gitignored `backend/.env`, but they exist in the session transcript, so rotate them after the event.

## 9. Visual check against the reference photographs

Two screens were opened in a real browser at 1440 x 900 on the final build (`docs/v2-shots/final-dispatch.png`, `final-command.png`, `final-fleet.png`) and compared with `images/` by eye.

- `/supply` (Dispatch) follows the dark Dispatch reference: a large dark map with shipment label chips (icon, id, coloured status word), the three line mono stat overlay bottom left, the green area plus grey line volume and transit chart with a peak annotation, and the Orders list with route timelines. The top bar clock runs with seconds and a Live indicator, and a live toast fired for a risk improvement.
- Gap: the chips are crowded near the middle of the map because the view covers all of Rajasthan and 44 shipments are shown; the reference shows about ten well spread pins. A collision-avoiding layout or a cap on terminal shipments would close this.
- `/command` is a dense, structured page (situation block with one large number, what is working and what needs action, KPI band with sparklines, risk choropleth with live trucks, league table), visibly different from the other pages.
- `/supply/fleet`, `/supply/planning`, `/supply/drivers`, `/supply/warehouses` were compared to the smaller reference images by their lane agent (screenshots under `docs/v2-shots/d2-*`); the orchestrator viewed only the fleet capture in this audit.

## 8. Known limitations

- All logistics, fleet, driver and history data is simulated and labelled as such.
- The CRM to backend loop has not run end to end (see section 4).
- The backend runs on the bundled seed data (`DATA_SOURCE=seed`), not Firestore.
- The planner pass is capped at 25 queued shipments by priority, so 25 permanently blocked shipments could delay lower priority ones until they are freed or auto-cancelled.
- The map default is Esri tiles because CARTO tiles show a watermark without an API key.
- The voice second full evaluation run, and listening tests of the audio, are still owed.
