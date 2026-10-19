import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import { seedSharedPositionChart } from "./support/department-layout-fixtures";

/**
 * A card held by several people (D56) shows two names and "+N more";
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

  test("'+3 more' opens every name; the card grows, the chart makes room, nothing else moves", async ({
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

    await expect(shared.getByText(`Haris Ali ${suffix}`)).toHaveCount(0);
    const before = {
      shared: (await shared.boundingBox())!,
      neighbour: (await neighbour.boundingBox())!,
      below: (await below.boundingBox())!,
    };

    await shared.getByRole("button", { name: /show all 5 people/i }).click();

    await expect(shared.getByText(`Haris Ali ${suffix}`)).toBeVisible();
    await expect(shared.getByRole("button", { name: /show fewer/i })).toBeVisible();
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

    // "Show fewer" puts everything back.
    await shared.getByRole("button", { name: /show fewer/i }).click();
    await expect(shared.getByText(`Haris Ali ${suffix}`)).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await below.boundingBox())!.y - before.below.y))
      .toBeLessThan(2);
  });
});
