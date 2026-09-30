// Presence check: a live call survives navigation; the topbar button shows the CSS orb and the dock appears.
// Usage: node e2e/voice/presence.mjs [baseUrl]
import { chromium } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:3004";
const outDir = path.resolve(process.cwd(), "..", "docs", "v2-shots");
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  headless: false,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
const out = {};
await page.goto(`${base}/voice`, { waitUntil: "networkidle" });
out.topbarBeforeLive = await page.getByTestId("voice-button").count(); // hidden on /voice
await page.getByRole("button", { name: "Start voice session" }).click();
await page.waitForFunction(() => document.querySelector('[data-testid="connection-chip"]')?.textContent?.includes("Live"), null, { timeout: 15000 });
await page.getByRole("link", { name: "Recommendations" }).first().click();
await page.waitForURL(/recommendations/);
await page.waitForTimeout(1500);
out.dockVisible = await page.getByTestId("voice-dock").isVisible();
out.topbarOrb = await page.getByTestId("voice-button").getByTestId("orb-fallback").count();
out.topbarLabel = await page.getByTestId("voice-button").innerText();
await page.screenshot({ path: path.join(outDir, "e-voice-presence.png") });
await page.getByTestId("voice-button").click();
await page.waitForURL(/\/voice/);
out.backOnVoice = await page.getByRole("heading", { name: "Voice Control Room" }).isVisible();
out.stillLive = (await page.getByTestId("connection-chip").innerText()).includes("Live");
await page.getByRole("button", { name: "End session" }).click();
console.log(JSON.stringify(out, null, 2));
await browser.close();
