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
    await expect(page.getByRole("button", { name: /^delete$/i })).toHaveCount(0);
  });

  test("an empty department can be deleted, and the confirm step is not skippable", async ({
    page,
  }) => {
    await page.goto("/departments");

    const code = `E2E-DEL-${Date.now().toString(36).toUpperCase()}`;
    const name = `E2E Deletable ${code}`;
    await page.getByRole("button", { name: /add department/i }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel(/name/i).fill(name);
    await createDialog.getByLabel(/code/i).fill(code);
    await createDialog.getByRole("button", { name: /create department/i }).click();
    await expect(createDialog).toBeHidden();

    const row = page.getByRole("row").filter({ hasText: code });
    await expect(row).toBeVisible();

    // Cancelling leaves it alone — a destructive action is never one click.
    await row.getByRole("button", { name: /^delete$/i }).click();
    await expect(page.getByRole("heading", { name: /delete department/i })).toBeVisible();
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: /^delete$/i }).click();
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByRole("row").filter({ hasText: code })).toHaveCount(0);

    // Gone from the server too, not just from this rendered list.
    await page.reload();
    await expect(page.getByText(code)).toHaveCount(0);
  });

  test("a department that still has positions cannot be deleted, and is told why", async ({
    page,
  }) => {
    // positions.spec.ts runs to completion before this file starts (see
    // playwright.config.ts's "positions-first" project) and leaves this
    // shared company with a department that has positions in it — exactly
    // the state this needs, without creating a second root position here.
    await page.goto("/departments");
    const row = page
      .getByRole("row")
      .filter({ hasText: /E2E Positions Dept/ })
      .first();
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: /^delete$/i }).click();
    await page.getByRole("button", { name: "Delete" }).click();

    // A named blocker and a route forward, not a generic failure.
    await expect(page.getByText(/cannot be deleted/i)).toBeVisible();
    await expect(page.getByText(/deactivate this department instead/i)).toBeVisible();

    // Refused means nothing changed.
    await page.reload();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: /E2E Positions Dept/ })
        .first()
    ).toBeVisible();
  });
});
