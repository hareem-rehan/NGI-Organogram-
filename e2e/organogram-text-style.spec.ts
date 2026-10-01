import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import { seedSubDepartmentChart } from "./support/department-layout-fixtures";

/**
 * Organogram text styles (docs/DECISIONS.md D41): one style for every card,
 * plus a card's own style on top; saved for everyone (survives a reload).
 */
test.describe.configure({ mode: "serial" });

test.describe("Organogram — text style", () => {
  const suffix = `TS${Date.now().toString(36).toUpperCase()}`;
  let cookieValue: string;

  test.beforeAll(async () => {
    const session = await seedAuthenticatedSession("ADMIN");
    cookieValue = session.cookieValue;
    await seedSubDepartmentChart(session.companyId, suffix);
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

  const card = (page: Page, text: string) =>
    page
      .locator('[data-testid^="rf__node-"]')
      .filter({ has: page.getByText(text, { exact: true }) })
      .locator("> div")
      .first();
  const styleOf = (page: Page, text: string, prop: string) =>
    card(page, text).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

  test("a style for all cards, then one card on its own, both kept after a reload", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    await expect(card(page, `CEO ${suffix}`)).toBeVisible();

    // Every card: Georgia, 16px.
    await page.getByRole("button", { name: "Text style", exact: true }).click();
    const panel = page.getByRole("dialog");
    await panel.getByLabel("Font").selectOption("georgia");
    await panel.getByLabel(/^size/i).selectOption("16");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => styleOf(page, `CEO ${suffix}`, "font-family")).toContain("Georgia");
    await expect.poll(() => styleOf(page, `CEO ${suffix}`, "font-size")).toBe("16px");

    // One card on its own: italic, on top of the chart style.
    await page.getByRole("button", { name: `Text style for CDS Head ${suffix}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Italic" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect.poll(() => styleOf(page, `CDS Head ${suffix}`, "font-style")).toBe("italic");
    expect(await styleOf(page, `CEO ${suffix}`, "font-style")).toBe("normal");

    // Saved for everyone: still there after a reload.
    await page.reload();
    await expect(card(page, `CEO ${suffix}`)).toBeVisible();
    expect(await styleOf(page, `CEO ${suffix}`, "font-family")).toContain("Georgia");
    expect(await styleOf(page, `CDS Head ${suffix}`, "font-style")).toBe("italic");
    expect(await styleOf(page, `CDS Head ${suffix}`, "font-family")).toContain("Georgia");
  });

  test("resetting puts the built-in look back", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    await page.getByRole("button", { name: `Text style for CDS Head ${suffix}` }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Use the style for all cards" })
      .click();
    await expect.poll(() => styleOf(page, `CDS Head ${suffix}`, "font-style")).toBe("normal");

    await page.getByRole("button", { name: "Text style", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset to default" }).click();
    await expect.poll(() => styleOf(page, `CEO ${suffix}`, "font-size")).toBe("13px");
    expect(await styleOf(page, `CEO ${suffix}`, "font-family")).not.toContain("Georgia");
  });
});
