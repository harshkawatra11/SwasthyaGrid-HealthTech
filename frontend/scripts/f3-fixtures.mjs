// Usage: node scripts/f3-fixtures.mjs [baseUrl]
// Writes offline fixtures for the endpoints lane F3 reads. Existing files are never rewritten.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = (process.argv[2] ?? "http://127.0.0.1:8084").replace(/\/$/, "");
const dir = path.resolve(process.cwd(), "src", "data", "fixtures");
mkdirSync(dir, { recursive: true });

const targets = {
  beds__forecast: "/api/v1/beds/forecast",
  doctors__attendance: "/api/v1/doctors/attendance",
  diagnostics: "/api/v1/diagnostics",
  performance: "/api/v1/performance",
  footfall__forecast: "/api/v1/footfall/forecast?district_id=district_jaipur_rural",
  "logistics__warehouses": "/api/v1/logistics/warehouses",
};

for (const [name, url] of Object.entries(targets)) {
  const file = path.join(dir, `${name}.json`);
  if (existsSync(file)) {
    console.log("skip (exists)", name);
    continue;
  }
  const res = await fetch(base + url);
  if (!res.ok) {
    console.log("failed", name, res.status);
    continue;
  }
  const body = await res.json();
  writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  console.log("wrote", name);
}
