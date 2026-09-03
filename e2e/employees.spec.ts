import { test, expect } from "@playwright/test";

import { signInAs } from "./support/sign-in-as";

// All employees tests share the same seeded company as positions.spec.ts
// and departments.spec.ts (the single ADMIN storageState every project
// test reuses), and this suite needs at least one real, vacant Position
// to assign employees to. Positions carries a real "at most one root per
// company" invariant, so this suite never attempts to create a rootless
// position of its own — playwright.config.ts's "positions-first" project
// dependency guarantees positions.spec.ts has already run to completion
// (and so has already claimed the company's one root) before this file
// starts, so the "prerequisite" test below always attaches under an
// existing position rather than racing to create a second root. Serial
// mode keeps this file's own multi-step scenario (assign -> transfer ->
// end -> terminate, all against the same employee/position pair) safe to
// reason about.
test.describe.configure({ mode: "serial" });

test.describe("Employee management and position assignments (Phase 6)", () => {
  const suffix = Date.now().toString(36).toUpperCase();
  const deptName = `E2E Employees Dept ${suffix}`;
  const positionATitle = `E2E Emp Position A ${suffix}`;
  const positionACode = `E2E-EMPPOS-A-${suffix}`;
  const positionBTitle = `E2E Emp Position B ${suffix}`;
  const positionBCode = `E2E-EMPPOS-B-${suffix}`;
  const emp1Code = `E2E-EMP1-${suffix}`;
  const emp2Code = `E2E-EMP2-${suffix}`;

  test("prerequisite: create a department and two vacant positions for assignment", async ({
    page,
  }) => {
    await page.goto("/departments");
    await page.getByRole("button", { name: /add department/i }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel(/name/i).fill(deptName);
    await dialog.getByLabel(/code/i).fill(`E2E-EMPDEPT-${suffix}`);
    await dialog.getByRole("button", { name: /create department/i }).click();
    await expect(dialog).toBeHidden();

    // Position A attaches under whatever position positions.spec.ts's own
    // root-creation test already created (guaranteed to exist by the
    // "positions-first" project dependency) — this suite never attempts
    // to claim the root itself.
    await page.goto("/positions");
    await expect(page.getByRole("row").nth(1)).toBeVisible();
    const existingParentName = await page
      .getByRole("row")
      .nth(1)
      .getByRole("cell")
      .first()
      .textContent();
    if (!existingParentName) {
      throw new Error(
        "Expected at least one existing position (created by positions.spec.ts) before employees.spec.ts runs — check playwright.config.ts's project dependencies."
      );
    }

    await page.getByRole("button", { name: /add position/i }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox", { name: "Department" })).not.toHaveValue("");
    // Explicitly select this suite's own department rather than relying
    // on the form's auto-selected default (the first department in the
    // list) — that default is only "whatever I just created" when no
    // other spec file creates a department concurrently, which no
    // longer holds now that e2e/dashboard.spec.ts (Phase 7) also creates
    // departments against this same shared company.
    await dialog.getByRole("combobox", { name: "Department" }).selectOption({ label: deptName });
    await dialog.locator('input[name="title"]').fill(positionATitle);
    await dialog.locator('input[name="positionCode"]').fill(positionACode);
    await dialog.getByRole("combobox", { name: /reports to/i }).click();
    await dialog.getByRole("combobox", { name: /reports to/i }).fill(existingParentName);
    await page
      .getByRole("option", { name: new RegExp(existingParentName, "i") })
      .first()
      .click();
    await dialog.getByRole("button", { name: /create position/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(positionATitle)).toBeVisible();

    // Position B: always attaches under Position A, which now definitely
    // exists — no root-conflict risk here.
    await page.getByRole("button", { name: /add position/i }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox", { name: "Department" })).not.toHaveValue("");
    await dialog.getByRole("combobox", { name: "Department" }).selectOption({ label: deptName });
    await dialog.locator('input[name="title"]').fill(positionBTitle);
    await dialog.locator('input[name="positionCode"]').fill(positionBCode);
    await dialog.getByRole("combobox", { name: /reports to/i }).click();
    await dialog.getByRole("combobox", { name: /reports to/i }).fill(positionATitle);
    await page.getByRole("option", { name: new RegExp(positionATitle) }).click();
    await dialog.getByRole("button", { name: /create position/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(positionBTitle)).toBeVisible();
  });

  test("HR_EDITOR/ADMIN can create an employee, who starts unassigned", async ({ page }) => {
    await page.goto("/employees");
    await expect(page.getByRole("heading", { level: 1, name: "Employees" })).toBeVisible();

    await page.getByRole("button", { name: /add employee/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/employee code/i).fill(emp1Code);
    await dialog.getByLabel(/first name/i).fill("Ada");
    await dialog.getByLabel(/last name/i).fill("Lovelace");
    await dialog.getByRole("button", { name: /create employee/i }).click();

    await expect(dialog).toBeHidden();
    const row = page.getByRole("row", { name: /ada lovelace/i });
    await expect(row).toBeVisible();
    await expect(row.getByText("Unassigned")).toBeVisible();
  });

  test("duplicate employee code is rejected with a clear error, dialog stays open", async ({
    page,
  }) => {
    await page.goto("/employees");
    await page.getByRole("button", { name: /add employee/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/employee code/i).fill(emp1Code);
    await dialog.getByLabel(/first name/i).fill("Duplicate");
    await dialog.getByLabel(/last name/i).fill("Attempt");
    await dialog.getByRole("button", { name: /create employee/i }).click();

    await expect(dialog.getByText(/already in use/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("VIEWER can view employees but cannot see any mutation control", async ({
    page,
    baseURL,
  }) => {
    // signInAs seeds a brand-new company for this role (see
    // e2e/support/seed-session.ts) — it is never the same company as the
    // default ADMIN storageState used by every other test in this file, so
    // this check is deliberately self-contained: it only proves the page
    // renders correctly with no manage controls for a VIEWER, not that a
    // VIEWER can see data created by a different session/company.
    await signInAs(page, "VIEWER", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/employees");

    await expect(page.getByRole("heading", { level: 1, name: "Employees" })).toBeVisible();
    await expect(page.getByRole("button", { name: /add employee/i })).toHaveCount(0);
  });

  test("HR_EDITOR/ADMIN can assign an unassigned employee to a vacant position", async ({
    page,
  }) => {
    // Each test gets a fresh browser context restored from the project's
    // default storageState (e2e/.auth/admin.json) — no need to sign in
    // again here; doing so would seed yet another disconnected company
    // (see the comment on the VIEWER test above) and lose the
    // department/positions/employees created by earlier tests in this file.
    await page.goto("/employees");
    await page.getByRole("link", { name: /ada lovelace/i }).click();

    await page.getByRole("button", { name: /assign to position/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Position" }).click();
    await dialog.getByRole("combobox", { name: "Position" }).fill(positionATitle);
    await page.getByRole("option", { name: new RegExp(positionATitle) }).click();
    await dialog.getByRole("button", { name: /^assign$/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(positionATitle).first()).toBeVisible();
    await expect(page.getByText(deptName)).toBeVisible();
    await expect(page.getByRole("button", { name: /^transfer$/i })).toBeVisible();
  });

  test("an occupied position is not offered as eligible for a second employee", async ({
    page,
  }) => {
    await page.goto("/employees");
    await page.getByRole("button", { name: /add employee/i }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel(/employee code/i).fill(emp2Code);
    await dialog.getByLabel(/first name/i).fill("Grace");
    await dialog.getByLabel(/last name/i).fill("Hopper");
    await dialog.getByRole("button", { name: /create employee/i }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("link", { name: /grace hopper/i }).click();
    await page.getByRole("button", { name: /assign to position/i }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Position" }).click();
    await dialog.getByRole("combobox", { name: "Position" }).fill(positionATitle);

    await expect(dialog.getByText(/no eligible positions found/i)).toBeVisible();
    await expect(page.getByRole("option", { name: new RegExp(positionATitle) })).toHaveCount(0);

    // Position B is still vacant and should appear instead.
    await dialog.getByRole("combobox", { name: "Position" }).fill(positionBTitle);
    await page.getByRole("option", { name: new RegExp(positionBTitle) }).click();
    await dialog.getByRole("button", { name: /^assign$/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(positionBTitle).first()).toBeVisible();
  });

  test("HR_EDITOR/ADMIN can transfer an employee, preserving assignment history", async ({
    page,
  }) => {
    await page.goto("/employees");
    await page.getByRole("link", { name: /ada lovelace/i }).click();

    await page.getByRole("button", { name: /^transfer$/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(positionATitle)).toBeVisible();
    await dialog.getByRole("combobox", { name: "Destination position" }).click();
    await dialog.getByRole("combobox", { name: "Destination position" }).fill(positionBTitle);
    // Position B is occupied by Grace Hopper, so it must not be offered.
    await expect(page.getByRole("option", { name: new RegExp(positionBTitle) })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog).toBeHidden();

    // End Grace's assignment first so Position B becomes vacant, then retry the transfer.
    await page.getByRole("link", { name: /^employees$/i }).click();
    await page.getByRole("link", { name: /grace hopper/i }).click();
    await page.getByRole("button", { name: /end assignment/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /end assignment/i })
      .click();
    await expect(page.getByText(/not currently assigned to any position/i)).toBeVisible();

    await page.getByRole("link", { name: /^employees$/i }).click();
    await page.getByRole("link", { name: /ada lovelace/i }).click();
    await page.getByRole("button", { name: /^transfer$/i }).click();
    const transferDialog = page.getByRole("dialog");
    await transferDialog.getByRole("combobox", { name: "Destination position" }).click();
    await transferDialog
      .getByRole("combobox", { name: "Destination position" })
      .fill(positionBTitle);
    await page.getByRole("option", { name: new RegExp(positionBTitle) }).click();
    await transferDialog.getByRole("button", { name: /confirm transfer/i }).click();

    await expect(transferDialog).toBeHidden();
    await expect(page.getByText(positionBTitle).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: new RegExp(positionATitle) })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Historical" })).toBeVisible();
  });

  test("guided termination ends the active assignment and blocks further reassignment", async ({
    page,
  }) => {
    await page.goto("/employees");
    await page.getByRole("link", { name: /ada lovelace/i }).click();

    await page.getByRole("button", { name: /terminate employee/i }).click();
    const dialog = page.getByRole("dialog");
    const confirmButton = dialog.getByRole("button", { name: /terminate employee/i });
    await expect(confirmButton).toBeDisabled();
    await dialog.getByLabel(/type the employee code/i).fill(emp1Code);
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Terminated", { exact: true })).toBeVisible();
    await expect(page.getByText(/no position — employment terminated/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /assign to position/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /terminate employee/i })).toHaveCount(0);

    // Position B is vacant again — a different employee can now take it.
    await page.getByRole("link", { name: /^employees$/i }).click();
    await page.getByRole("link", { name: /grace hopper/i }).click();
    await page.getByRole("button", { name: /assign to position/i }).click();
    const assignDialog = page.getByRole("dialog");
    await assignDialog.getByRole("combobox", { name: "Position" }).click();
    await assignDialog.getByRole("combobox", { name: "Position" }).fill(positionBTitle);
    await page.getByRole("option", { name: new RegExp(positionBTitle) }).click();
    await assignDialog.getByRole("button", { name: /^assign$/i }).click();
    await expect(assignDialog).toBeHidden();
    await expect(page.getByText(positionBTitle).first()).toBeVisible();
  });
});
