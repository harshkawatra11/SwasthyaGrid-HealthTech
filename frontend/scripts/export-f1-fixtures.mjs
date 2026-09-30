// Dumps the endpoints used by the Command Centre and Recommendations pages from a running backend
// into src/data/fixtures/*.json (scope "all"), named per plan 9.1 (path without /api/v1/, "/" -> "__").
// Usage: node scripts/export-f1-fixtures.mjs [http://127.0.0.1:8081]
// Lane A's own export script overwrites these on merge (prefer theirs on conflict).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] ?? "http://127.0.0.1:8081").replace(/\/$/, "");
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "fixtures");

const DISTRICTS = [
  "district_jaipur_rural",
  "district_alwar",
  "district_bikaner",
  "district_udaipur",
  "district_kota",
];

const paths = [
  "/api/v1/insights/state-summary",
  "/api/v1/insights/facility-matrix",
  "/api/v1/insights/medicine-matrix",
  "/api/v1/insights/briefing",
  "/api/v1/logistics/kpis",
  "/api/v1/logistics/series/volume?days=90",
  "/api/v1/logistics/status-breakdown",
  "/api/v1/logistics/shipments?limit=200",
  "/api/v1/logistics/warehouses",
  "/api/v1/logistics/clock",
  "/api/v1/footfall/forecast",
  "/api/v1/recommendations",
];

// Per-district footfall, kept beside the single-file fixture so offline pages can show five lines.
async function get(path) {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function nameFor(path) {
  return path.split("?")[0].replace(/^\/api\/v1\//, "").replace(/\//g, "__");
}

await mkdir(out, { recursive: true });
for (const p of paths) {
  const body = await get(p);
  await writeFile(join(out, `${nameFor(p)}.json`), JSON.stringify(body, null, 1) + "\n");
  console.log("wrote", nameFor(p));
}
const footfall = {};
for (const d of DISTRICTS) footfall[d] = await get(`/api/v1/footfall/forecast?district_id=${d}`);
await writeFile(join(out, "footfall__by-district.json"), JSON.stringify(footfall, null, 1) + "\n");
console.log("wrote footfall__by-district");
