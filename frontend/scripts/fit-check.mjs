#!/usr/bin/env node
// Checks whether pages fit inside a 1920x1080 viewport without page scroll.
// Usage: MSYS_NO_PATHCONV=1 node scripts/fit-check.mjs <baseUrl> <route> [<route>...]
// Add --must-fit anywhere in the args to make the script exit 1 if any of the
// listed routes still scrolls. Screenshots (viewport only) are written to
// docs/v2-shots/fit-<route>.png with slashes in the route replaced by dashes.

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mustFit = args.includes("--must-fit");
const rest = args.filter((a) => a !== "--must-fit");
const base = rest[0] && rest[0].startsWith("http") ? rest[0] : "http://127.0.0.1:3000";
const routes = rest[0] && rest[0].startsWith("http") ? rest.slice(1) : rest;

if (routes.length === 0) {
  console.error("usage: fit-check.mjs [<baseUrl>] <route> [<route>...] [--must-fit]");
  process.exit(2);
}

const shotDir = path.resolve(__dirname, "..", "..", "docs", "v2-shots");
mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
let anyFail = false;

for (const route of routes) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
  const url = base + route;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const fits = scrollHeight <= 1082;
  const slug = route.replace(/^\//, "").replace(/\//g, "-") || "root";
  const shotPath = path.join(shotDir, `fit-${slug}.png`);
  await page.screenshot({ path: shotPath });
  console.log(`${route}\t${scrollHeight}\t${fits ? "FIT" : "SCROLL"}\t${shotPath}`);
  if (!fits) anyFail = true;
  await page.close();
}

await browser.close();
process.exit(mustFit && anyFail ? 1 : 0);
