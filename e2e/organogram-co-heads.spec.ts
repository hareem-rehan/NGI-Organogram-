import { test, expect } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import { occupyPosition, seedCoHeadedChart } from "./support/chart-fixtures";

/**
 * Co-heads on the chart (docs/DECISIONS.md D27): a position that reports to
 * two heads is drawn once, below both, with a solid line from each head —
 * the two lines meet above the card. Seeded directly (see
 * e2e/support/chart-fixtures.ts) so this spec stays about the CHART; the
 * create/edit UI is covered by e2e/positions.spec.ts.
 */
test.describe("Organogram — a position with two heads", () => {
  const suffix = Date.now().toString(36).toUpperCase();
  let cookieValue: string;
  let ids: Awaited<ReturnType<typeof seedCoHeadedChart>>;

  test.beforeAll(async () => {
    const session = await seedAuthenticatedSession("ADMIN");
    cookieValue = session.cookieValue;
    ids = await seedCoHeadedChart(session.companyId, suffix);
    for (const [title, first] of [
      [`CoHead CEO ${suffix}`, "Ceo"],
      [`Sr. Software Engineer II ${suffix}`, "Ghulam"],
      [`Associate Tech Lead ${suffix}`, "Maha"],
      [`Sr. Software Engineer ${suffix}`, "Shared"],
      [`Software Engineer II ${suffix}`, "Junior"],
    ] as const) {
      await occupyPosition(session.companyId, title, { firstName: first, lastName: suffix });
    }
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

  test("draws one card with a line from EACH head, and the card sits below both", async ({
    page,
  }, testInfo) => {
    await page.goto("/organogram");

    const shared = page.getByText(`Shared ${suffix}`).first();
    await expect(shared).toBeVisible();
    // Exactly one card for the shared position, however many heads it has.
    await expect(page.getByText(`Shared ${suffix}`)).toHaveCount(1);

    await expect(page.getByTestId(`rf__edge-${ids.headAId}-${ids.sharedId}`)).toHaveCount(1);
    await expect(page.getByTestId(`rf__edge-${ids.headBId}-${ids.sharedId}`)).toHaveCount(1);

    // Laid out below BOTH heads.
    const sharedBox = await page.getByTestId(`rf__node-${ids.sharedId}`).boundingBox();
    const headABox = await page.getByTestId(`rf__node-${ids.headAId}`).boundingBox();
    const headBBox = await page.getByTestId(`rf__node-${ids.headBId}`).boundingBox();
    expect(sharedBox && headABox && headBBox).toBeTruthy();
    expect(sharedBox!.y).toBeGreaterThan(headABox!.y + headABox!.height);
    expect(sharedBox!.y).toBeGreaterThan(headBBox!.y + headBBox!.height);

    await page.screenshot({ path: testInfo.outputPath("co-heads.png") });
  });
});
