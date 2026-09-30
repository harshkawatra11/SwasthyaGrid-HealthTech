// Usage: node e2e/d2/shot.mjs <name[,name]> [baseUrl] [width] [height]
// name is a /supply/<name> page. Saves ../docs/v2-shots/d2-<name>-<theme>.png (viewport and full page).
import { chromium } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

const [names = "fleet", base = "http://127.0.0.1:3010", width = "1440", height = "900"] = process.argv.slice(2);
const outDir = path.resolve(process.cwd(), "..", "docs", "v2-shots");
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: Number(width), height: Number(height) } });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem("sg-theme", t); } catch {}
  }, theme);
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || /hydrat/i.test(m.text())) && !/webpack-hmr/.test(m.text())) problems.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => problems.push("pageerror " + e.message));
  for (const n of names.split(",")) {
    await page.goto(`${base}/supply/${n}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(5000);
    const file = path.join(outDir, `d2-${n}-${theme}${width === "1440" ? "" : "-" + width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("saved", file);
  }
  console.log(theme, "console problems:", problems.length ? problems : "none");
  await ctx.close();
}
await browser.close();
