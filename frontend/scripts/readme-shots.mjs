// One-off Playwright capture of light-theme screenshots for README.md.
// Usage: node scripts/readme-shots.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] || "http://127.0.0.1:3000";
const outDir = path.resolve("../docs/v2-shots/readme");
mkdirSync(outDir, { recursive: true });

const pages = [
  { route: "/command", file: "command.png" },
  { route: "/voice", file: "voice.png" },
  { route: "/supply", file: "supply.png" },
  { route: "/recommendations", file: "recommendations.png" },
  { route: "/districts", file: "districts.png" },
  { route: "/map", file: "map.png" },
];

const browser = await chromium.launch();

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "light" });
  return ctx.newPage();
}

for (const { route, file } of pages) {
  const page = await freshPage();
  await page.goto(base + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  // The voice page mounts many SWR hooks at once; under load the backend can
  // miss the 6s client timeout on a cold burst. Wait for SWR's automatic
  // revalidation to clear any transient offline flag before capturing.
  if (route === "/voice") {
    for (let i = 0; i < 6; i++) {
      const stillOffline = await page.locator("text=/Backend offline/i").count();
      if (!stillOffline) break;
      await page.waitForTimeout(5000);
    }
  }
  await page.screenshot({ path: path.join(outDir, file) });
  console.log("captured", file);
  await page.context().close();
}

// Cropped heatmap-only shots, each in its own fresh context.
{
  const page = await freshPage();
  await page.goto(base + "/command", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const facilityMatrix = page.locator('[data-testid="card-facility-matrix"]');
  if (await facilityMatrix.count()) {
    await facilityMatrix.first().screenshot({ path: path.join(outDir, "command-heatmap.png") });
    console.log("captured command-heatmap.png");
  } else {
    console.log("WARNING: card-facility-matrix not found on /command");
  }
  await page.context().close();
}

{
  const page = await freshPage();
  await page.goto(base + "/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const invCard = page.locator("div").filter({ has: page.getByText("Days of cover by facility and medicine", { exact: false }) }).first();
  if (await invCard.count()) {
    await invCard.screenshot({ path: path.join(outDir, "inventory-heatmap.png") });
    console.log("captured inventory-heatmap.png");
  } else {
    await page.screenshot({ path: path.join(outDir, "inventory-heatmap.png") });
    console.log("captured inventory-heatmap.png (full page fallback)");
  }
  await page.context().close();
}

await browser.close();
