// Builds public/geo/rajasthan-5.geojson from geoBoundaries IND ADM2 (ODbL 1.0,
// source: Pathways Data Pvt. Ltd., lgdirectory.gov.in).
// Usage: node scripts/build-geo.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC =
  "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM2/geoBoundaries-IND-ADM2_simplified.geojson";
const OUT = path.resolve(process.cwd(), "public", "geo", "rajasthan-5.geojson");

// shapeName (lowercase) candidates in priority order, per district id.
const WANTED = [
  { id: "district_jaipur_rural", names: ["jaipur", "jaipur rural", "jaipur gramin"] },
  { id: "district_alwar", names: ["alwar"] },
  { id: "district_bikaner", names: ["bikaner"] },
  { id: "district_udaipur", names: ["udaipur"] },
  { id: "district_kota", names: ["kota"] },
];

const round = (n) => Math.round(n * 1e4) / 1e4;
function roundCoords(c) {
  return typeof c[0] === "number" ? [round(c[0]), round(c[1])] : c.map(roundCoords);
}

const res = await fetch(SRC);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
const text = await res.text();
if (text.startsWith("version https://git-lfs")) throw new Error("got a git LFS pointer, not the data");
const src = JSON.parse(text);
console.log("source features:", src.features.length);

const features = [];
for (const w of WANTED) {
  let match;
  for (const n of w.names) {
    // Several states share names (Kota, Udaipur exist only in Rajasthan; Alwar too), take the first exact match.
    match = src.features.find((f) => String(f.properties.shapeName).trim().toLowerCase() === n);
    if (match) break;
  }
  if (!match) throw new Error(`no boundary found for ${w.id}`);
  console.log(`${w.id} <- shapeName "${match.properties.shapeName}" (${match.geometry.type})`);
  features.push({
    type: "Feature",
    properties: { district_id: w.id, shapeName: match.properties.shapeName, shapeID: match.properties.shapeID },
    geometry: { type: match.geometry.type, coordinates: roundCoords(match.geometry.coordinates) },
  });
}

const out = { type: "FeatureCollection", features };
mkdirSync(path.dirname(OUT), { recursive: true });
const body = JSON.stringify(out);
writeFileSync(OUT, body);
console.log(`wrote ${OUT} (${(body.length / 1024).toFixed(1)} KB)`);
