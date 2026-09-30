# Lane D2 report (supply chain: fleet, drivers, planning, warehouses)

## Recap: tasks done before this session

TASK D4 DONE (commit `9ba425a`): `/supply/fleet` with `TruckCargoView`, fleet list, KPI trio, service watchlist, depot utilisation and status mix. Shared lib added: `MiniGantt`, `ProvenanceFooter`, `cargo.ts`, `gantt.ts`, `metrics.ts`, `parts.tsx`, `useElementWidth.ts`, `useSimNow.ts`.

TASK D6 DONE (commit `f1aa888`): `/supply/planning` with `FleetGantt`, `PlanningQueue`, KPI trio (weight, pallets, alerts), queue by priority and the shared `TruckCargoView`.

This session picked up with an uncommitted, complete `DriverPanel.tsx` and the shared `metrics.ts`/`parts.tsx` helpers already carrying driver and warehouse functions (`driversTitle`, `DRIVER_HOURS_LIMIT`, `daysToExpiry`, `licenceTone`, `DriverStatusChip`, `warehousesTitle`, `coverTone`, `StockRow`) and tests for all of it in `lib.test.ts`, all from before the rate limit cut the previous agent off. That code was correct and is kept as is.

## TASK D5 DONE: `/supply/drivers`

Three-pane layout per reference image 3: roster list, live map, driver detail panel.

Files:
- `frontend/src/components/supply/drivers/DriverList.tsx` (new): searchable roster, avatar, rating, status chip, depot, hours-today mini readout, near-limit highlight.
- `frontend/src/components/supply/drivers/DriverMap.tsx` (new): `BaseMapClient` with `WarehouseLayerClient` (depot markers) and `LiveTruckLayerClient` fed by `useLivePositions()`, selection wired both ways (roster click highlights the truck on the map, clicking a truck on the map opens that driver's panel via a shipment-id-to-driver lookup).
- `frontend/src/components/supply/drivers/DriversView.tsx` (new): page shell, KPI band (drivers, on the road, near hour limit, avg on-time/rating), three-column grid (`260px` roster / flexible map / `320px` panel), wired to `useDrivers`, `useDriver`, `useWarehouses`, `useSchedule`, `useSimNowMs`.
- `frontend/src/components/supply/drivers/DriverPanel.tsx` (uncommitted work from before the cutoff, kept unchanged): avatar header, licence chip, hours meter, stat block, `MiniGantt` schedule, recent shipments table.
- `frontend/src/app/(dashboard)/supply/drivers/page.tsx`: wired to `DriversView`.

Commit: `9a67d07` "feat(supply): drivers page with roster, live map and driver panel"

## TASK D7 DONE: `/supply/warehouses`

Own archetype (not one of the three reference images): a full-width capacity board hero (distinct silhouette from fleet/planning/drivers), then a depot list plus detail pane with a real stock-cover table.

Files:
- `frontend/src/components/supply/warehouses/WarehouseCapacityBoard.tsx` (new): hero card, one bar per depot (pallet capacity, docks, cold-room icon, outbound-today count, a "covered"/"N short" chip), click-through to the detail pane.
- `frontend/src/components/supply/warehouses/WarehouseList.tsx` (new): searchable depot roster, central-depot chip, cold-room icon, low-cover flag.
- `frontend/src/components/supply/warehouses/WarehouseDetail.tsx` (new): depot facts, a stock table sorted by lowest days-of-cover first (`Meter` coloured by `coverTone`), and an outbound-shipments table for the day.
- `frontend/src/components/supply/warehouses/WarehousesView.tsx` (new): page shell, KPI band (depots, pallet slots, cold storage, short-of-cover), wired to `useWarehouses`, `useWarehouse`.
- `frontend/src/app/(dashboard)/supply/warehouses/page.tsx`: wired to `WarehousesView`.

I deliberately did not compute a "capacity used %" from `reserved_units` against `capacity_pallets`, those are different units in the schema (unit-level stock reservations vs. pallet slots), so a percentage there would be fabricated. The hero instead shows the real fields side by side (pallets, docks, cold room, outbound, cover flag).

Commit: `ebd1bb7` "feat(supply): warehouses page with capacity board, depot list and stock cover"

## Gate evidence

- `npx tsc --noEmit`: clean, no errors.
- `npx eslint` on all new/changed D5+D7 files: clean, no warnings.
- `npm run test`: **10 test files, 99 tests passed** (unchanged from before this session; the driver/warehouse metric helpers were already covered by `lib.test.ts`).
- `npm run build`: clean production build, all `/supply/*` routes listed as prerendered/static (`○`) except the dynamic `[shipmentId]` route.

## Backend note (read before trusting port 8080)

The shared backend at `127.0.0.1:8080` was up but is a stale process (no `/api/v1/logistics/*` routes in its `openapi.json`, confirmed by `curl`; its command line traces back to the main worktree, started before the logistics router existed in a running process's memory). Per instructions I did not touch it. I started my own backend from this worktree on **port 8081** (`uvicorn app.main:app --host 127.0.0.1 --port 8081`, using the main worktree's `.venv`) and pointed the frontend at it for the build and for screenshots (`NEXT_PUBLIC_API_BASE=http://127.0.0.1:8081`, baked in at `npm run build` time, since `NEXT_PUBLIC_*` is inlined at build not at `next start`). I also found and killed a stale `next start -p 3010` process left over from before the rate-limit cutoff, which had been serving an old build against the broken port-8080 backend (that's what caused an initial round of 500s in the screenshot run below). Flag this for whoever integrates this branch: **port 8080 needs a restart with current code** before other lanes rely on it.

## Screenshots (1440x900, real backend data)

`docs/v2-shots/d2-{fleet,planning,drivers,warehouses}-{dark,light}.png`, all refreshed this session, zero console errors/hydration warnings on either theme.

## Comparison to reference images

- **`/supply/fleet`** (image 2, `131055.png`): matches, truck cargo bay grid with legend, KPI trio-plus (we show 6 tiles: vehicles/in-use/available/maintenance/service-due/utilisation, a superset of the reference's weight/pallets/alerts, which live on `/supply/planning` instead per the doc's mapping), service watchlist. No regression from this session (page untouched).
- **`/supply/planning`** (image 2 continued): Gantt with the red now-line, violet trip bars, KPI trio (weight/pallets/alerts pill), shipment queue with priority chips and Load buttons all present. No regression.
- **`/supply/drivers`** (image 3, `131117.png`): three-pane layout matches: roster list left (vehicle-id style rows swapped for driver rows: avatar, name, status chip, rating, depot, hours), a map centre with depot markers and live truck chips, and a detail panel right with header facts and driver info. Deviation: the reference shows vehicle facts plus a driver photo strip; we made the driver the primary entity of this page (per the task's own framing, "roster list, map, DriverPanel") and show the vehicle only as an id inside the panel, not a second facts block. Avatar initials stand in for the photo strip, which `supply-reference.md` explicitly allows ("we use `Avatar` initials, no photos").
- **`/supply/warehouses`**: no reference image (the four screenshots map only to fleet/planning/drivers). Built to the page-archetype rules instead: a distinct hero (horizontal capacity bars, not a table, not a gauge, not a gantt), at least three visual types (bar list, table with inline meters, plain table), density with 8+ cards, and its own accent (green "Covered" vs amber "N short" chips). Silhouette is unique against the other three pages (full-width hero + list/detail, vs. fleet/drivers' 3-column and planning's queue+gantt).

## Deviations

- Warehouse "capacity" hero uses raw `capacity_pallets` as a comparative bar rather than a manufactured utilisation percentage (see above, unit mismatch with `reserved_units`).
- Drivers map filters nothing by district scope beyond what the warehouses/positions API already returns for the active scope; a district-scoped view will show a subset of trucks, consistent with the rest of the app.
- No new e2e test files added under `frontend/e2e/d2/` beyond the existing generic `shot.mjs` (extended by D4, reused as is for D5/D7 with the `drivers,warehouses` names).

## Blockers

None. Both tasks are committed, gates are green, and screenshots are in place. The one thing worth a heads up (not a blocker for this lane): the shared backend on port 8080 is stale and should be restarted from current code before it's relied on for anything past `/api/v1/facilities` style routes.
