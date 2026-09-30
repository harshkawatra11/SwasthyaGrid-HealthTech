"use client";

/** Offline health for the data layer. The store lives in lib/api-health.ts (fed by every hook); this is its public entry. */
export { reportApiStatus, setApiOffline, useApiHealth } from "@/lib/api-health";
export { OfflineBanner } from "@/components/ds/OfflineBanner";
