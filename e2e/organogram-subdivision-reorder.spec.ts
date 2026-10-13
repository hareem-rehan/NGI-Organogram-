import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import {
  readCardOffsetKeys,
  readSubdivisionOrder,
  seedSubdivisionChart,
} from "./support/department-layout-fixtures";

/**
 * Reordering sub-division boxes (the boxes under a head, one per
 * sub-division) by dragging them along their row in Arrange mode (D55).
 */
test.describe.configure({ mode: "serial" });

test.describe("Organogram — sub-division reorder", () => {
  const suffix = `SV${Date.now().toString(36).toUpperCase()}`;
  let cookieValue: string;
  let companyId: string;

  test.beforeAll(async () => {
    const session = await seedAuthenticatedSession("ADMIN");
    cookieValue = session.cookieValue;
    companyId = session.companyId;
    await seedSubdivisionChart(companyId, suffix);
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

  test("dragging a sub-division box to the end of its row moves it there, branch and all; Undo puts it back", async ({
    page,
  }) => {
    const names = ["Branding", "HR Ops", "Recruitment"].map((n) => `${n} ${suffix}`);
    const order = async () =>
      (await readSubdivisionOrder(companyId)).filter((n) => names.includes(n));

    await page.goto("/organogram");
    await page.getByRole("button", { name: /arrange/i }).click();
    const branding = box(page, names[0]!);
    const recruitment = box(page, names[2]!);
    const lead = box(page, `Branding Lead ${suffix}`);
    await expect(recruitment).toBeVisible();
    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.locator(".react-flow").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    // Name order to start with: Branding, HR Ops, Recruitment.
    expect((await branding.boundingBox())!.x).toBeLessThan((await recruitment.boundingBox())!.x);

    // Let Branding go to the right of Recruitment, in empty space.
    const from = (await branding.boundingBox())!;
    const last = (await recruitment.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width * 1.5, from.y + from.height / 2, { steps: 20 });
    await page.mouse.up();

    await expect.poll(order).toEqual([names[1], names[2], names[0]]);
    expect(await readCardOffsetKeys(companyId)).toEqual([]);
    // On screen: Branding is now last, and its lead still sits centred under it.
    await expect
      .poll(async () => {
        const b = (await branding.boundingBox())!;
        const r = (await recruitment.boundingBox())!;
        const l = (await lead.boundingBox())!;
        return {
          brandingLast: b.x > r.x,
          sameRow: Math.abs(b.y - r.y) < 2,
          leadCentred: Math.abs(l.x + l.width / 2 - (b.x + b.width / 2)) < 4,
        };
      })
      .toEqual({ brandingLast: true, sameRow: true, leadCentred: true });

    await page.getByRole("button", { name: "Undo: Reorder sub-divisions" }).click();
    await expect.poll(order).toEqual(names);
  });
});
