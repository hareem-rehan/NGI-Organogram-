import { test, expect } from "@playwright/test";

import { signInAs } from "./support/sign-in-as";

test.describe("CSV Import (Phase 10)", () => {
  test("VIEWER cannot access imports", async ({ page, baseURL }) => {
    await signInAs(page, "VIEWER", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/imports");
    await expect(page).toHaveURL(/access-denied/);
  });

  test("HR_EDITOR downloads a Department import template", async ({ page }) => {
    await page.goto("/imports");
    await expect(page.getByRole("heading", { level: 1, name: "Imports" })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /download template/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("department-import-template.csv");
  });

  test("a valid Department CSV validates, previews, confirms, executes, and the department appears in Departments", async ({
    page,
  }) => {
    const name = `E2E Import Test Department ${Date.now().toString(36).toUpperCase()}`;

    await page.goto("/imports");
    const wizard = page.getByRole("region", { name: "New Import" });
    // Departments are named, never coded, in CSVs (D52).
    const csv = `departmentName\n${name}\n`;
    await page.locator('input[type="file"]').setInputFiles({
      name: "departments.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });

    await expect(wizard.getByText("VALIDATED")).toBeVisible();
    await expect(wizard.getByText("1 total rows")).toBeVisible();
    await expect(wizard.getByRole("cell").getByText("CREATE", { exact: true })).toBeVisible();

    await wizard.getByRole("button", { name: /confirm import/i }).click();
    await expect(wizard.getByText("READY TO EXECUTE")).toBeVisible();

    await wizard.getByRole("button", { name: /execute import/i }).click();
    await expect(wizard.getByText(/import complete: 1 created/i)).toBeVisible();

    // The preview names the department rather than showing an internal code.
    await expect(wizard.getByRole("cell", { name })).toBeVisible();

    await page.goto("/departments");
    await expect(page.getByText(name)).toBeVisible();
  });

  test("an invalid CSV (the same department twice in the file) shows row-level errors and cannot be executed", async ({
    page,
  }) => {
    await page.goto("/imports");
    const wizard = page.getByRole("region", { name: "New Import" });
    const csv = "departmentName\nDuplicate Test\nduplicate test\n";
    await page.locator('input[type="file"]').setInputFiles({
      name: "departments.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });

    await expect(wizard.getByText("VALIDATION FAILED")).toBeVisible();
    await expect(wizard.getByText(/2 error/i)).toBeVisible();
    await expect(wizard.getByRole("button", { name: /confirm import/i })).toHaveCount(0);
    await expect(wizard.getByRole("button", { name: /execute import/i })).toHaveCount(0);

    const downloadPromise = page.waitForEvent("download");
    await wizard.getByRole("button", { name: /download error report/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^import-errors-.*\.csv$/);
  });

  test("an empty file is rejected with a clear error, never a crash", async ({ page }) => {
    await page.goto("/imports");
    await page.locator('input[type="file"]').setInputFiles({
      name: "empty.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("", "utf-8"),
    });

    await expect(page.getByText("The uploaded file is empty.")).toBeVisible();
  });

  test("the recent imports list reflects a completed import", async ({ page }) => {
    const name = `List Test Department ${Date.now().toString(36).toUpperCase()}`;
    await page.goto("/imports");
    const csv = `departmentName\n${name}\n`;
    await page.locator('input[type="file"]').setInputFiles({
      name: "departments.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });
    await page.getByRole("button", { name: /confirm import/i }).click();
    await page.getByRole("button", { name: /execute import/i }).click();
    await expect(page.getByText(/import complete: 1 created/i)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Recent Imports" })).toBeVisible();
    await expect(page.getByText("1 created, 0 updated").first()).toBeVisible();
  });
});
