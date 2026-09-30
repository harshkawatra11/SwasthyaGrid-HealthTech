// Usage: node scripts/export-f2-fixtures.mjs [apiBase]
// Exports the endpoints used by /districts, /facilities and /map into src/data/fixtures using the
// naming rule of lib/api/fixtures.ts. Existing files are never overwritten (lane A's export wins).
// Data comes from the lane A backend running in-process against seed_districts.json.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = (process.argv[2] ?? "http://127.0.0.1:8082").replace(/\/$/, "");
const outDir = path.resolve(process.cwd(), "src", "data", "fixtures");
mkdirSync(outDir, { recursive: true });

async function get(p) {
  const res = await fetch(`${base}/api/v1${p}`);
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  return res.json();
}

function save(name, body) {
  const file = path.join(outDir, `${name}.json`);
  if (existsSync(file)) {
    console.log("skip (exists)", name);
    return;
  }
  writeFileSync(file, JSON.stringify(body));
  console.log("wrote", name);
}

const plain = [
  ["/insights/state-summary", "insights__state-summary"],
  ["/insights/facility-matrix", "insights__facility-matrix"],
  ["/insights/medicine-matrix", "insights__medicine-matrix"],
  ["/performance", "performance"],
  ["/beds/forecast", "beds__forecast"],
  ["/doctors/attendance", "doctors__attendance"],
  ["/diagnostics", "diagnostics"],
  ["/logistics/warehouses", "logistics__warehouses"],
  ["/logistics/kpis", "logistics__kpis"],
];
for (const [p, name] of plain) save(name, await get(p));

const facilities = (await get("/facilities")).facilities;
for (const f of facilities) save(`facilities__${f.id}__profile`, await get(`/facilities/${f.id}/profile`));

const wh = (await get("/logistics/warehouses")).items;
for (const w of wh) save(`logistics__warehouses__${w.id}`, await get(`/logistics/warehouses/${w.id}`));

const districts = (await get("/districts")).districts;
const byDistrict = {};
for (const d of districts) byDistrict[d.id] = await get(`/footfall/forecast?district_id=${d.id}`);
save("footfall__forecast", byDistrict[districts[0].id]);
// Own namespace: per-district footfall used by small multiples when offline.
const own = path.resolve(process.cwd(), "src", "components", "districts");
mkdirSync(own, { recursive: true });
const ownFile = path.join(own, "footfall-by-district.json");
if (!existsSync(ownFile)) {
  writeFileSync(ownFile, JSON.stringify(byDistrict));
  console.log("wrote footfall-by-district.json");
}
