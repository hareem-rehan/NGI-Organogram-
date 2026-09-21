import { test, expect, devices } from "@playwright/test";

// Spread the device descriptor for its viewport/UA/touch settings, but pin
// browserName back to "chromium" explicitly — devices["iPhone 13"] sets
// defaultBrowserType: "webkit", which would otherwise silently switch this
// file to WebKit even though the project (and CI) only installs Chromium.
test.use({ ...devices["iPhone 13"], browserName: "chromium" });

test.describe("Mobile navigation", () => {
  test("nav is collapsed behind a menu trigger on a narrow viewport", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await expect(page.getByRole("button", { name: /open navigation menu/i })).toBeVisible();
  });

  test("opening the menu and navigating works on a narrow viewport", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /open navigation menu/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("link", { name: "Employees" }).click();
    await expect(page).toHaveURL(/\/employees$/);
    await expect(dialog).toBeHidden();
  });
});
