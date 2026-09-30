// Usage: node e2e/d1/shots.mjs <baseUrl> <slug> <path> [fullPage=1]
// Saves docs/v2-shots/d1-<slug>-{dark,light}.png at 1440x900.
import { chromium } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

const [base, slug, route, full = "1"] = process.argv.slice(2);
const outDir = path.resolve(process.cwd(), "..", "docs", "v2-shots");
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem("sg-theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error" && !/net::ERR|tile/i.test(m.text())) problems.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => problems.push("pageerror " + e.message));
  await page.goto(base + route, { waitUntil: "networkidle" }).catch((e) => console.log("goto", e.message.slice(0, 200)));
  await page.waitForTimeout(5000); console.log("len", await page.evaluate(() => document.body.innerText.length), page.url());
  const file = path.join(outDir, `d1-${slug}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: full === "1" });
  console.log("saved", file, theme, "problems:", problems.length ? problems : "none");
  await ctx.close();
}
await browser.close();
