import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import { seedDepartmentLayoutChart } from "./support/department-layout-fixtures";

/**
 * Opening view and zoom menu (2026-10-02): the chart opens readable — the
 * root and department row at >= 75% — and the zoom menu shows / sets the
 * zoom as a percentage, or fits the whole chart.
 */
test.describe.configure({ mode: "serial" });

test.describe("Organogram — opening view and zoom", () => {
  const suffix = `ZM${Date.now().toString(36).toUpperCase()}`;
  let cookieValue: string;

  test.beforeAll(async () => {
    const session = await seedAuthenticatedSession("ADMIN");
    cookieValue = session.cookieValue;
    await seedDepartmentLayoutChart(session.companyId, suffix);
  });

  test.beforeEach(async ({ page, baseURL }) => {
    const url = new URL(baseURL ?? "http://127.0.0.1:3100");
    await page.context().addCookies([
      {
        name: "authjs.session-token",
        value: cookieValue,
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  const zoomOf = async (page: Page) =>
    page
      .locator(".react-flow__viewport")
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);

  const inPane = async (page: Page, text: string) => {
    const pane = (await page.locator(".react-flow").boundingBox())!;
    const box = await page
      .locator('[data-testid^="rf__node-"]')
      .filter({ has: page.getByText(text, { exact: true }) })
      .boundingBox();
    return (
      !!box &&
      box.x >= pane.x - 1 &&
      box.y >= pane.y - 1 &&
      box.x + box.width <= pane.x + pane.width + 1 &&
      box.y + box.height <= pane.y + pane.height + 1
    );
  };

  test("opens with the root and department row readable (>= 75%)", async ({ page }) => {
    await page.goto("/organogram");
    await expect(page.getByText(`CEO ${suffix}`, { exact: true })).toBeVisible();
    await expect.poll(() => zoomOf(page)).toBeGreaterThanOrEqual(0.75);
    await expect.poll(() => inPane(page, `CEO ${suffix}`)).toBe(true);
    await expect.poll(() => inPane(page, `Engineering ${suffix}`)).toBe(true);
    await expect(page.getByRole("combobox", { name: "Zoom level" })).toBeVisible();
  });

  test("the zoom menu sets a percentage and can fit the whole chart", async ({ page }) => {
    await page.goto("/organogram");
    const menu = page.getByRole("combobox", { name: "Zoom level" });
    await expect(menu).toBeVisible();
    await menu.selectOption("50");
    await expect.poll(() => zoomOf(page)).toBeCloseTo(0.5, 2);
    await expect(menu).toHaveValue("50");

    await menu.selectOption("fit");
    await expect.poll(async () => (await zoomOf(page)) < 0.5).toBe(true);
    await expect.poll(() => inPane(page, `Marketing ${suffix}`)).toBe(true);
    await expect.poll(() => inPane(page, `CEO ${suffix}`)).toBe(true);
  });
});
