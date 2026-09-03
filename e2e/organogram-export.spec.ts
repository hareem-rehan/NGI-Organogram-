import { test, expect } from "@playwright/test";

import { signInAs } from "./support/sign-in-as";

test.describe("Organogram export (Phase 11)", () => {
  test("VIEWER never sees the Export button", async ({ page, baseURL }) => {
    await signInAs(page, "VIEWER", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/organogram");
    await expect(page.getByRole("button", { name: "Export" })).not.toBeVisible();
  });

  test("ADMIN generates and downloads a PDF export of the full company", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Export" }).click();

    const dialog = page.getByRole("dialog", { name: /export organization chart/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Format")).toHaveValue("PDF");
    await expect(dialog.getByLabel("Scope")).toHaveValue("FULL_COMPANY");

    await dialog.getByRole("button", { name: /generate export/i }).click();
    await expect(dialog.getByText(/your pdf export is ready/i)).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: /^download/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test("generating a PNG export offers the Image scale option instead of PDF page options", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Export" }).click();

    const dialog = page.getByRole("dialog", { name: /export organization chart/i });
    await dialog.getByLabel("Format").selectOption("PNG");

    await expect(dialog.getByLabel("Image scale")).toBeVisible();
    await expect(dialog.getByLabel("Page size")).not.toBeVisible();

    await dialog.getByRole("button", { name: /generate export/i }).click();
    await expect(dialog.getByText(/your png export is ready/i)).toBeVisible();
  });

  test("Position Focus scope requires choosing a position before Generate export is enabled", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Export" }).click();

    const dialog = page.getByRole("dialog", { name: /export organization chart/i });
    await dialog.getByLabel("Scope").selectOption("POSITION_FOCUS");

    await expect(dialog.getByRole("button", { name: /generate export/i })).toBeDisabled();

    const positionSelect = dialog.getByLabel(/^Position\*?$/);
    const options = await positionSelect.locator("option").all();
    expect(options.length).toBeGreaterThan(1);
    await positionSelect.selectOption({ index: 1 });

    await expect(dialog.getByRole("button", { name: /generate export/i })).toBeEnabled();
  });
});
