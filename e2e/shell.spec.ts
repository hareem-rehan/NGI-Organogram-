import { test, expect } from "@playwright/test";

import { NAV_ITEMS } from "../config/navigation";

/**
 * Routes that have moved past the Phase 1 placeholder — each gets its own
 * dedicated spec (e.g. e2e/departments.spec.ts) covering its real
 * behavior; this file only re-confirms it's reachable and still renders
 * its heading, not that it's a placeholder.
 */
const IMPLEMENTED_ROUTES = new Set([
  "/dashboard",
  "/organogram",
  "/departments",
  "/positions",
  "/employees",
  "/imports",
  "/audit-log",
  "/users",
  "/settings",
]);

test.describe("Application shell", () => {
  test("root path redirects to the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  });

  test("every navigation item is reachable and renders its own heading", async ({ page }) => {
    for (const item of NAV_ITEMS) {
      await page.goto(item.href);
      await expect(page).toHaveURL(new RegExp(`${item.href}$`));
      await expect(page.getByRole("heading", { level: 1, name: item.label })).toBeVisible();
      if (!IMPLEMENTED_ROUTES.has(item.href)) {
        await expect(page.getByText(`Planned for Phase ${item.plannedPhase}`)).toBeVisible();
      }
    }
  });

  test("an unknown route shows the not-found experience", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page.getByRole("heading", { level: 1, name: /page not found/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /go to dashboard/i })).toBeVisible();
  });

  test("desktop navigation links are keyboard-reachable and activate the target route", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const departmentsLink = page.getByRole("link", { name: "Departments" });
    await departmentsLink.focus();
    await expect(departmentsLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/departments$/);
  });

  test("visible focus outline appears when tabbing to an interactive element", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();
  });
});
