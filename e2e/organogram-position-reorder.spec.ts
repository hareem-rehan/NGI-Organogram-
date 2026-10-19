import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import {
  readCardOffsetKeys,
  readPositionByTitle,
  seedSharedPositionChart,
} from "./support/department-layout-fixtures";

/**
 * Position cards reorder along their row like department and sub-division
 * boxes (docs/DECISIONS.md D61): drag one left or right and it takes that
 * place among its siblings, its branch moving with it; nothing is placed by
 * hand, and the parent stays where it was on screen.
 */
test.describe("Organogram — reorder position cards", () => {
  const suffix = `PR${Date.now().toString(36).toUpperCase()}`;
  let cookieValue: string;
  let companyId: string;

  test.beforeAll(async () => {
    const session = await seedAuthenticatedSession("ADMIN");
    cookieValue = session.cookieValue;
    companyId = session.companyId;
    await seedSharedPositionChart(companyId, suffix);
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

  test("dragging a card past its sibling reorders them, branch and all; Undo puts it back", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    const head = card(page, "Platform Head");
    const principal = card(page, "Principal Engineer");
    const staff = card(page, "Staff Engineer");
    const report = card(page, "Senior Engineer");
    await expect(report).toBeVisible();
    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);

    // Title order to start with: Principal, then Staff.
    const p0 = (await principal.boundingBox())!;
    const s0 = (await staff.boundingBox())!;
    expect(p0.x).toBeLessThan(s0.x);
    const headBefore = (await head.boundingBox())!;

    // Let Staff Engineer go to the left of Principal Engineer, in empty space.
    await page.mouse.move(s0.x + s0.width / 2, s0.y + s0.height / 2);
    await page.mouse.down();
    await page.mouse.move(p0.x - p0.width * 0.6, s0.y + s0.height / 2, { steps: 20 });
    await page.mouse.up();

    await expect
      .poll(
        async () => (await readPositionByTitle(companyId, `Staff Engineer ${suffix}`)).displayOrder
      )
      .toBe(1);
    expect(await readCardOffsetKeys(companyId)).toEqual([]);
    await expect
      .poll(async () => {
        const p = (await principal.boundingBox())!;
        const s = (await staff.boundingBox())!;
        const r = (await report.boundingBox())!;
        const h = (await head.boundingBox())!;
        return {
          staffFirst: s.x < p.x,
          sameRow: Math.abs(s.y - p.y) < 2,
          // Principal's report moved along with it, still centred under it.
          reportUnderPrincipal: Math.abs(r.x + r.width / 2 - (p.x + p.width / 2)) < 4,
          headStayed: Math.abs(h.x - headBefore.x) < 2 && Math.abs(h.y - headBefore.y) < 2,
        };
      })
      .toEqual({ staffFirst: true, sameRow: true, reportUnderPrincipal: true, headStayed: true });

    await page.getByRole("button", { name: "Undo: Reorder positions" }).click();
    await expect
      .poll(async () => (await staff.boundingBox())!.x > (await principal.boundingBox())!.x)
      .toBe(true);
  });

  test("dropping a card ONTO its sibling swaps their places — no reporting-line change", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    const principal = card(page, "Principal Engineer");
    const staff = card(page, "Staff Engineer");
    await expect(staff).toBeVisible();
    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const p0 = (await principal.boundingBox())!;
    const s0 = (await staff.boundingBox())!;
    const staffWasFirst = s0.x < p0.x;

    // Let go with the pointer right on top of the sibling card.
    await page.mouse.move(s0.x + s0.width / 2, s0.y + s0.height / 2);
    await page.mouse.down();
    await page.mouse.move(p0.x + p0.width / 2, p0.y + p0.height / 2, { steps: 20 });
    await page.mouse.up();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(async () => (await staff.boundingBox())!.x < (await principal.boundingBox())!.x)
      .toBe(!staffWasFirst);
    const staffRow = await readPositionByTitle(companyId, `Staff Engineer ${suffix}`);
    const principalRow = await readPositionByTitle(companyId, `Principal Engineer ${suffix}`);
    // Still both report to the same head.
    expect(staffRow.primaryReportsToPositionId).toBe(principalRow.primaryReportsToPositionId);
  });
});
