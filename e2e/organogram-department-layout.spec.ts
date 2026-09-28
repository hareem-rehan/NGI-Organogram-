import { test, expect } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import {
  seedDepartmentLayoutChart,
  type DepartmentLayoutChart,
} from "./support/department-layout-fixtures";

/**
 * Department segregation on the real chart: every department's cards stay in
 * their own horizontal band, and neighbouring bands are separated by a clear
 * gap — no department's branch drifts under another's (the reported bug:
 * Client Delivery Services' cards collided with Engineering's).
 *
 * Measured in FLOW coordinates (each card's own transform), not screen
 * pixels, so the assertion is independent of the chart's zoom level.
 */
test.describe("Organogram — department segregation", () => {
  const suffix = Date.now().toString(36).toUpperCase();
  let cookieValue: string;
  let chart: DepartmentLayoutChart;

  test.beforeAll(async () => {
    const session = await seedAuthenticatedSession("ADMIN");
    cookieValue = session.cookieValue;
    chart = await seedDepartmentLayoutChart(session.companyId, suffix);
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

  test("keeps each department in its own band with a clear gap between departments", async ({
    page,
  }, testInfo) => {
    await page.goto("/organogram");
    // Wait until the widest department's deepest cards are laid out.
    const lastEngId = chart.positionIdsByDepartment["Engineering"]!.at(-1)!;
    await expect(page.getByTestId(`rf__node-${lastEngId}`)).toBeVisible();

    const bands: { name: string; left: number; right: number }[] = [];
    for (const [name, ids] of Object.entries(chart.positionIdsByDepartment)) {
      const xs = await page.evaluate((nodeIds) => {
        return nodeIds.map((id) => {
          const el = document.querySelector<HTMLElement>(`[data-testid="rf__node-${id}"]`);
          const match = el?.style.transform.match(/translate\(([-\d.]+)px/);
          return { x: match ? Number(match[1]) : NaN, w: el?.offsetWidth ?? 0 };
        });
      }, ids);
      expect(xs.every((p) => Number.isFinite(p.x))).toBe(true);
      bands.push({
        name,
        left: Math.min(...xs.map((p) => p.x)),
        right: Math.max(...xs.map((p) => p.x + p.w)),
      });
    }

    bands.sort((a, b) => a.left - b.left);
    for (let i = 1; i < bands.length; i++) {
      const gap = bands[i]!.left - bands[i - 1]!.right;
      // Clearly wider than the 24px gap between two cards of one department.
      expect(gap, `${bands[i - 1]!.name} → ${bands[i]!.name}`).toBeGreaterThanOrEqual(100);
    }

    await page.getByRole("button", { name: /fit to view/i }).click();
    await page.screenshot({ path: testInfo.outputPath("department-layout.png"), fullPage: true });
  });
});
