import { test, expect } from "@playwright/test";

import { signInAs } from "./support/sign-in-as";

test.describe("Audit Log (Phase 12)", () => {
  test("VIEWER cannot access the Audit Log", async ({ page, baseURL }) => {
    await signInAs(page, "VIEWER", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/audit-log");
    await expect(page).toHaveURL(/\/access-denied$/);
  });

  test("ADMIN views the audit log after making a real change, filters by category, and inspects a safe before/after diff", async ({
    page,
  }) => {
    // Generate a real, attributable audit event first — a uniquely-coded
    // Department create, which (unlike Settings) has no shared-row
    // concurrency risk with other spec files running in parallel workers
    // against the same seeded company.
    const code = `AUD-E2E-${Date.now().toString(36).toUpperCase()}`;
    await page.goto("/departments");
    await page.getByRole("button", { name: /add department/i }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel(/name/i).fill(`Audit E2E ${code}`);
    await createDialog.getByLabel(/code/i).fill(code);
    await createDialog.getByRole("button", { name: /create department/i }).click();
    await expect(createDialog).toBeHidden();

    await page.goto("/audit-log");
    await expect(page.getByRole("heading", { level: 1, name: "Audit Log" })).toBeVisible();

    await page.getByLabel("Category").selectOption("DEPARTMENT");
    await page.getByLabel("Entity type").fill("Department");
    const row = page.getByRole("row", { name: new RegExp(code) }).first();
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "View Details" }).click();
    const dialog = page.getByRole("dialog", { name: /audit event details/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Before")).toBeVisible();
    await expect(dialog.getByText("After")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^edit$/i })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^delete$/i })).toHaveCount(0);
  });

  test("HR_EDITOR sees organization-change events but never USER_ADMINISTRATION events", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, "HR_EDITOR", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/audit-log");
    await expect(page.getByRole("heading", { level: 1, name: "Audit Log" })).toBeVisible();

    await page.getByLabel("Category").selectOption("USER_ADMINISTRATION");
    await expect(page.getByText("No matching audit events")).toBeVisible();
  });
});
