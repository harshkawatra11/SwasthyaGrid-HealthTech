// Usage: node scripts/shot-f1.mjs <baseUrl> <name> <path> [sliceDir] [waitTestId]
// Saves docs/v2-shots/f1-<name>-<theme>.png (1440x900 viewport), -full.png (whole page), and 900px slices to sliceDir.
import { chromium } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

const [base, name, route, sliceDir, waitTestId] = process.argv.slice(2);
const outDir = path.resolve(process.cwd(), "..", "docs", "v2-shots");
mkdirSync(outDir, { recursive: true });
if (sliceDir) mkdirSync(sliceDir, { recursive: true });

const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("sg-theme", t);
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || /hydrat/i.test(m.text())) && !/webpack-hmr/.test(m.text())) problems.push(m.text().slice(0, 300));
  });
  // "networkidle" never resolves against a live SSE stream; the shared backend can also be
  // slow under load from other worktrees, so wait for load then poll for real content up to 60s.
  await page.goto(base + route, { waitUntil: "load", timeout: 60000 }).catch((e) => console.log(theme, "goto failed:", e.message.slice(0, 200)));
  if (waitTestId) {
    await page.getByTestId(waitTestId).waitFor({ state: "visible", timeout: 60000 }).catch((e) => console.log(theme, "wait failed:", e.message.slice(0, 200)));
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, `f1-${name}-${theme}.png`) });
  await page.screenshot({ path: path.join(outDir, `f1-${name}-${theme}-full.png`), fullPage: true });
  if (sliceDir) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0, i = 0; y < h; y += 900, i++) {
      await page.screenshot({ path: path.join(sliceDir, `${name}-${theme}-${i}.png`), fullPage: true, clip: { x: 0, y, width: 1440, height: Math.min(900, h - y) } });
    }
    console.log(theme, "height", h);
  }
  console.log(theme, "console problems:", problems.length ? problems : "none");
  await ctx.close();
}
await browser.close();
