/**
 * Offline fixtures. Files live in `src/data/fixtures/*.json`, named after the endpoint path with
 * `/api/v1/` removed and `/` replaced by `__` (for example `insights__state-summary.json`), and
 * hold the raw response body for scope `all`. A missing file yields the caller's typed empty value.
 */

export function fixtureNameFor(path: string): string {
  const noQuery = path.split("?")[0];
  return noQuery.replace(/^\/?api\/v1\//, "").replace(/^\//, "").replace(/\//g, "__");
}

const cache = new Map<string, unknown>();

export async function loadFixture<T>(name: string, empty: T): Promise<T> {
  if (cache.has(name)) return cache.get(name) as T;
  try {
    const mod = (await import(`@/data/fixtures/${name}.json`)) as { default: T };
    cache.set(name, mod.default);
    return mod.default;
  } catch {
    return empty;
  }
}

/** Clear the memo (tests). */
export function clearFixtureCache(): void {
  cache.clear();
}

function hasDistrict(item: unknown): item is { district_id: string } {
  return typeof item === "object" && item !== null && "district_id" in item;
}

/** Keep only rows of `scope` (a district id). Arrays, and array-valued top-level keys, are filtered when rows carry `district_id`. */
export function filterByDistrict<T>(data: T, scope: string | undefined): T {
  if (!scope || scope === "all") return data;
  const keep = (rows: unknown[]) => rows.filter((r) => !hasDistrict(r) || r.district_id === scope);
  if (Array.isArray(data)) return keep(data) as unknown as T;
  if (data && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) out[k] = Array.isArray(v) ? keep(v) : v;
    return out as T;
  }
  return data;
}
