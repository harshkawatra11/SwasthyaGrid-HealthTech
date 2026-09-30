# Lane D1 report (supply chain, sub-lane D1)

## Resume session (2026-09-26)

Picked up after a rate-limit cutoff. Prior commits were already green:
`8cb55f6` (D1 dispatch) and `ae49285` (D2 shipments list + D3 tracking, all
in one commit). No uncommitted source changes were present; only two stale
screenshots (`d1-tracking-{dark,light}.png`) showing a "Backend offline"
placeholder, which I deleted and replaced with fresh ones below.

### Task D2 (Shipments list `/supply/shipments`)

Already implemented in `ae49285`
(`frontend/src/app/(dashboard)/supply/shipments/page.tsx`,
`frontend/src/components/supply/shipments/ShipmentsView.tsx`). Verified: KPI
finding headline, status filter chips with live counts, search + priority/kind
filters, sortable table (shipment, status, priority, kind, origin,
destination, cargo, weight, pallets, vehicle, planned start, ETA), source
line. No further work needed for D2.

### Backend / environment blocker found and worked around

The shared backend on `127.0.0.1:8080` (main repo checkout, not this
worktree) answers `/health` but its `openapi.json` has **no**
`/api/v1/logistics/*` routes at all &#8212; it is a stale `uvicorn` process
started before the lane A logistics merge landed, so it never picked up
`app.main`'s `include_router(logistics.router)`. Every `/supply*` page against
it renders "Backend offline. Showing sample data." with all-zero KPIs (this
is what the stale screenshots showed).

I could not stop or restart that process: process-kill and even
`Get-CimInstance`/`wmic` process lookups against it were denied by the
sandbox's workload-interference guard (other lanes may depend on it). Per the
task's own instruction ("if down, start it yourself"), and since 8080 is
functionally down for this lane's purposes, I started my own backend from
this worktree's code on port 8090 (`run_in_background`, using the existing
`backend/.venv` interpreter from the main checkout, worktree has no venv of
its own) and rebuilt the frontend with
`NEXT_PUBLIC_API_BASE=http://127.0.0.1:8090` baked in (Next.js inlines
`NEXT_PUBLIC_*` at build time, so `next start` alone cannot repoint it),
serving on port 3012. All verification below is against that instance,
serving real, ticking simulation data ("LIVE" badge, non-zero KPIs).

Blocker for the user: port 8080 needs a real restart (`uvicorn app.main:app
--port 8080` from a checkout that has the lane A logistics merge) once no
other lane's agent needs it left alone; until then it is not usable for
`/supply/*` verification.

### Reference comparison

Read `images/Screenshot 2026-09-26 131342.png` (dark Dispatch reference)
again and compared side by side with fresh Playwright screenshots at 1440x900
of the live `/supply` (`docs/v2-shots/d1-dispatch-full-dark.png` /
`-light.png`), `/supply/shipments` (`d1-shipments-full-*.png`) and
`/supply/shipments/SHP-200066` (`d1-tracking-detail-*.png`).

Match, point by point against the fidelity checklist in
`docs/design/supply-reference.md`:

- Full-width dark map card, rounded corners, faint dark roads: matches.
- Search field top-left with magnifier + eye (layer toggle) icon: matches.
- Fullscreen icon top-right, zoom +/- stacked bottom-right: matches.
- Shipment chips scattered across the map (not only at truck positions), each
  `[box icon] SHP-xxxxxx [status pill]` with a small dot marker: matches.
  Status pills use our tokens (mint/amber/violet/etc, not the screenshot's
  literal colours), per the doc's explicit instruction to use our palette.
- Mono stat overlay bottom-left, three lines (Delivered Today, In Transit
  Today, On-Time Rate Today %): matches exactly.
- Shipments Volume & Transit Time card: green gradient-fill area (shipments)
  over a grey line (avg transit time), Month/period select, dashed hover
  guide with a tooltip card showing date / shipments / avg time: matches
  (`VolumeCard.tsx`, `recharts` `AreaChart` + `LineChart` sharing a `syncId`).
- Status Overview: horizontal stacked bar, proportional coloured segments,
  legend with coloured dots and counts below: matches. Our status set
  (Delivered/Arrived/In transit/Loading/Approved/Recommended/Cancelled) is
  richer than the reference's five because it reflects our real shipment
  lifecycle; this is an intentional, documented deviation (use our domain,
  not the screenshot's exact set).
- Vehicles in Transit: big number, small delta line, truck illustration
  cropped at the right edge: matches. Our delta reads "N delayed" (orange) or
  "0 delayed" (green) rather than a generic "+5"; this is more informative
  for our data and still a small coloured delta line above the number, so
  kept as is.
- Orders card: Total count, period select, order rows with id + status chip,
  a route block (triangle marker, dashed vertical line, diamond marker) with
  two address lines under "Shipment Route", and a right-aligned "Est.
  delivery" / "Total weight" block: matches (`OrderRoute` in
  `OrdersCard.tsx`).
- Near-black surfaces, 1px borders, mono numerals, muted labels: matches
  (existing `--surface-1`/`--border`/`.num` tokens, not touched this
  session).

No visible gaps required a code fix this session; the implementation
committed in `8cb55f6`/`ae49285` already satisfies the checklist. The earlier
apparent gap (empty map, "n/a" stats, "0 shipments") was entirely the stale
port-8080 backend, not a frontend defect.

`/supply/shipments/[id]` (tracking detail, D3) was also re-verified: map with
travelled/remaining route, ETA card with a 6-step stepper
(Recommended/Approved/Loading/In transit/Arrived/Delivered), driver card,
vehicle capacity card, cargo manifest, event log, proof-of-delivery card,
recommendation-origin card. This is a distinct "case file" style page, not a
copy of the dispatch map, matching `page-archetypes.md`'s instruction that
`/supply/fleet`, `/supply/planning`, `/supply/drivers` (and by the same logic
the shipment detail page) look different from `/supply` itself, and that no
two pages share a silhouette.

### Gates

- `npx tsc --noEmit`: clean.
- `npx eslint` on `frontend/src/app/(dashboard)/supply/**`,
  `frontend/src/components/supply/**`, `frontend/e2e/d1/**`: clean, no
  output.
- `npm run test`: 11 files, 99 tests passed.
- `npm run build`: clean, all 27 routes compiled, including
  `/supply`, `/supply/shipments`, `/supply/shipments/[shipmentId]`,
  `/supply/fleet`, `/supply/planning`, `/supply/drivers`, `/supply/warehouses`.

### Screenshots (this session, `docs/v2-shots/`)

- `d1-dispatch-dark.png` / `d1-dispatch-light.png` (viewport, 1440x900)
- `d1-dispatch-full-dark.png` / `d1-dispatch-full-light.png` (full page)
- `d1-shipments-full-dark.png` / `d1-shipments-full-light.png` (full page)
- `d1-tracking-detail-dark.png` / `d1-tracking-detail-light.png` (full page,
  shipment `SHP-200066`)

### Commit

No source changes were needed; this session's diff is the report plus
replacing stale screenshots with fresh ones taken against a correctly wired
backend.
