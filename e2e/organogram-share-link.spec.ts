import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import { seedSharedPositionChart } from "./support/department-layout-fixtures";

/**
 * View-only organogram links (docs/DECISIONS.md D60): HR creates a link;
 * someone with no account opens it and can view — expand/collapse, card
 * details (no employee links), search — but nothing else; once the link is
 * turned off it stops working.
 */
test.describe.configure({ mode: "serial" });

test.describe("Organogram — view-only share link", () => {
  const suffix = `SH${Date.now().toString(36).toUpperCase()}`;
  let cookieValue: string;
  let shareUrl = "";

  test.beforeAll(async () => {
    const session = await seedAuthenticatedSession("ADMIN");
    cookieValue = session.cookieValue;
    await seedSharedPositionChart(session.companyId, suffix);
  });

  async function signIn(page: Page, baseURL: string | undefined) {
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
  }

  test("HR creates a link; someone without an account can view the chart, and only view it", async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page, baseURL);
    await page.goto("/organogram");
    await page.getByRole("button", { name: /^share$/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/label/i).fill(`Board ${suffix}`);
    await dialog.getByRole("button", { name: /create link/i }).click();
    const linkBox = dialog.getByRole("textbox", {
      name: new RegExp(`link for board ${suffix}`, "i"),
    });
    shareUrl = await linkBox.inputValue();
    expect(shareUrl).toMatch(/\/share\/[A-Za-z0-9_-]{43}$/);

    // A brand-new browser: no cookies, no account.
    const outsider = await (await browser.newContext()).newPage();
    await outsider.goto(shareUrl);
    const card = outsider
      .locator('[data-testid^="rf__node-"]')
      .filter({ has: outsider.getByText(`Principal Engineer ${suffix}`, { exact: true }) });
    await expect(card).toBeVisible();
    await expect(outsider.getByText("View only")).toBeVisible();
    // Viewing tools only.
    await expect(outsider.getByRole("button", { name: /^export$/i })).toBeVisible();
    for (const name of [/^arrange$/i, /^filters$/i, /^share$/i]) {
      await expect(outsider.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(
      outsider.getByRole("link", { name: /dashboard|employees|positions/i })
    ).toHaveCount(0);

    // Expand / collapse.
    const below = outsider
      .locator('[data-testid^="rf__node-"]')
      .filter({ has: outsider.getByText(`Senior Engineer ${suffix}`, { exact: true }) });
    await expect(below).toBeVisible();
    await card.getByRole("button", { name: /^collapse principal engineer/i }).click();
    await expect(below).toHaveCount(0);
    await card.getByRole("button", { name: /^expand principal engineer/i }).click();
    await expect(below).toBeVisible();

    // Card details, with names but no links to employee records.
    await outsider
      .getByRole("button", { name: new RegExp(`^Staff Engineer ${suffix}\\.`) })
      .click();
    await expect(outsider.getByText("Organizational level")).toBeVisible();
    await expect(outsider.getByText(`Sana Mir ${suffix}`).first()).toBeVisible();
    await expect(outsider.locator('a[href^="/employees/"]')).toHaveCount(0);
    await outsider.context().close();
  });

  test("once HR turns the link off, it stops working", async ({ page, browser, baseURL }) => {
    await signIn(page, baseURL);
    await page.goto("/organogram");
    await page.getByRole("button", { name: /^share$/i }).click();
    const dialog = page.getByRole("dialog");
    const row = dialog.getByRole("listitem").filter({ hasText: `Board ${suffix}` });
    await row.getByRole("button", { name: /^turn off$/i }).click();
    await row.getByRole("button", { name: /turn off for everyone/i }).click();
    await expect(row.getByText("Turned off", { exact: true })).toBeVisible();

    const outsider = await (await browser.newContext()).newPage();
    await outsider.goto(shareUrl);
    await expect(outsider.getByText(/this link isn.t available/i)).toBeVisible();
    await expect(outsider.locator('[data-testid^="rf__node-"]')).toHaveCount(0);
    await outsider.context().close();
  });
});
