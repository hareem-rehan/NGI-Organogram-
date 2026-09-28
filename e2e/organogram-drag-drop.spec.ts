import { test, expect, type Locator, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import {
  readPositionByTitle,
  seedDepartmentLayoutChart,
} from "./support/department-layout-fixtures";

/**
 * Arrange-mode drag-and-drop (docs/DECISIONS.md D21, D29), driven with a real
 * mouse: drop a card onto a department heading (it joins that department
 * under its top position, its branch moving with it), and a refused drop
 * onto the card's own subordinate. Also saves a screenshot of the redesigned
 * cards (title, person, level, "N roles under").
 */
test.describe.configure({ mode: "serial" });

test.describe("Organogram — drag and drop", () => {
  const suffix = Date.now().toString(36).toUpperCase();
  let cookieValue: string;
  let companyId: string;

  test.beforeAll(async () => {
    const session = await seedAuthenticatedSession("ADMIN");
    cookieValue = session.cookieValue;
    companyId = session.companyId;
    await seedDepartmentLayoutChart(companyId, suffix);
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
      .filter({ has: page.getByText(text, { exact: true }) });

  async function drag(page: Page, from: Locator, to: Locator) {
    // Fit the whole chart inside the (clipped) canvas and bring the canvas on
    // screen, so both cards are really under the mouse.
    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    // Wait until both cards have stopped moving (the zoom animates, and a
    // loaded CI machine can be slow to settle) before pressing the mouse.
    const settled = async (locator: Locator) => {
      let previous = await locator.boundingBox();
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(150);
        const current = await locator.boundingBox();
        if (
          previous &&
          current &&
          Math.abs(previous.x - current.x) < 0.5 &&
          Math.abs(previous.y - current.y) < 0.5
        ) {
          return current;
        }
        previous = current;
      }
      return previous;
    };
    const a = (await settled(from))!;
    const b = (await settled(to))!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    await page.mouse.up();
  }

  test("dropping a card onto a department heading moves it (and its branch) into that department", async ({
    page,
  }, testInfo) => {
    await page.goto("/organogram");
    await expect(card(page, `Marketing Lead 2 ${suffix}`)).toBeVisible();
    await page.waitForTimeout(500); // let the opening zoom settle
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("cards.png") });

    await page.getByRole("button", { name: /arrange/i }).click();
    await drag(page, card(page, `Marketing Lead 2 ${suffix}`), card(page, `Engineering ${suffix}`));

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/move into department\?/i)).toBeVisible();
    await expect(dialog).toContainText(`will join Engineering ${suffix}`);
    await dialog.getByRole("button", { name: /^move$/i }).click();
    await expect(dialog).toBeHidden();

    const moved = await readPositionByTitle(companyId, `Marketing Lead 2 ${suffix}`);
    const engTop = await readPositionByTitle(companyId, `Engineering Lead 1 ${suffix}`);
    const branch = await readPositionByTitle(companyId, `Marketing Lead 3 ${suffix}`);
    expect(moved.primaryReportsToPositionId).toBe(engTop.id);
    expect(moved.departmentId).toBe(engTop.departmentId);
    // The branch moved along and kept its own reporting line.
    expect(branch.primaryReportsToPositionId).toBe(moved.id);
    expect(branch.departmentId).toBe(engTop.departmentId);
  });

  test("refuses a drop onto the card's own subordinate, saying why", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    await expect(card(page, `Engineering Director 1 ${suffix}`)).toBeVisible();

    await drag(
      page,
      card(page, `Engineering Lead 1 ${suffix}`),
      card(page, `Engineering Director 1 ${suffix}`)
    );

    await expect(
      page.getByRole("alert").filter({ hasText: /reports \(directly or indirectly\)/ })
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const lead = await readPositionByTitle(companyId, `Engineering Lead 1 ${suffix}`);
    const director = await readPositionByTitle(companyId, `Engineering Director 1 ${suffix}`);
    expect(lead.primaryReportsToPositionId).not.toBe(director.id);
  });
});
