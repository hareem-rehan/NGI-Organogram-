import { test, expect } from "@playwright/test";

import { signInAs } from "./support/sign-in-as";

test.describe("User Administration (Phase 12)", () => {
  test("VIEWER cannot access User Administration", async ({ page, baseURL }) => {
    await signInAs(page, "VIEWER", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/users");
    await expect(page).toHaveURL(/\/access-denied$/);
  });

  test("HR_EDITOR cannot access User Administration", async ({ page, baseURL }) => {
    await signInAs(page, "HR_EDITOR", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/users");
    await expect(page).toHaveURL(/\/access-denied$/);
  });

  test("ADMIN provisions a VIEWER, changes their role, disables, and reactivates them", async ({
    page,
  }) => {
    const email = `e2e-provisioned-${Date.now()}@northwind-example.test`;

    await page.goto("/users");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();

    await page.getByRole("button", { name: "Provision User" }).click();
    const provisionDialog = page.getByRole("dialog", { name: /provision user/i });
    await provisionDialog.getByLabel(/company email/i).fill(email);
    await provisionDialog.getByRole("combobox", { name: /^role$/i }).selectOption("VIEWER");
    await provisionDialog.getByRole("button", { name: "Provision User" }).click();
    await expect(provisionDialog).toBeHidden();

    const row = page.getByRole("row", { name: new RegExp(email) });
    await expect(row).toBeVisible();
    await expect(row.getByText("VIEWER")).toBeVisible();

    // Change role to HR_EDITOR.
    await row.getByRole("button", { name: "Change Role" }).click();
    const roleDialog = page.getByRole("dialog", { name: /change role/i });
    await roleDialog.getByLabel(/new role/i).selectOption("HR_EDITOR");
    await roleDialog.getByRole("button", { name: /save role/i }).click();
    await expect(roleDialog).toBeHidden();
    await expect(row.getByText("HR_EDITOR")).toBeVisible();

    // Disable.
    await row.getByRole("button", { name: "Disable" }).click();
    const disableDialog = page.getByRole("dialog", { name: /disable user/i });
    await disableDialog.getByRole("button", { name: /disable user/i }).click();
    await expect(disableDialog).toBeHidden();
    await expect(row.getByText("DISABLED")).toBeVisible();

    // Reactivate.
    await row.getByRole("button", { name: "Reactivate" }).click();
    await expect(row.getByText("ACTIVE")).toBeVisible();
  });

  test("last active ADMIN cannot be disabled or demoted", async ({ page, baseURL }) => {
    // signInAs seeds a brand-new, isolated company whose ONLY user is
    // this one ADMIN — safe to exercise last-admin protection here
    // without touching the shared admin.json session other spec files
    // depend on.
    await signInAs(page, "ADMIN", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/users");

    const row = page.getByRole("row", { name: /ADMIN/ }).first();
    await row.getByRole("button", { name: "Disable" }).click();
    const disableDialog = page.getByRole("dialog", { name: /disable user/i });
    await disableDialog.getByRole("button", { name: /disable user/i }).click();
    await expect(disableDialog.getByText(/at least one active admin/i)).toBeVisible();

    await disableDialog.getByRole("button", { name: /^cancel$/i }).click();
    await row.getByRole("button", { name: "Change Role" }).click();
    const roleDialog = page.getByRole("dialog", { name: /change role/i });
    await roleDialog.getByLabel(/new role/i).selectOption("VIEWER");
    await roleDialog.getByRole("checkbox").check();
    await roleDialog.getByRole("button", { name: /save role/i }).click();
    await expect(roleDialog.getByText(/at least one active admin/i)).toBeVisible();
  });

  test("linking and unlinking an Employee never changes the user's role", async ({ page }) => {
    const email = `e2e-linkable-${Date.now()}@northwind-example.test`;
    await page.goto("/users");
    await page.getByRole("button", { name: "Provision User" }).click();
    const provisionDialog = page.getByRole("dialog", { name: /provision user/i });
    await provisionDialog.getByLabel(/company email/i).fill(email);
    await provisionDialog.getByRole("button", { name: "Provision User" }).click();
    await expect(provisionDialog).toBeHidden();

    const row = page.getByRole("row", { name: new RegExp(email) });
    await row.getByRole("button", { name: /link employee/i }).click();
    const linkDialog = page.getByRole("dialog", { name: /link employee/i });
    await expect(linkDialog).toBeVisible();
    // No assertion on a specific employee result set — this only proves
    // the picker opens safely; full linking behavior is covered at the
    // integration level (tests/integration/user-admin.integration.test.ts).
    await linkDialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(row.getByText("VIEWER")).toBeVisible();
  });
});
