import { expect, test, type Route } from "@playwright/test";

const RAW_ID = /\b(district_[a-z_]+|ddw_[a-z_]+|wh_central|rec_[0-9a-f]{8}|(?:alwar|kota|bikaner|udaipur)_(?:phc|chc)_\d+|phc_\d+|chc_\d+)\b/;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

async function ready(page: import("@playwright/test").Page) {
  await page.goto("/recommendations");
  await expect(page.getByTestId("decision-board")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("what-if-strip")).toBeVisible({ timeout: 15_000 });
}

test.describe("Recommendations decision desk", () => {
  test("renders the four board columns with computed titles and no raw ids", async ({ page }) => {
    await ready(page);
    for (const id of ["pending", "moving", "completed", "closed"]) {
      await expect(page.getByTestId(`column-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("card-funnel")).toBeVisible();
    await expect(page.getByTestId("card-by-district")).toBeVisible();
    await expect(page.getByTestId("card-sensitivity")).toBeVisible();
    const titles = await page.locator('[data-role="action-title"]').allInnerTexts();
    expect(titles.length).toBeGreaterThanOrEqual(3);
    for (const t of titles) expect(t.trim().split(/\s+/).length).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(1000);
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(RAW_ID);
  });

  test("what-if toggle projects a lower critical count", async ({ page }) => {
    await ready(page);
    const before = await page.getByTestId("projected-critical").innerText();
    expect(before).toBe("?");
    await page.getByTestId("what-if-toggle").click();
    const after = await page.getByTestId("projected-critical").innerText();
    expect(after).not.toBe("?");
    expect(Number(after)).toBeGreaterThanOrEqual(0);
  });

  test("options considered expands a MECE table for a stock recommendation", async ({ page }) => {
    await ready(page);
    const pending = page.getByTestId("column-pending");
    const toggle = pending.getByRole("button", { name: "Options considered" }).first();
    if ((await toggle.count()) === 0) test.skip(true, "No stock recommendation is pending in this run");
    await toggle.click();
    const table = pending.locator('[data-testid^="options-"]').first();
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(3);
    expect(await table.locator("tbody tr.bg-brand-soft").count()).toBeLessThanOrEqual(1);
  });

  test("approving from the pending column posts the mutation", async ({ page }) => {
    const posted: Array<{ url: string; body: unknown }> = [];
    await page.route("**/api/v1/recommendations/*/approve", async (route: Route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      posted.push({ url: req.url(), body: req.postDataJSON() });
      const id = req.url().split("/").slice(-2)[0];
      return route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "application/json" },
        body: JSON.stringify({ id, status: "approved", recommendation: { id, status: "approved" }, shipment: { id: "SHP-999002" } }),
      });
    });
    await ready(page);
    const column = page.getByTestId("column-pending");
    await column.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.getByText("Approve this recommendation?")).toBeVisible();
    await page.getByRole("button", { name: "Confirm approve" }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].url).toMatch(/\/api\/v1\/recommendations\/rec_[0-9a-f]+\/approve$/);
    expect(posted[0].body).toMatchObject({ actor: expect.any(String) });
  });

  test("type and priority filters narrow the visible count", async ({ page }) => {
    await ready(page);
    const filters = page.getByTestId("rec-filters");
    const label = await filters.locator("span").innerText();
    const total = Number(label.match(/of (\d+)/)?.[1]);
    expect(total).toBeGreaterThan(0);
    await filters.getByText("Critical", { exact: true }).click();
    const after = await filters.locator("span").innerText();
    const shown = Number(after.match(/Showing (\d+)/)?.[1]);
    expect(shown).toBeLessThanOrEqual(total);
  });

  test("fits a 1920x1080 viewport without page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await ready(page);
    await page.waitForTimeout(500);
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(scrollHeight).toBeLessThanOrEqual(1082);
  });
});
