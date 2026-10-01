import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import { readDepartmentOrder, seedSubDepartmentChart } from "./support/department-layout-fixtures";

/**
 * Reordering SUB-departments (Product / Project under Client Delivery
 * Services) by dragging their boxes in Arrange mode — D33 applied one level
 * down, where the boxes sit inside their parent department's box.
 */
test.describe.configure({ mode: "serial" });

test.describe("Organogram — sub-department reorder", () => {
  const suffix = `SD${Date.now().toString(36).toUpperCase()}`;
  let cookieValue: string;
  let companyId: string;

  test.beforeAll(async () => {
    const session = await seedAuthenticatedSession("ADMIN");
    cookieValue = session.cookieValue;
    companyId = session.companyId;
    await seedSubDepartmentChart(companyId, suffix);
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

  const box = (page: Page, text: string) =>
    page
      .locator('[data-testid^="rf__node-"]')
      .filter({ has: page.getByText(text, { exact: true }) });

  test("dragging Project to the left of Product saves and shows the new order", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    const product = box(page, `Product ${suffix}`);
    const project = box(page, `Project ${suffix}`);
    await expect(product).toBeVisible();
    await expect(project).toBeVisible();

    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const from = (await project.boundingBox())!;
    const to = (await product.boundingBox())!;
    expect(from.x).toBeGreaterThan(to.x); // Product starts on the left (name order)

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x - to.width, to.y + to.height / 2, { steps: 20 });
    await page.mouse.up();

    await expect
      .poll(async () =>
        (await readDepartmentOrder(companyId)).filter(
          (n) => n === `Product ${suffix}` || n === `Project ${suffix}`
        )
      )
      .toEqual([`Project ${suffix}`, `Product ${suffix}`]);

    await page.reload();
    await expect(project).toBeVisible();
    await page.waitForTimeout(600);
    expect((await project.boundingBox())!.x).toBeLessThan((await product.boundingBox())!.x);
  });

  test("a box's whole branch moves with it while dragging, and snaps back on an empty drop", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    const product = box(page, `Product ${suffix}`);
    const manager = box(page, `Product Manager ${suffix}`);
    await expect(manager).toBeVisible();
    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);

    const boxStart = (await product.boundingBox())!;
    const managerStart = (await manager.boundingBox())!;
    await page.mouse.move(boxStart.x + boxStart.width / 2, boxStart.y + boxStart.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxStart.x + boxStart.width / 2, boxStart.y + boxStart.height / 2 + 60, {
      steps: 10,
    });

    // Mid-drag: the report moved down by the same amount as the box.
    const boxMid = (await product.boundingBox())!;
    const managerMid = (await manager.boundingBox())!;
    expect(boxMid.y - boxStart.y).toBeGreaterThan(20);
    expect(Math.abs(managerMid.y - managerStart.y - (boxMid.y - boxStart.y))).toBeLessThan(2);
    expect(Math.abs(managerMid.x - managerStart.x - (boxMid.x - boxStart.x))).toBeLessThan(2);

    // Let go over empty canvas: box and branch return to the layout.
    await page.mouse.up();
    await expect
      .poll(async () => Math.round((await manager.boundingBox())!.y))
      .toBe(Math.round(managerStart.y));
  });
});
