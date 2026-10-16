# Dispatch replay per visit

The persisted, server-wide simulation can run past its seeded deliveries before a visitor opens Dispatch. A fresh browser document must instead start a private seeded logistics world. Client-side navigation, polling and SSE reconnects retain that document's identifier; reloads and new tabs generate a new identifier. No browser storage is used.

REST requests and SSE carry the same `demo_session` query parameter. The backend keeps bounded, idle-expiring in-memory worlds with independent repositories, recommendation services, clocks and stream hubs. These worlds never write the shared persisted logistics file. Requests without the parameter retain the existing operational behavior. Each active SSE connection advances its world once per second; REST reads also advance it. This is a demo replay, not a reset of shared operational records.

Verification: same identifier preserves progress, a new identifier starts with moving seeded shipments, and visitors do not share mutations. Backend process restarts/eviction restart that visitor's demo; persistent cross-instance demo sessions are outside this change.

Deployment: Vercel's configured Root Directory is `frontend`. The root `vercel.json` delegates install/build/output defaults to Next.js; it must not prepend another `cd frontend` or `frontend/.next` to paths already relative to that directory.

Opening density: visitor replays assign available non-refrigerated district trucks and on-shift drivers to distinct seeded routes (two to four per district, four in Udaipur). Destinations rotate through facilities rather than repeatedly selecting the same low-stock centre. Trips start at staggered early progress, and the visitor clock runs at 10x so the opening movement remains visible longer. The operational scenario keeps its existing fleet allocation and 60x default.

Expanded multi-district demo: each visitor's synthetic fleet is supplemented to eight available trucks and eight on-shift drivers per district before seeding. All five districts therefore open with eight moving shipments each (40 across the network). Routes rotate through every facility, with staggered progress to separate trucks sharing a road. Supplementary vehicles/drivers exist only inside the visitor replay and are labelled as demo resources; the operational fleet is unchanged.

Visitor controls: speed and reset requests with a valid `demo_session` operate only on that visitor's world, including in production. Requests targeting the shared operational world retain the production admin restriction. Map dots and label edges use stable shipment-identity colors; status badges retain semantic status colors. A map caption explains the distinction.
