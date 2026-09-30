# Lane F3 report

TASK F8 DONE
Files: frontend/src/app/(dashboard)/inventory/page.tsx, frontend/src/components/operations/{derive.ts,derive.test.ts,kit.tsx,InventoryHeatmap.tsx,InventoryPanels.tsx}, frontend/scripts/f3-fixtures.mjs, frontend/src/data/fixtures/{beds__forecast,doctors__attendance,diagnostics,performance,footfall__forecast,logistics__warehouses}.json, docs/v2-shots/f3-inventory-{dark,light}.png
Commands run: npx tsc --noEmit (clean); npx eslint on touched files (clean); npm run test (9 files, 95 tests passed, 15 new in derive.test.ts); npm run build (passes); Playwright shots at 1440 x 900 width, dark and light, against lane A backend on 8084 (no console problems).
Gate evidence: docs/v2-shots/f3-inventory-{dark,light}.png. Page: moneyshot "5 stock-outs inside 3 days" (red, only strong colour), 6 KPI tiles with per-district sparklines, full width heatmap of 7 medicine rows by 40 facility columns grouped under district bands with a "weakest item" row, hover readout, click a facility column to filter; stock-out ladder (12 facilities), emergency medicine by district heatmap, cold chain card, two-chart card (average vs weakest cover, facilities under 7 days), warehouse cover strips with expiry flags, filterable and sortable stock table. Pessimistic/Realistic/Optimistic switch (x1.25, x1, x0.9 demand) recomputes every number and heat cell. Every card has an action title (pure function, unit tested), eyebrow, source line and sub-section label.
Deviations: Differences from the design docs and why: (1) the heatmap is transposed (medicines as rows, facilities as 40 columns) so it is one wide band rather than a 1100 px tall list; same 40 x 7 data. (2) Custom heat grid instead of ds/HeatmapMatrix because cells must print values and the matrix needs district bands and a summary row. (3) Emergency, cold chain, facility name and district are joined client side from /facilities plus a small catalogue constant, so the page also works with the old payload and the old 30 row medicines fixture. (4) The expiry data comes from logistics warehouse detail (lane A endpoint); offline it shows a note. (5) Scenario factors are named assumptions applied to days of cover (days / factor), not a model re-run. (6) Fixture script f3-fixtures.mjs fetches from a running backend and only writes missing files.

## Session resumed after a rate-limit cutoff (F9, F10, F11)

Picked up with 26 uncommitted files already sitting in the worktree: derive.ts (already committed with F8, unchanged), and complete but uncommitted footfall, beds, doctors, diagnostics, analytics and citizen pages plus their panel components. Read every uncommitted file in full against `docs/design/page-archetypes.md` and `docs/design/consulting-grade.md` (the plan's numbered sections referenced in the task, e.g. 9.8/9.9/9.11, do not exist as a file in this worktree; these two design docs are what is binding here and were followed). Everything the previous agent left was correct and complete, so this session verified, committed and shipped it rather than rewriting; one real bug was found and fixed (below).

Commits (all on `feat/v2-f3`, no co-author or AI trailer per instructions):
- `bd82933 feat(footfall,beds): forecast studio fan chart and capacity board waterfall` - F9
- `c72cf70 feat(doctors,diagnostics): attendance heat calendar and availability matrix` - F10
- `bda8323 feat(analytics,citizen): analyst workbench and citizen ask panel restyle` - F11
- `1ed0834 fix(analytics): stop the KPI tree clipping its rightmost leaf values` - bug found during screenshot QA
- `3f98abc fix(docs): retake citizen light screenshot against a live backend` - one screenshot had landed mid a transient fetch stall

### F9 `/footfall` and `/beds`
Footfall (archetype: Forecast studio): fan chart (actual line, dashed predicted line, confidence band that widens with horizon and a peak-day reference dot) for a selected district; tomorrow's patient-group breakdown bars; district-by-day calendar heatmap (5 rows x 7 days, click a district to load it into the studio above); five-district small multiples with a bar sparkline each; demand scenario switch (pessimistic/realistic/optimistic) recomputes every number. Real backend: 5 districts, `/api/v1/footfall?district_id=...`.
Beds (archetype: Capacity board): occupancy strip heatmap (36 facilities, now/tomorrow/next-week columns, worst first); capacity waterfall (total, occupied, extra, free); average occupancy by district grouped bars with a 90% trigger reference line; top-10 pressure ranking with meters; bed-redirect recommendations list. Moneyshot: "8 facilities above 90% next week."

### F10 `/doctors` and `/diagnostics`
Doctors (archetype: Roster and attendance): attendance heat calendar (doctor rows x weekday columns, absence likelihood modelled from risk level and recorded pattern, sorted worst first); absence risk ranking; patient-delay bars; coverage-by-district stacked bars; staff-transfer recommendation list. Moneyshot band: "5 high absence risk of 10 doctors."
Diagnostics (archetype: Availability matrix): facilities-by-test matrix grouped into five district cards with OK/Degraded/Down/n-r pills; downtime bars by test and by district; per-district availability donuts; nearest-alternative referral table with distance. Real backend currently exposes 2 tracked tests (Blood, X-Ray) across 40 facilities, 10 reporting; the page renders this honestly rather than padding it.

### F11 `/analytics` and `/citizen`
Analytics (archetype: Analyst workbench): searchable facility picker sorted worst-risk-first; causal chain explorer as a connected cause-to-effect flow with evidence chips, backed by the real `/api/v1/analytics/causal-chain/{id}` endpoint; a from-scratch KPI tree component (SVG node diagram: performance score to its four components to their measured drivers, edge colour follows the score band); sortable performance scorecard heat table; forecast-confidence histogram; four correlation small-multiple scatter plots (pearson r per component); last-20 live-events feed falling back to alerts when the stream is quiet.
Citizen: restyled the existing ask panel (unchanged behaviour, `/api/public-ask` route untouched) with example prompts, a full-height chat-style layout and a `HideScopeSwitcher` helper that hides the (irrelevant, lane-C-owned) district scope switcher on this public page via a scoped CSS rule, since the page sits outside district scope and the switcher has no route hook to opt out itself.

### Bug found and fixed: KPI tree clipping
QA screenshots showed the KPI tree's rightmost leaf values ("ORS 2.0 d", "none monitored", "0 of 1") truncated mid-word with no visible scrollbar. Measured in-browser: the SVG had `min-w-[860px]` but its InsightCard container only rendered 820px wide at 1440px viewport, so the last ~40px of the 980-unit viewBox was pushed off-screen. Fixed by lowering the floor to `min-w-[560px]`, confirmed `scrollWidth === clientWidth` afterwards and re-verified with a cropped zoom screenshot that every value now reads in full, in both themes.

### Gates (frontend/, run from the worktree)
- `npx tsc --noEmit`: clean, no errors, after every commit.
- `npx eslint` on every touched file: clean.
- `npm run test`: 95/95 passing (9 test files) when run in isolation. Two unrelated tests (`ds.test.tsx` DataTable sort test, `shell.test.tsx` command palette test - both outside this lane's ownership) timed out under CPU load while the dev build and Playwright were running concurrently; re-run alone, all 95 pass. Not a regression from this lane's files.
- `npm run build`: clean production build, all 27 routes compile, including the six pages in this report.

### Screenshots
Real backend at `http://127.0.0.1:8080` (was down at session start; started it from `C:\wt\sg-v2-f3\backend` with `uvicorn app.main:app --host 127.0.0.1 --port 8080`, left running for other lanes). Frontend built and served with `npx next start -p 3008` against that backend; a stale server from before this session's edits was found listening on 3008 and was killed and restarted twice (once after the code was committed, once after the KpiTree fix) so every screenshot reflects the code actually committed. Server stopped via PowerShell at the end of the session.
`docs/v2-shots/f3-{footfall,beds,doctors,diagnostics,analytics,citizen}-{dark,light}.png`, 1440x900, 12 files. All six silhouettes are distinct (fan chart vs. heatmap strip vs. attendance calendar vs. district-card matrix vs. causal-flow-plus-tree vs. a plain chat panel for the public page). Every analytic page carries a moneyshot number, action titles computed from live data, callouts, and a source/method footer line; verified by eye on all 12 images.

### Deviations
- The "plan sections 0, 4, 9.1, 9.8, 9.9, 9.11" referenced in the task brief do not exist as a file in this worktree (only `docs/design/page-archetypes.md`, `docs/design/consulting-grade.md` and `docs/design/supply-reference.md` are present under `docs/design/`); those two were used as the binding spec instead, per their own text ("Read `consulting-grade.md` too").
- Diagnostics currently reflects only 2 tracked tests from the real backend rather than a larger catalogue; not fabricated to look fuller.
- Citizen page behaviour (the ask panel's fetch logic) was left as the previous agent wrote it; only its layout/styling changed, so `/api/public-ask` is unaffected.

### Blockers
None. Backend and frontend both verified live end to end; every gate green; nothing left uncommitted.
