// Usage: node scripts/shot.mjs <baseUrl> <prefix> <path[,path...]> [width]
// Saves ../docs/v2-shots/<prefix>-<pathslug>-<theme>.png for dark and light.
import { chromium } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

const [base = "http://127.0.0.1:3005", prefix = "c1", paths = "/overview", width = "1440"] = process.argv.slice(2);
const outDir = path.resolve(process.cwd(), "..", "docs", "v2-shots");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: Number(width), height: 900 } });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem("sg-theme", t); } catch {}
  }, theme);
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || /hydrat/i.test(m.text())) && !/webpack-hmr|CORS|ERR_FAILED|net::ERR/.test(m.text())) problems.push(m.text().slice(0, 300));
  });
  for (const p of paths.split(",")) {
    await page.goto(base + p, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(4500);
    const slug = p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
    const file = path.join(outDir, `${prefix}-${slug}-${theme}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("saved", file);
  }
  console.log(theme, "console problems:", problems.length ? problems : "none");
  await ctx.close();
}
await browser.close();
