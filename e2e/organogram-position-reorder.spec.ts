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

  test("a card let go in empty space, even well below its row, takes that slot with its branch; nothing is placed freely (D64)", async ({
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
    const s0 = (await staff.boundingBox())!;
    const principalWasFirst = p0.x < s0.x;

    // Grab it by the title (the middle holds the "Show Names" button) and
    // let go past its sibling and well below the row, in empty space.
    const targetX = principalWasFirst ? s0.x + s0.width + 40 : s0.x - 40;
    await page.mouse.move(p0.x + 24, p0.y + 12);
    await page.mouse.down();
    await page.mouse.move(targetX, p0.y + 12 + 90, { steps: 25 });
    await page.mouse.up();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(async () => (await principal.boundingBox())!.x < (await staff.boundingBox())!.x)
      .toBe(!principalWasFirst);
    // Back on its row, its report still under it, nothing saved as a placement.
    const p1 = (await principal.boundingBox())!;
    const s1 = (await staff.boundingBox())!;
    const r1 = (await report.boundingBox())!;
    expect(Math.abs(p1.y - s1.y)).toBeLessThan(2);
    expect(r1.y).toBeGreaterThan(p1.y + p1.height);
    expect(Math.abs(r1.x + r1.width / 2 - (p1.x + p1.width / 2))).toBeLessThan(4);
    expect(await readCardOffsetKeys(companyId)).toEqual([]);

    await page.getByRole("button", { name: /^undo: reorder positions/i }).click();
    await expect
      .poll(async () => (await principal.boundingBox())!.x < (await staff.boundingBox())!.x)
      .toBe(principalWasFirst);
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

  test("re-attaching a card, then Undo, puts back its head and every line", async ({ page }) => {
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

    // Senior Engineer (under Principal) let go on Staff Engineer: not a
    // sibling, so it asks to change the reporting line.
    const r0 = (await report.boundingBox())!;
    const s0 = (await staff.boundingBox())!;
    // By its centre (it is vacant: no Show Names button there), so the card
    // itself lands on Staff Engineer whatever the zoom.
    await page.mouse.move(r0.x + r0.width / 2, r0.y + r0.height / 2);
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
  });

  test("a card let go along its own row in empty space takes that slot: the others close up, nothing is placed freely", async ({
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
    // Past the other card into empty space, on the same row (grabbed by the
    // title, a few px of vertical wobble).
    const [from, past] = staffWasFirst ? [s0, p0] : [s0, p0];
    const targetX = staffWasFirst ? past.x + past.width + 40 : past.x - 40;
    await page.mouse.move(from.x + 24, from.y + 12);
    await page.mouse.down();
    await page.mouse.move(targetX, from.y + 12 + 6, { steps: 25 });
    await page.mouse.up();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(async () => (await staff.boundingBox())!.x < (await principal.boundingBox())!.x)
      .toBe(!staffWasFirst);
    // A reorder, not a free placement: no offset saved, and the row is level.
    expect(await readCardOffsetKeys(companyId)).toEqual([]);
    const s1 = (await staff.boundingBox())!;
    const p1 = (await principal.boundingBox())!;
    expect(Math.abs(s1.y - p1.y)).toBeLessThan(2);
  });
});
