import { expect, test, type Route } from "@playwright/test";

const RAW_ID = /\b(district_[a-z_]+|ddw_[a-z_]+|wh_central|rec_[0-9a-f]{8}|(?:alwar|kota|bikaner|udaipur)_(?:phc|chc)_\d+|phc_\d+|chc_\d+)\b/;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

async function ready(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("kpi-band")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("card-facility-matrix")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("card-watchlist")).toBeVisible({ timeout: 15_000 });
}

test.describe("Command Centre", () => {
  test("renders at least ten data cards with action titles, KPI band first", async ({ page }) => {
    await ready(page, "/command");
    await expect(page.getByTestId("kpi-band").locator("a")).toHaveCount(6);
    const cards = page.locator('[data-testid^="card-"]');
    expect(await cards.count()).toBeGreaterThanOrEqual(10);
    // Every card has a computed sentence title.
    const titles = await page.locator('[data-role="action-title"]').allInnerTexts();
    expect(titles.length).toBeGreaterThanOrEqual(8);
    for (const t of titles) expect(t.trim().split(/\s+/).length).toBeGreaterThanOrEqual(3);
  });

  test("shows no raw ids anywhere in the visible text", async ({ page }) => {
    await ready(page, "/command");
    await page.waitForTimeout(1500);
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(RAW_ID);
  });

  test("changing scope re-renders every card for that district", async ({ page }) => {
    await ready(page, "/command");
    const before = {
      rows: await page.getByTestId("card-facility-matrix").locator('[role="rowheader"]').count(),
      titles: await page.locator('[data-role="action-title"]').allInnerTexts(),
    };
    expect(before.rows).toBe(40);

    await page.goto("/command?d=district_kota");
    await expect(page.getByTestId("command-centre")).toHaveAttribute("data-scope", "district_kota");
    await expect(page.getByTestId("card-facility-matrix").locator('[role="rowheader"]')).toHaveCount(8);
    const after = {
      firstKpi: await page.getByTestId("kpi-band").locator("a").first().innerText(),
      titles: await page.locator('[data-role="action-title"]').allInnerTexts(),
    };
    expect(after.firstKpi).toMatch(/\/8\b/);
    // The medicine matrix collapses to one district column and the footfall card switches to one district.
    await expect(page.getByTestId("card-medicine-matrix").locator('[role="columnheader"]')).toHaveCount(1);
    // At least 6 of the card titles differ from the state view.
    const changed = after.titles.filter((t, i) => t !== before.titles[i]).length;
    expect(changed).toBeGreaterThanOrEqual(6);
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(RAW_ID);
  });

  test("approving from the pending card posts the mutation", async ({ page }) => {
    const posted: Array<{ url: string; body: unknown }> = [];
    await page.route("**/api/v1/recommendations/*/approve", async (route: Route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      posted.push({ url: req.url(), body: req.postDataJSON() });
      const id = req.url().split("/").slice(-2)[0];
      return route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "application/json" },
        body: JSON.stringify({ id, status: "approved", recommendation: { id, status: "approved" }, shipment: { id: "SHP-999001" } }),
      });
    });
    await ready(page, "/command");
    const card = page.getByTestId("card-approvals");
    await card.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.getByText("Approve this recommendation?")).toBeVisible();
    await page.getByRole("button", { name: "Confirm approve" }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].url).toMatch(/\/api\/v1\/recommendations\/rec_[0-9a-f]+\/approve$/);
    expect(posted[0].body).toMatchObject({ actor: expect.any(String) });
    await expect(page.getByText(/Shipment SHP-999001 created/)).toBeVisible({ timeout: 10_000 });
  });

  test("fits a shorter footprint than before the redesign", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await ready(page, "/command");
    await page.waitForTimeout(500);
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(scrollHeight).toBeLessThan(4009 * 0.65);
  });
});
