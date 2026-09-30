// Usage: node scripts/shot-map.mjs <baseUrl> <prefix>
// Screenshots the /ds map demo in both themes, and samples truck marker transforms to prove smooth motion.
import { chromium } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

const [base = "http://127.0.0.1:3005", prefix = "c7"] = process.argv.slice(2);
const outDir = path.resolve(process.cwd(), "..", "docs", "v2-shots");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem("sg-theme", t); } catch {}
  }, theme);
  const page = await ctx.newPage();
  const failed = [];
  page.on("requestfailed", (r) => failed.push(r.url().slice(0, 100)));
  page.on("console", (m) => { if (m.type() === "error") failed.push("console: " + m.text().slice(0, 200)); });
  await page.goto(base + "/ds", { waitUntil: "networkidle" });
  const map = page.getByTestId("base-map");
  await map.scrollIntoViewIfNeeded();
  await page.waitForTimeout(6000);
  const tiles = await page.locator(".leaflet-tile-loaded").count();
  const samples = [];
  for (let i = 0; i < 12; i++) {
    samples.push(await page.evaluate(() => [...document.querySelectorAll(".leaflet-marker-icon")]
      .filter((e) => e.textContent.includes("SHP-"))
      .map((e) => e.style.transform)));
    await page.waitForTimeout(100);
  }
  const distinct = new Set(samples.map((s) => s[0])).size;
  const fillAttr = await page.evaluate(() => {
    const p = document.querySelector(".leaflet-overlay-pane path");
    return p ? getComputedStyle(p).fill : null;
  });
  console.log(theme, { tiles, trucks: samples[0].length, distinctFirstTruckTransforms: distinct, choroplethFill: fillAttr, failed: failed.slice(0, 5) });
  await map.screenshot({ path: path.join(outDir, `${prefix}-map-${theme}.png`) });
  await ctx.close();
}
await browser.close();
