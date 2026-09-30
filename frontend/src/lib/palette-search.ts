import { navItems } from "@/components/shell/nav-items";
import type { EntityIndex } from "@/lib/entity-index";

export type PaletteGroup = "Pages" | "Districts" | "Facilities" | "Shipments" | "Vehicles" | "Drivers";

export type PaletteEntry = { id: string; group: PaletteGroup; label: string; sub?: string; href: string };

export const GROUP_ORDER: PaletteGroup[] = ["Pages", "Districts", "Facilities", "Shipments", "Vehicles", "Drivers"];
export const PER_GROUP = 8;

function all(index: EntityIndex): PaletteEntry[] {
  return [
    ...navItems.map((n) => ({ id: `page:${n.href}`, group: "Pages" as const, label: n.label, href: n.href })),
    ...index.districts.map((d) => ({
      id: `district:${d.id}`,
      group: "Districts" as const,
      label: d.name,
      href: `/districts/${d.id}`,
    })),
    ...index.facilities.map((f) => ({
      id: `facility:${f.id}`,
      group: "Facilities" as const,
      label: f.name,
      sub: `${f.type} ${index.districtName(f.districtId)}`,
      href: `/facilities/${f.id}`,
    })),
    ...index.shipments.map((s) => ({
      id: `shipment:${s.id}`,
      group: "Shipments" as const,
      label: s.id,
      sub: s.destinationName,
      href: `/supply/shipments/${s.id}`,
    })),
    ...index.vehicles.map((v) => ({
      id: `vehicle:${v.id}`,
      group: "Vehicles" as const,
      label: v.registration,
      href: `/supply/fleet?vehicle=${encodeURIComponent(v.id)}`,
    })),
    ...index.drivers.map((d) => ({
      id: `driver:${d.id}`,
      group: "Drivers" as const,
      label: d.name,
      href: `/supply/drivers?driver=${encodeURIComponent(d.id)}`,
    })),
  ];
}

/** Case-insensitive substring match on label and sub text; at most 8 per group, groups in fixed order. */
export function searchPalette(index: EntityIndex, query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  const counts = new Map<PaletteGroup, number>();
  const out: PaletteEntry[] = [];
  const entries = all(index).filter((e) => q === "" || e.label.toLowerCase().includes(q) || (e.sub ?? "").toLowerCase().includes(q));
  for (const g of GROUP_ORDER) {
    for (const e of entries) {
      if (e.group !== g) continue;
      const c = counts.get(g) ?? 0;
      if (c >= PER_GROUP) break;
      counts.set(g, c + 1);
      out.push(e);
    }
  }
  return out;
}
