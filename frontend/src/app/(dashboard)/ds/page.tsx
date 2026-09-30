"use client";

import { useState } from "react";
import { Boxes, Inbox } from "lucide-react";
import { Card } from "@/components/ds/Card";
import { LiveDot } from "@/components/ds/LiveDot";
import { KpiTile } from "@/components/ds/KpiTile";
import { RiskChip } from "@/components/ds/RiskChip";
import { StatusChip } from "@/components/ds/StatusChip";
import { PriorityChip } from "@/components/ds/PriorityChip";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { HeatmapMatrix } from "@/components/ds/HeatmapMatrix";
import { Sparkline } from "@/components/ds/Sparkline";
import { Meter } from "@/components/ds/Meter";
import { Stepper } from "@/components/ds/Stepper";
import { RouteTimeline } from "@/components/ds/RouteTimeline";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ds/Tabs";
import { Select } from "@/components/ds/Select";
import { FilterBar } from "@/components/ds/FilterBar";
import { EmptyState } from "@/components/ds/EmptyState";
import { Skeleton } from "@/components/ds/Skeleton";
import { OfflineBanner } from "@/components/ds/OfflineBanner";
import { Avatar } from "@/components/ds/Avatar";
import { PageHeader } from "@/components/ds/PageHeader";
import { StatBlock } from "@/components/ds/StatBlock";
import { toast } from "@/components/ds/Toaster";
import { ThemeToggle } from "@/components/ds/ThemeToggle";
import { Kbd } from "@/components/ds/Kbd";
import { MapDemo } from "./MapDemo";
import { ChartsDemo } from "./ChartsDemo";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetTrigger,
  Tooltip,
} from "@/components/ds/overlays";
import { setApiOffline } from "@/lib/api-health";
import { fmtInt, fmtKg, fmtKm, fmtDuration, fmtRelative, fmtClock, fmtDateTime, fmtPct } from "@/lib/format";
import type { HeatScale } from "@/lib/heat";
import type { RiskLevel, ShipmentStatus } from "@/lib/domain";

type Row = { id: string; facility: string; risk: RiskLevel; cover: number; units: number };

const ROWS: Row[] = [
  { id: "1", facility: "PHC Kota-4", risk: "critical", cover: 1.5, units: 7 },
  { id: "2", facility: "PHC Alwar-4", risk: "stress", cover: 4.2, units: 12 },
  { id: "3", facility: "CHC Bikaner-2", risk: "monitor", cover: 6.8, units: 240 },
  { id: "4", facility: "PHC Udaipur-1", risk: "healthy", cover: 21, units: 1200 },
  { id: "5", facility: "PHC Jaipur-9", risk: "healthy", cover: 14.5, units: 980 },
];

const COLUMNS: Column<Row>[] = [
  { key: "facility", header: "Facility", accessor: (r) => r.facility, sortable: true },
  { key: "risk", header: "Risk", accessor: (r) => r.risk, sortable: true, cell: (r) => <RiskChip level={r.risk} size="sm" /> },
  { key: "cover", header: "Days cover", accessor: (r) => r.cover, sortable: true, align: "right" },
  { key: "units", header: "Units", accessor: (r) => r.units, sortable: true, align: "right", cell: (r) => fmtInt(r.units) },
];

const HEAT_ROWS = [
  { id: "r1", label: "PHC Kota-4", group: "Kota" },
  { id: "r2", label: "PHC Kota-7", group: "Kota" },
  { id: "r3", label: "CHC Alwar-2", group: "Alwar" },
  { id: "r4", label: "PHC Alwar-4", group: "Alwar" },
];
const HEAT_COLS = ["Stock", "Beds", "Docs", "Diag", "Foot"].map((l) => ({ id: l, label: l }));
const HEAT_SCALE: HeatScale = { thresholds: [40, 55, 70, 85], higherIsWorse: true };

function heatValue(r: string, c: string): number | null {
  if (r === "r4" && c === "Docs") return null;
  const seed = (r.charCodeAt(1) * 7 + c.charCodeAt(0) * 13) % 100;
  return seed;
}

const STATUSES: ShipmentStatus[] = ["recommended", "approved", "loading", "in_transit", "delayed", "arrived", "delivered", "cancelled"];
const NOW = "2026-09-26T08:30:00Z";

export default function DesignSystemPage() {
  const [seg, setSeg] = useState("map");
  const [sel, setSel] = useState("all");

  return (
    <div className="space-y-6">
      <OfflineBanner />
      <PageHeader
        eyebrow="Design system"
        title="Control Room components"
        description="Every component in the v2 library with sample data. Hidden route, not in the sidebar."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Design system" }]}
        actions={
          <>
            <button
              type="button"
              className="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12px] hover:bg-surface-3"
              onClick={() => setApiOffline(true)}
            >
              Simulate offline
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12px] hover:bg-surface-3"
              onClick={() => setApiOffline(false)}
            >
              Back online
            </button>
            <ThemeToggle />
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Critical facilities" value={10} unit="of 40" tone="critical" href="/facilities" delta={{ value: 2, direction: "down", good: "down" }} sparkline={[12, 11, 12, 11, 10, 10]} hint="Stock cover under 3 days" />
        <KpiTile label="On-time rate" value="94.2" unit="%" tone="good" delta={{ value: 1.2, direction: "up", good: "up" }} sparkline={[88, 90, 91, 93, 92, 94]} />
        <KpiTile label="In transit" value={fmtInt(12)} sparkline={[3, 5, 4, 8, 9, 12]} />
        <KpiTile label="Delayed" value={2} tone="warning" delta={{ value: 1, direction: "up", good: "down" }} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Chips" eyebrow="Status" live actions={<Kbd>Ctrl K</Kbd>}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(["healthy", "monitor", "stress", "critical"] as RiskLevel[]).map((l) => (
                <RiskChip key={l} level={l} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <StatusChip key={s} status={s} live />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PriorityChip priority="critical" />
              <PriorityChip priority="high" />
              <PriorityChip priority="normal" />
              <span className="inline-flex items-center gap-1 text-[12px] text-muted"><LiveDot state="live" /> live</span>
              <span className="inline-flex items-center gap-1 text-[12px] text-muted"><LiveDot state="stale" /> stale</span>
              <span className="inline-flex items-center gap-1 text-[12px] text-muted"><LiveDot state="offline" /> offline</span>
            </div>
            <div className="flex items-center gap-2">
              {[24, 32, 48, 64].map((s) => (
                <Avatar key={s} name="Ravi Kumar" size={s as 24 | 32 | 48 | 64} />
              ))}
              <Avatar name="Meera Singh" />
              <Avatar name="Sunita Devi" />
              <Avatar name="Arjun" />
            </div>
          </div>
        </Card>

        <Card title="Meters, sparkline, stats" footer="Simulated operational data.">
          <div className="space-y-4">
            <Meter value={45} max={100} label="Load 45%" />
            <Meter value={82} max={100} label="Load 82%" />
            <Meter value={96} max={100} label="Load 96%" />
            <Meter value={30} max={100} tone="critical" label="Forced critical tone" showValue={false} />
            <Sparkline data={[3, 5, 4, 8, 6, 9, 12]} width={160} height={32} color="var(--series-2)" />
            <StatBlock
              columns={3}
              items={[
                { label: "Weight", value: fmtKg(1234.5), mono: true },
                { label: "Distance", value: fmtKm(114), mono: true },
                { label: "Duration", value: fmtDuration(85), mono: true },
                { label: "ETA", value: fmtRelative("2026-09-26T08:48:00Z", NOW), mono: true },
                { label: "Departed", value: fmtClock("2026-09-26T08:35:00Z"), mono: true },
                { label: "Updated", value: fmtDateTime("2026-09-26T08:35:00Z"), mono: true },
                { label: "Occupancy", value: fmtPct(82.4), mono: true },
                { label: "Driver", value: "Ravi Kumar" },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Data table" eyebrow="Sortable">
          <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} initialSort={{ key: "cover", dir: "asc" }} onRowClick={() => toast({ title: "Row opened", tone: "info" })} density="compact" />
        </Card>
        <Card title="Heatmap matrix" eyebrow="Stress index">
          <HeatmapMatrix rows={HEAT_ROWS} cols={HEAT_COLS} value={heatValue} scale={HEAT_SCALE} format={(v) => `${v}`} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Stepper and route timeline">
          <div className="space-y-6">
            <Stepper
              steps={[
                { key: "a", label: "Approved", at: "2026-09-26T03:10:00Z", state: "done" },
                { key: "b", label: "Loading", at: "2026-09-26T03:40:00Z", state: "done" },
                { key: "c", label: "In transit", at: "2026-09-26T04:10:00Z", state: "current" },
                { key: "d", label: "Arrived", state: "upcoming" },
                { key: "e", label: "Delivered", state: "upcoming" },
              ]}
            />
            <RouteTimeline
              stops={[
                { label: "DDW Kota", sub: "Warehouse", at: "2026-09-26T04:10:00Z", state: "done" },
                { label: "Chittorgarh bypass", sub: "Waypoint", state: "current" },
                { label: "PHC Kota-4", sub: "Destination, ETA in 18 min", state: "upcoming" },
              ]}
            />
          </div>
        </Card>
        <Card title="Controls">
          <div className="space-y-4">
            <FilterBar className="static -mx-0 mb-0 border-b-0 bg-transparent px-0 py-0">
              <SegmentedControl
                value={seg}
                onChange={setSeg}
                options={[
                  { value: "map", label: "Map" },
                  { value: "list", label: "List" },
                  { value: "board", label: "Board" },
                ]}
              />
              <Select
                value={sel}
                onValueChange={setSel}
                ariaLabel="District"
                options={[
                  { value: "all", label: "All districts" },
                  { value: "kota", label: "Kota" },
                  { value: "alwar", label: "Alwar" },
                ]}
              />
            </FilterBar>
            <Tabs defaultValue="one">
              <TabsList>
                <TabsTrigger value="one">Overview</TabsTrigger>
                <TabsTrigger value="two">Cargo</TabsTrigger>
              </TabsList>
              <TabsContent value="one">Overview tab content.</TabsContent>
              <TabsContent value="two">Cargo tab content.</TabsContent>
            </Tabs>
            <div className="flex flex-wrap gap-2">
              <Dialog>
                <DialogTrigger className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] hover:bg-surface-3">Dialog</DialogTrigger>
                <DialogContent title="Approve shipment" description="This creates a shipment in the approved state.">
                  <p className="text-[13px] text-muted">Focus is trapped here and restored on close.</p>
                </DialogContent>
              </Dialog>
              <Sheet>
                <SheetTrigger className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] hover:bg-surface-3">Sheet</SheetTrigger>
                <SheetContent title="Details">Sheet body.</SheetContent>
              </Sheet>
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] hover:bg-surface-3">Menu</DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem>Open</DropdownMenuItem>
                  <DropdownMenuItem>Cancel shipment</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Popover>
                <PopoverTrigger className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] hover:bg-surface-3">Popover</PopoverTrigger>
                <PopoverContent>Popover content.</PopoverContent>
              </Popover>
              <Tooltip content="Tooltip text">
                <button type="button" className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] hover:bg-surface-3">Tooltip</button>
              </Tooltip>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["info", "success", "warning", "critical"] as const).map((tone) => (
                <button
                  key={tone}
                  type="button"
                  className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] hover:bg-surface-3"
                  onClick={() => toast({ title: `A ${tone} toast`, body: "Auto-dismisses after 5 seconds.", tone })}
                >
                  Toast {tone}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Empty state">
          <EmptyState icon={Inbox} title="No shipments yet" body="Approve a recommendation to create one." />
        </Card>
        <Card title="Skeleton">
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-16 w-full" />
            <div className="flex items-center gap-2 text-[12px] text-muted"><Boxes size={14} /> Loading placeholders</div>
          </div>
        </Card>
      </div>

      <MapDemo />
      <ChartsDemo />
    </div>
  );
}
