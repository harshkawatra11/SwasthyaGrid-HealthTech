import {
  AudioLines,
  BedDouble,
  Building2,
  CalendarRange,
  Columns3,
  FlaskConical,
  Footprints,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Map,
  Pill,
  Radar,
  Stethoscope,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export const NAV_GROUPS = ["Command", "Districts", "Supply Chain", "Operations", "Insights"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export type NavItem = { href: string; label: string; icon: LucideIcon; group: NavGroup };

/** Sidebar items, in the order of plan section 3.2. */
export const navItems: NavItem[] = [
  { href: "/command", label: "Command Centre", icon: LayoutDashboard, group: "Command" },
  { href: "/voice", label: "Voice Control Room", icon: AudioLines, group: "Command" },
  { href: "/recommendations", label: "Recommendations", icon: ListChecks, group: "Command" },
  { href: "/districts", label: "District Comparison", icon: Columns3, group: "Districts" },
  { href: "/facilities", label: "Facilities", icon: Building2, group: "Districts" },
  { href: "/map", label: "Geo Intelligence", icon: Map, group: "Districts" },
  { href: "/supply", label: "Dispatch", icon: Radar, group: "Supply Chain" },
  { href: "/supply/fleet", label: "Fleet", icon: Truck, group: "Supply Chain" },
  { href: "/supply/drivers", label: "Drivers", icon: Users, group: "Supply Chain" },
  { href: "/supply/planning", label: "Load Planning", icon: CalendarRange, group: "Supply Chain" },
  { href: "/supply/warehouses", label: "Warehouses", icon: Warehouse, group: "Supply Chain" },
  { href: "/inventory", label: "Inventory", icon: Pill, group: "Operations" },
  { href: "/footfall", label: "Footfall", icon: Footprints, group: "Operations" },
  { href: "/beds", label: "Beds", icon: BedDouble, group: "Operations" },
  { href: "/doctors", label: "Doctors", icon: Stethoscope, group: "Operations" },
  { href: "/diagnostics", label: "Diagnostics", icon: FlaskConical, group: "Operations" },
  { href: "/analytics", label: "Analytics", icon: LineChart, group: "Insights" },
];

/** Drill-down routes of 3.2 that are reached from a list and are not in the sidebar. */
export const detailRoutes = [
  { pattern: "/districts/[districtId]", label: "District Detail" },
  { pattern: "/facilities/[facilityId]", label: "Facility Profile" },
  { pattern: "/supply/shipments/[shipmentId]", label: "Shipment Tracking" },
] as const;

/** The sidebar item that owns `pathname`: the longest href that is a segment-wise prefix. */
export function findActiveHref(pathname: string, items: readonly { href: string }[] = navItems): string | null {
  let best: string | null = null;
  for (const it of items) {
    const match = pathname === it.href || pathname.startsWith(it.href + "/");
    if (match && (best === null || it.href.length > best.length)) best = it.href;
  }
  return best;
}

export type Crumb = { label: string; href?: string };

/** Breadcrumbs from the route: group, page, then the drill-down id (resolved by `resolveName`). */
export function breadcrumbsFor(pathname: string, resolveName: (segment: string) => string = (s) => s): Crumb[] {
  const activeHref = findActiveHref(pathname);
  const item = navItems.find((n) => n.href === activeHref);
  if (!item) return [];
  const crumbs: Crumb[] = [{ label: item.group }, { label: item.label, href: item.href }];
  const rest = pathname.slice(item.href.length).split("/").filter(Boolean);
  if (rest.length > 0) crumbs.push({ label: resolveName(decodeURIComponent(rest[rest.length - 1])) });
  return crumbs;
}
