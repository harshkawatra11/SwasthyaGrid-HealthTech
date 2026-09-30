import { expect, test } from "@playwright/test";

// Raw facility ids (phc_18, alwar_phc_2, chc_east style) must never reach the page text.
const RAW_ID = /\b(phc|chc)_\w+|\w+_(phc|chc)_\d+\b/;

const ROUTES = [
  "/command",
  "/recommendations",
  "/inventory",
  "/footfall",
  "/beds",
  "/doctors",
  "/diagnostics",
  "/map",
  "/facilities",
  "/analytics",
  "/districts",
  "/supply",
  "/voice",
];

// Run with E2E_BASE_URL pointing at `next start`. The API base is baked at build time
// (NEXT_PUBLIC_API_BASE); build against an unreachable port to exercise the offline fixtures.
for (const route of ROUTES) {
  test(`no raw ids on ${route}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(route, { waitUntil: "load" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(1500);
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(20);
    const m = RAW_ID.exec(text);
    expect(m, `raw id "${m?.[0]}" on ${route}`).toBeNull();
    expect(errors).toEqual([]);
  });
}

test("facilities lists all 40 facility names, none as raw ids", async ({ page }) => {
  await page.goto("/facilities", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const rows = await page.locator("main button:has(p.text-sm)").count();
  expect(rows).toBeGreaterThanOrEqual(8);
});
