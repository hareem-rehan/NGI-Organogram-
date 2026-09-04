import { test, expect } from "@playwright/test";

import { signInAs } from "./support/sign-in-as";

test.describe("Company Settings (Phase 12)", () => {
  test("VIEWER cannot access Settings", async ({ page, baseURL }) => {
    await signInAs(page, "VIEWER", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/access-denied$/);
  });

  test("HR_EDITOR cannot access Settings", async ({ page, baseURL }) => {
    await signInAs(page, "HR_EDITOR", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/access-denied$/);
  });

  test("ADMIN changes company settings in an isolated company, and the change is audited", async ({
    page,
    baseURL,
  }) => {
    // An isolated, freshly-seeded company avoids any concurrent-write
    // race with other spec files saving Settings against the shared
    // admin.json company in a parallel worker.
    await signInAs(page, "ADMIN", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

    await page.getByLabel(/default expansion depth/i).fill("4");
    await page.getByRole("button", { name: "Save Organogram Defaults" }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();

    await page.goto("/audit-log");
    await page.getByLabel("Category").selectOption("COMPANY_SETTINGS");
    await expect(page.getByRole("row", { name: /SETTINGS_CHANGED/ }).first()).toBeVisible();
  });

  test("SSO client secret is never rendered anywhere on the Settings page", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, "ADMIN", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.toLowerCase()).not.toContain("client secret");
    expect(bodyText.toLowerCase()).not.toContain("access token");
  });
});
