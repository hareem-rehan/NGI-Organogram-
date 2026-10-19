import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import {
  readCardOffsetKeys,
  readSubdivisionOrder,
  renameSubdivision,
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

    // The boxes' parent and the zoom, to check the view holds (client report).
    const head = page
      .locator('[data-testid^="rf__node-"]')
      .filter({ has: page.getByText(`Head of People ${suffix}`, { exact: true }) });
    const zoomText = () =>
      page
        .getByRole("combobox", { name: "Zoom level" })
        .evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent);
    const headBefore = (await head.boundingBox())!;
    const zoomBefore = await zoomText();

    // Let Branding go to the right of Recruitment, in empty space.
    const from = (await branding.boundingBox())!;
    const last = (await recruitment.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width * 1.5, from.y + from.height / 2, { steps: 20 });
    await page.mouse.up();

    await expect.poll(order).toEqual([names[1], names[2], names[0]]);
    expect(await readCardOffsetKeys(companyId)).toEqual([]);
    // The chart is not reloaded or re-framed: the parent stays where it was,
    // at the same zoom, and the boxes swap in front of it.
    await expect(page.getByText(/loading organization chart/i)).toHaveCount(0);
    await expect
      .poll(async () => {
        const now = (await head.boundingBox())!;
        return Math.abs(now.x - headBefore.x) < 2 && Math.abs(now.y - headBefore.y) < 2;
      })
      .toBe(true);
    expect(await zoomText()).toBe(zoomBefore);
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

  test("a long sub-division name is shown in full: the box grows, nothing is cut off with '…'", async ({
    page,
  }) => {
    const long = `Backend (MERN, LAMP, AI/ML, DS, Python, Full Stack) ${suffix}`;
    await renameSubdivision(companyId, `HR Ops ${suffix}`, long);
    await page.goto("/organogram");
    const name = box(page, long).locator("button p").first();
    await expect(name).toBeVisible();
    await expect(name).toHaveText(long);
    // Not clipped: the whole text fits in the box (no line clamp hides any).
    const clipped = await name.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(clipped).toBe(false);
    expect((await name.boundingBox())!.height).toBeGreaterThan(3 * 14);
    await renameSubdivision(companyId, long, `HR Ops ${suffix}`);
  });
});
