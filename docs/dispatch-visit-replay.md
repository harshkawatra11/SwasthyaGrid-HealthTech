# Dispatch replay per visit

The persisted, server-wide simulation can run past its seeded deliveries before a visitor opens Dispatch. A fresh browser document must instead start a private seeded logistics world. Client-side navigation, polling and SSE reconnects retain that document's identifier; reloads and new tabs generate a new identifier. No browser storage is used.

REST requests and SSE carry the same `demo_session` query parameter. The backend keeps bounded, idle-expiring in-memory worlds with independent repositories, recommendation services, clocks and stream hubs. These worlds never write the shared persisted logistics file. Requests without the parameter retain the existing operational behavior. Each active SSE connection advances its world once per second; REST reads also advance it. This is a demo replay, not a reset of shared operational records.

Verification: same identifier preserves progress, a new identifier starts with moving seeded shipments, and visitors do not share mutations. Backend process restarts/eviction restart that visitor's demo; persistent cross-instance demo sessions are outside this change.
