// Usage: node scripts/shot-print.mjs <url> <outfile>  (print media, A4 width)
import { chromium } from "@playwright/test";
const [url, out] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 794, height: 1123 } });
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForTimeout(4000);
await p.emulateMedia({ media: "print" });
await p.screenshot({ path: out, fullPage: true });
await b.close();
