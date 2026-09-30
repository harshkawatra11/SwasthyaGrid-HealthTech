export type SortDir = "asc" | "desc";

export function compareValues(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined || (typeof a === "number" && Number.isNaN(a));
  const bNull = b === null || b === undefined || (typeof b === "number" && Number.isNaN(b));
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "en-IN");
}

/** Stable sort. Empty values always sort last regardless of direction. */
export function sortRows<T>(rows: T[], accessor: (r: T) => unknown, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: accessor(r) }))
    .sort((x, y) => {
      const xEmpty = x.v === null || x.v === undefined;
      const yEmpty = y.v === null || y.v === undefined;
      if (xEmpty !== yEmpty) return xEmpty ? 1 : -1;
      return sign * compareValues(x.v, y.v) || x.i - y.i;
    })
    .map((x) => x.r);
}
