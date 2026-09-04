import { test, expect } from "@playwright/test";

import { signInAs } from "./support/sign-in-as";

test.describe("Department management (Phase 4)", () => {
  test("HR_EDITOR/ADMIN can create a department and see it in the list", async ({ page }) => {
    await page.goto("/departments");
    await expect(page.getByRole("heading", { level: 1, name: "Departments" })).toBeVisible();

    await page.getByRole("button", { name: /add department/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const code = `E2E-${Date.now().toString(36).toUpperCase()}`;
    await dialog.getByLabel(/name/i).fill("E2E Test Department");
    await dialog.getByLabel(/code/i).fill(code);
    await dialog.getByRole("button", { name: /create department/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("E2E Test Department")).toBeVisible();
    await expect(page.getByText(code)).toBeVisible();
  });

  test("duplicate department code is rejected with a clear error, dialog stays open", async ({
    page,
  }) => {
    await page.goto("/departments");

    const code = `E2E-DUP-${Date.now().toString(36).toUpperCase()}`;

    // Create the first one.
    await page.getByRole("button", { name: /add department/i }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel(/name/i).fill("Original Department");
    await dialog.getByLabel(/code/i).fill(code);
    await dialog.getByRole("button", { name: /create department/i }).click();
    await expect(dialog).toBeHidden();

    // Attempt a duplicate.
    await page.getByRole("button", { name: /add department/i }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel(/name/i).fill("Duplicate Attempt");
    await dialog.getByLabel(/code/i).fill(code);
    await dialog.getByRole("button", { name: /create department/i }).click();

    await expect(dialog.getByText(/already in use/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("VIEWER can view departments but cannot see any mutation control", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, "VIEWER", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/departments");

    await expect(page.getByRole("heading", { level: 1, name: "Departments" })).toBeVisible();
    await expect(page.getByRole("button", { name: /add department/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^edit$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /deactivate/i })).toHaveCount(0);
  });
});
