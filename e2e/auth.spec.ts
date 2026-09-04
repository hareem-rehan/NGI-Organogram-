import { test, expect } from "@playwright/test";

import { NAV_ITEMS } from "../config/navigation";

// This file deliberately overrides the project-level storageState (which
// signs every other e2e test in as ADMIN — see e2e/auth.setup.ts) so it
// can exercise the genuinely unauthenticated path.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Unauthenticated access (Phase 3 route protection)", () => {
  test("visiting a protected route without a session redirects to sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("button", { name: /sign in with/i })).toBeVisible();
  });

  test("every nav-item route redirects an unauthenticated visitor to sign-in", async ({ page }) => {
    for (const item of NAV_ITEMS) {
      await page.goto(item.href);
      await expect(page).toHaveURL(/\/sign-in$/);
    }
  });

  test("root path redirects an unauthenticated visitor to sign-in, not the dashboard", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
