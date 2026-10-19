import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import { seedSharedPositionChart } from "./support/department-layout-fixtures";

/**
 * A card held by several people (D56) shows no name, only "+5 Show Names";
 * clicking it opens every name: the card grows to fit, the chart makes room
 * below, and nothing else changes (user request, 2026-10-19).
 */
test.describe("Organogram — expandable names on a card", () => {
  const suffix = `SP${Date.now().toString(36).toUpperCase()}`;
  let cookieValue: string;

  test.beforeAll(async () => {
    const session = await seedAuthenticatedSession("ADMIN");
    cookieValue = session.cookieValue;
    await seedSharedPositionChart(session.companyId, suffix);
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

  const card = (page: Page, title: string) =>
    page
      .locator('[data-testid^="rf__node-"]')
      .filter({ has: page.getByText(`${title} ${suffix}`, { exact: true }) });

  test("'Show names' opens every name; the card grows, the chart makes room, nothing else moves", async ({
    page,
  }) => {
    await page.goto("/organogram");
    const shared = card(page, "Principal Engineer");
    const neighbour = card(page, "Staff Engineer");
    const below = card(page, "Senior Engineer");
    await expect(shared).toBeVisible();
    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);

    await expect(shared.getByText(`Ghulam Nabi ${suffix}`)).toHaveCount(0);
    await expect(shared.getByRole("button", { name: /show all 5 names/i })).toHaveText(
      /\+5 Show Names/
    );
    const before = {
      shared: (await shared.boundingBox())!,
      neighbour: (await neighbour.boundingBox())!,
      below: (await below.boundingBox())!,
    };

    await expect(shared.getByText(`Waqas Ansari ${suffix}`)).toHaveCount(0);
    await shared.getByRole("button", { name: /show all 5 names/i }).click();

    await expect(shared.getByText(`Haris Ali ${suffix}`)).toBeVisible();
    await expect(shared.getByRole("button", { name: /hide names/i })).toBeVisible();
    // Opening the names never opens the details panel.
    await expect(page.getByText("Occupants", { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => (await below.boundingBox())!.y - before.below.y)
      .toBeGreaterThan(10);
    const open = {
      shared: (await shared.boundingBox())!,
      neighbour: (await neighbour.boundingBox())!,
    };
    expect(open.shared.height).toBeGreaterThan(before.shared.height + 10);
    // The opened card stays where it was on screen …
    expect(Math.abs(open.shared.y - before.shared.y)).toBeLessThan(2);
    // … and its neighbour on the row keeps its size.
    expect(Math.abs(open.neighbour.height - before.neighbour.height)).toBeLessThan(2);
    await page.screenshot({ path: "test-results/expanded-names.png" });

    // "Hide names" puts everything back.
    await shared.getByRole("button", { name: /hide names/i }).click();
    await expect(shared.getByText(`Haris Ali ${suffix}`)).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await below.boundingBox())!.y - before.below.y))
      .toBeLessThan(2);
  });

  test("collapsing or expanding a branch keeps the clicked card where it is, at the same zoom", async ({
    page,
  }) => {
    await page.goto("/organogram");
    const shared = card(page, "Principal Engineer");
    const below = card(page, "Senior Engineer");
    await expect(below).toBeVisible();
    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const zoomLevel = page.getByRole("combobox", { name: "Zoom level" });
    const zoomText = () =>
      zoomLevel.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent);
    const zoomBefore = await zoomText();
    const before = (await shared.boundingBox())!;

    await shared
      .getByRole("button", { name: new RegExp(`^collapse principal engineer`, "i") })
      .click();
    await expect(below).toHaveCount(0);
    await page.waitForTimeout(700);
    const collapsed = (await shared.boundingBox())!;
    expect(Math.abs(collapsed.x - before.x)).toBeLessThan(2);
    expect(Math.abs(collapsed.y - before.y)).toBeLessThan(2);
    expect(await zoomText()).toBe(zoomBefore);

    await shared
      .getByRole("button", { name: new RegExp(`^expand principal engineer`, "i") })
      .click();
    await expect(below).toBeVisible();
    await page.waitForTimeout(700);
    const expanded = (await shared.boundingBox())!;
    expect(Math.abs(expanded.x - before.x)).toBeLessThan(2);
    expect(Math.abs(expanded.y - before.y)).toBeLessThan(2);
  });
});
