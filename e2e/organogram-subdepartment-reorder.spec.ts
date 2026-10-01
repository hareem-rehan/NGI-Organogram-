import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import {
  readCardOffsetKeys,
  readDepartmentId,
  readDepartmentOrder,
  seedSubDepartmentChart,
} from "./support/department-layout-fixtures";

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

  async function settle(page: Page) {
    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
  }

  test("dropping Project onto Product swaps their order, saved and shown", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    const product = box(page, `Product ${suffix}`);
    const project = box(page, `Project ${suffix}`);
    await expect(project).toBeVisible();
    await settle(page);
    const from = (await project.boundingBox())!;
    const to = (await product.boundingBox())!;
    expect(from.x).toBeGreaterThan(to.x); // Product starts on the left (name order)

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
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
    await page.waitForTimeout(700);
    expect((await project.boundingBox())!.x).toBeLessThan((await product.boundingBox())!.x);
  });

  test("a box dropped on empty space stays there for everyone, alone; Reset positions puts it back", async ({
    page,
  }) => {
    const productKey = `dept:${await readDepartmentId(companyId, `Product ${suffix}`)}`;
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    const product = box(page, `Product ${suffix}`);
    const project = box(page, `Project ${suffix}`);
    const manager = box(page, `Product Manager ${suffix}`);
    await expect(manager).toBeVisible();
    await settle(page);

    const start = (await product.boundingBox())!;
    // Measured against Project (which is not dragged), so the "Reset positions"
    // button appearing above the chart and shifting the canvas doesn't count.
    const managerFromProject = async () =>
      (await manager.boundingBox())!.y - (await project.boundingBox())!.y;
    const managerStart = await managerFromProject();
    const productFromProject = async () =>
      (await product.boundingBox())!.y - (await project.boundingBox())!.y;
    // Straight down, well clear of every other card: an empty-space drop.
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2, start.y - start.height * 1.5, { steps: 15 });
    await page.mouse.up();

    // Only that box moved; its manager card stayed put.
    await expect.poll(productFromProject).toBeLessThan(-20);
    expect(Math.abs((await managerFromProject()) - managerStart)).toBeLessThan(2);
    await expect.poll(() => readCardOffsetKeys(companyId)).toEqual([productKey]);

    // Saved for everyone: still above its row after a reload. Polled, because
    // the chart lays itself out a moment after the page loads.
    await page.reload();
    await expect(product).toBeVisible();
    await expect(project).toBeVisible();
    await expect
      .poll(async () => {
        const [p, q] = [await product.boundingBox(), await project.boundingBox()];
        return p && q ? q.y - p.y : 0;
      })
      .toBeGreaterThan(10);

    // Reset positions puts it back in line with Project.
    await page.getByRole("button", { name: /arrange/i }).click();
    await page.getByRole("button", { name: "Reset positions" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset positions" }).click();
    await expect.poll(() => readCardOffsetKeys(companyId)).toEqual([]);
    await expect
      .poll(async () =>
        Math.abs((await product.boundingBox())!.y - (await project.boundingBox())!.y)
      )
      .toBeLessThan(2);
  });

  test("+ on a sub-department box opens Add Position for that department, reporting to its manager", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    await page.getByRole("button", { name: `Add a position in Product ${suffix}` }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add Position" })).toBeVisible();
    // Department is the sub-department; the manager is the CDS head that
    // Product's own manager reports to (one level above the box).
    await expect(
      dialog.getByRole("combobox", { name: "Department" }).locator("option:checked")
    ).toHaveText(`Product ${suffix}`);
    await expect(dialog.getByRole("combobox", { name: /^reports to$/i })).toHaveValue(
      `CDS Head ${suffix}`
    );
    await dialog.getByRole("button", { name: /cancel/i }).click();
  });
});
