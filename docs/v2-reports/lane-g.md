# Lane G report (CRM delivery loop): G1, G3, G4

CRM repo branch `feat/deliveries`. G2 (Firestore upsert, 40 logins) and G5 not done (G2 needs user approval).
No live gate run: backend endpoints (lane A) were not available; everything was tested against mocks and a fake Firestore.

TASK G1 DONE
Files: src/lib/swasthyagrid.ts, src/lib/deliveries.ts, src/app/api/deliveries/route.ts, src/app/api/deliveries/[id]/confirm/route.ts, src/middleware.ts, src/app/api/medicines/route.ts, src/app/api/medicines/[id]/route.ts, .env.example, package.json, package-lock.json, vitest.config.ts, tests/*
Commit: e51ee23
Commands run: npx vitest run (22 passed, 2 files); npx tsc --noEmit (no output); npx eslint src tests vitest.config.ts (no output)
Gate evidence: unit tests cover request validation (10% cap, integers, enum, note under 500, unknown/duplicate lines), K15 medicine validation, transaction (increments once, second call no-op, creates missing row with catalogue consumption and threshold 5, lowest row picked with warning, zero-unit lines skipped), sgFetch (token header, 127.0.0.1:8080 default, env base, AbortSignal.timeout(8000), real local http server receives token).
Deviations: vitest 3.x used (vitest 5 has an unresolvable @types/node peer conflict with the CRM's @types/node 20). Admin GET /api/deliveries with no facility_id proxies shipments?status=arrived&limit=200 (plan 10.3 G4 text). On a repeat confirm the CRM applies the backend's stored pod (pod_id, received, condition, note) instead of the new body, so an interrupted first attempt is completed with the original figures. Response also carries already_confirmed. Confirm route fetches the facility inbound list first to get shipped lines (needed for validation, also proves the shipment belongs to the caller); 404 if absent. Backend 5xx/401 on POD is returned to the browser as 502 with a generic message.

TASK G3 DONE
Files: src/components/IncomingDeliveries.tsx, src/app/(portal)/dashboard/page.tsx, src/app/api/deliveries/route.ts
Commit: 6773a60
Commands run: npx tsc --noEmit (clean); npx eslint on touched files (clean); vitest 22 passed
Gate evidence: section polls /api/deliveries every 10 s; arrived items show Confirm receipt with inline form (received prefilled with shipped, condition, note); success flashes a toast and reloads the facility bundle. Delivered items show "Received by {name} at {time}" using received_by/received_at that GET /api/deliveries adds from the CRM's own deliveries/{id} marker. No browser/live check done.
Deviations: fixed the pre-existing react-hooks/set-state-in-effect lint error in the dashboard's load effect (setTimeout(load, 0)) so eslint is clean for that file. Received-by data comes from the Firestore marker, not the backend (InboundItem has no pod field in the contract).

TASK G4 DONE
Files: src/components/DeliveriesAwaiting.tsx, src/app/(portal)/admin/page.tsx
Commit: e60f945
Commands run: npx tsc --noEmit (clean); npx eslint src tests vitest.config.ts (clean); npm run build (success, routes /api/deliveries and /api/deliveries/[id]/confirm listed, Proxy (Middleware) present); vitest 22 passed
Gate evidence: build passes; admin page renders the table above the roster, polling every 10 s. No live check.
Deviations: none.

Blockers: live gate (phc-rural-14 confirm, second confirm no-op, Firestore counts) needs backend lane A endpoints, LOGISTICS_SERVICE_TOKEN/SWASTHYAGRID_SERVICE_TOKEN set in both env files, and G2 approval for Firestore data.
