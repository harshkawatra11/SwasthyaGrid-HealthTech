/** Pure helpers for the cargo bay of `TruckCargoView` (layout, colours, counts). */

export type CargoSlot = {
  index: number;
  state: "loaded" | "reserved" | "empty";
  medicine_name?: string | null;
  shipment_id?: string | null;
  cold_chain: boolean;
  weight_kg?: number | null;
};

export type GridRect = { x: number; y: number; w: number; h: number };
export type GridCell = GridRect & { index: number; col: number; row: number };

export const CARGO_ROWS = 2;

/** Number of grid columns for a slot count: two rows, so ceil(slots / 2). */
export function cargoColumns(slotCount: number): number {
  return Math.max(1, Math.ceil(Math.max(0, slotCount) / CARGO_ROWS));
}

/**
 * Lay `slotCount` cells out in two rows inside `inner`. Slots fill column by column starting at
 * the cab end (index 0 top row, index 1 bottom row, index 2 next column top row ...), which is
 * how a bay is really loaded. An odd count leaves the last column with one cell in the top row.
 */
export function cargoLayout(slotCount: number, inner: GridRect, gap = 4, maxCellW = Infinity): GridCell[] {
  const n = Math.max(0, Math.floor(slotCount));
  const cols = cargoColumns(n);
  const cw = Math.min(maxCellW, (inner.w - gap * (cols - 1)) / cols);
  const ch = (inner.h - gap * (CARGO_ROWS - 1)) / CARGO_ROWS;
  const gridW = cw * cols + gap * (cols - 1);
  const x0 = inner.x + (inner.w - gridW) / 2;
  const cells: GridCell[] = [];
  for (let i = 0; i < n; i++) {
    const col = Math.floor(i / CARGO_ROWS);
    const row = i % CARGO_ROWS;
    cells.push({ index: i, col, row, x: x0 + col * (cw + gap), y: inner.y + row * (ch + gap), w: cw, h: ch });
  }
  return cells;
}

/** Medicine to fixed series colour (fixed order, never cycled). Tetanus Toxoid folds into muted. */
const MEDICINE_ORDER = [
  "Paracetamol",
  "ORS",
  "Anti-Snake Venom (ASV)",
  "Anti-Rabies Vaccine (ARV)",
  "Oxytocin",
  "Adrenaline (Epinephrine)",
] as const;

export function medicineColor(name: string | null | undefined): string {
  if (!name) return "var(--text-muted)";
  const i = (MEDICINE_ORDER as readonly string[]).indexOf(name);
  return i >= 0 ? `var(--series-${i + 1})` : "var(--text-muted)";
}

const SHORT: Record<string, string> = {
  Paracetamol: "PCM",
  ORS: "ORS",
  "Anti-Snake Venom (ASV)": "ASV",
  "Anti-Rabies Vaccine (ARV)": "ARV",
  Oxytocin: "OXY",
  "Adrenaline (Epinephrine)": "ADR",
  "Tetanus Toxoid (TT)": "TT",
};

/** Initials shown inside a loaded cell. */
export function medicineInitials(name: string | null | undefined): string {
  if (!name) return "";
  if (SHORT[name]) return SHORT[name];
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export type CargoCounts = { loaded: number; reserved: number; empty: number; cold: number; total: number };

export function cargoCounts(slots: readonly CargoSlot[]): CargoCounts {
  const c: CargoCounts = { loaded: 0, reserved: 0, empty: 0, cold: 0, total: slots.length };
  for (const s of slots) {
    c[s.state] += 1;
    if (s.cold_chain) c.cold += 1;
  }
  return c;
}

/** Pad or trim slots to exactly `count` cells so a vehicle with no cargo still draws its bay. */
export function normaliseSlots(slots: readonly CargoSlot[] | undefined, count: number): CargoSlot[] {
  const out: CargoSlot[] = [];
  for (let i = 0; i < count; i++) {
    out.push(slots?.[i] ?? { index: i, state: "empty", cold_chain: false });
  }
  return out;
}

export type ClassArt = { boxWidth: number; boxHeight: number; label: string; cabScale: number };

/** Trailer box width by vehicle class (viewBox is 640 wide, the cab takes the left ~200). */
export function classArt(vehicleClass: string): ClassArt {
  switch (vehicleClass) {
    case "van":
      return { boxWidth: 190, boxHeight: 128, label: "Light van", cabScale: 0.85 };
    case "reefer_van":
      return { boxWidth: 220, boxHeight: 130, label: "Refrigerated van", cabScale: 0.85 };
    case "light_truck":
      return { boxWidth: 300, boxHeight: 140, label: "Light truck", cabScale: 0.95 };
    case "reefer_truck":
      return { boxWidth: 340, boxHeight: 148, label: "Refrigerated truck", cabScale: 1 };
    default:
      return { boxWidth: 400, boxHeight: 152, label: "Medium truck", cabScale: 1 };
  }
}
