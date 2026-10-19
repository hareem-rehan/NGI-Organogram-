import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import {
  readCardOffsetKeys,
  readPositionByTitle,
  seedSharedPositionChart,
} from "./support/department-layout-fixtures";

/**
 * Moving position cards (docs/DECISIONS.md D61, D62): let go on empty space
 * and the card moves there with its whole branch; let go on a sibling and
 * they swap places.
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

  test("a card let go on empty space moves there with everything below it; Undo puts it back (D62)", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    const principal = card(page, "Principal Engineer");
    const staff = card(page, "Staff Engineer");
    const report = card(page, "Senior Engineer");
    await expect(report).toBeVisible();
    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);

    const p0 = (await principal.boundingBox())!;
    const r0 = (await report.boundingBox())!;
    const s0 = (await staff.boundingBox())!;
    // Grab it by the title (the middle holds the "Show Names" button) and
    // let go down and to the left, in empty space.
    await page.mouse.move(p0.x + 24, p0.y + 12);
    await page.mouse.down();
    await page.mouse.move(p0.x + 24 - 120, p0.y + 12 + 90, { steps: 20 });
    await page.mouse.up();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await readCardOffsetKeys(companyId)).length).toBe(2);
    const p1 = (await principal.boundingBox())!;
    const r1 = (await report.boundingBox())!;
    const s1 = (await staff.boundingBox())!;
    // The card and its report moved by the same amount; its sibling stayed.
    expect(Math.abs(p1.x - p0.x)).toBeGreaterThan(20);
    expect(Math.abs(r1.x - r0.x - (p1.x - p0.x))).toBeLessThan(2);
    expect(Math.abs(r1.y - r0.y - (p1.y - p0.y))).toBeLessThan(2);
    expect(Math.abs(s1.x - s0.x)).toBeLessThan(2);

    await page.getByRole("button", { name: /^undo: move 2 cards/i }).click();
    await expect.poll(() => readCardOffsetKeys(companyId)).toEqual([]);
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

  test("re-attaching a card from a moved branch, then Undo, puts back its head, its place and every line", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    const staff = card(page, "Staff Engineer");
    const report = card(page, "Senior Engineer");
    await expect(report).toBeVisible();
    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const edges = page.locator(".react-flow__edge");
    const edgeCount = await edges.count();
    const principalRow = await readPositionByTitle(companyId, `Principal Engineer ${suffix}`);
    const reportId = (await readPositionByTitle(companyId, `Senior Engineer ${suffix}`)).id;

    // First move Principal Engineer, and with it Senior Engineer (D62).
    const principal = card(page, "Principal Engineer");
    const p0 = (await principal.boundingBox())!;
    const reportBefore = (await report.boundingBox())!;
    await page.mouse.move(p0.x + 24, p0.y + 12);
    await page.mouse.down();
    await page.mouse.move(p0.x + 24 - 120, p0.y + 12 + 90, { steps: 20 });
    await page.mouse.up();
    const branchKeys = [principalRow.id, reportId].sort();
    await expect.poll(() => readCardOffsetKeys(companyId)).toEqual(branchKeys);
    // Wait until the report has visibly moved with it before grabbing it.
    await expect
      .poll(async () => {
        const now = (await report.boundingBox())!;
        return Math.abs(now.x - reportBefore.x) + Math.abs(now.y - reportBefore.y);
      })
      .toBeGreaterThan(20);
    await page.waitForTimeout(500);

    // Senior Engineer (under Principal) let go on Staff Engineer: not a
    // sibling, so it asks to change the reporting line.
    const r0 = (await report.boundingBox())!;
    const s0 = (await staff.boundingBox())!;
    await page.mouse.move(r0.x + 24, r0.y + 12);
    await page.mouse.down();
    await page.mouse.move(s0.x + s0.width / 2, s0.y + s0.height / 2, { steps: 20 });
    await page.mouse.up();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^move$/i })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await readPositionByTitle(companyId, `Senior Engineer ${suffix}`))
            .primaryReportsToPositionId
      )
      .not.toBe(principalRow.id);
    await expect(edges).toHaveCount(edgeCount);
    // It lands in its new place: its own move is cleared, Principal's stays.
    await expect.poll(() => readCardOffsetKeys(companyId)).toEqual([principalRow.id]);

    await page.getByRole("button", { name: /^undo: re-attach/i }).click();
    await expect(page.getByText(/^Undid: Re-attach/)).toBeVisible();
    await expect
      .poll(
        async () =>
          (await readPositionByTitle(companyId, `Senior Engineer ${suffix}`))
            .primaryReportsToPositionId
      )
      .toBe(principalRow.id);
    // The chart shows it back under its old head, with every connector.
    await expect(
      page.locator(`[data-testid="rf__edge-${principalRow.id}-${reportId}"]`)
    ).toHaveCount(1);
    await expect(edges).toHaveCount(edgeCount);
    const paths = await page
      .locator(".react-flow__edge path")
      .evaluateAll(
        (els) => els.filter((el) => (el.getAttribute("d") ?? "").includes("NaN")).length
      );
    expect(paths).toBe(0);
    // And it is back where the branch move had put it.
    await expect.poll(() => readCardOffsetKeys(companyId)).toEqual(branchKeys);

    await page.getByRole("button", { name: /^undo: move 2 cards/i }).click();
    await expect.poll(() => readCardOffsetKeys(companyId)).toEqual([]);
  });
});
