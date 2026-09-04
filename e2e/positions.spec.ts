import { test, expect } from "@playwright/test";

import { signInAs } from "./support/sign-in-as";

// All positions tests share one seeded company (the same ADMIN session
// storageState every test in this project reuses), and Positions has a
// real "at most one root (null Reports-To) per company" invariant —
// unlike Departments, which has no such uniqueness constraint. Running
// these tests in parallel would race two "create a rootless position"
// attempts against each other. Serial mode makes the shared-company
// state safe to reason about, matching how a single HR user would
// actually build up a hierarchy one step at a time.
test.describe.configure({ mode: "serial" });

test.describe("Position and hierarchy management (Phase 5)", () => {
  const suffix = Date.now().toString(36).toUpperCase();
  const rootTitle = `E2E Root ${suffix}`;
  const rootCode = `E2E-ROOT-${suffix}`;
  const childTitle = `E2E Child ${suffix}`;
  const childCode = `E2E-CHILD-${suffix}`;
  const altParentTitle = `E2E Alt Parent ${suffix}`;
  const altParentCode = `E2E-ALT-${suffix}`;

  // Title/code fields are filled via their `name` attribute rather than
  // getByLabel — Playwright's getByLabel accessible-name resolution was
  // observed to hang indefinitely specifically when filling this form's
  // second required-asterisk-labeled field immediately after the first,
  // even though the same fields resolve correctly via getByLabel when
  // inspected individually or filled in isolation. Root cause not fully
  // isolated within the phase's time budget; name-attribute selectors are
  // a reliable, equally-explicit alternative — the department form
  // (e2e/departments.spec.ts) doesn't hit this and still uses getByLabel.
  async function fillTitleAndCode(
    dialog: import("@playwright/test").Locator,
    title: string,
    code: string
  ) {
    // The Department field's default value loads asynchronously after
    // the dialog opens — wait for it to settle before filling anything
    // else, matching how a real user would only start typing once the
    // form has finished rendering (Playwright's scripted fill can
    // otherwise outrace that async default, see
    // docs/phase-reports/PHASE_05_POSITION_AND_HIERARCHY.md).
    await expect(dialog.getByRole("combobox", { name: "Department" })).not.toHaveValue("");
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('input[name="positionCode"]').fill(code);
  }

  test("prerequisite: create a department for positions to belong to", async ({ page }) => {
    // This suite's seeded company starts with zero departments — Position
    // requires one (Position.departmentId is required, docs/DATA_DICTIONARY.md).
    await page.goto("/departments");
    await page.getByRole("button", { name: /add department/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/name/i).fill(`E2E Positions Dept ${suffix}`);
    await dialog.getByLabel(/code/i).fill(`E2E-POSDEPT-${suffix}`);
    await dialog.getByRole("button", { name: /create department/i }).click();
    await expect(dialog).toBeHidden();
  });

  test("HR_EDITOR/ADMIN can create the root position", async ({ page }) => {
    await page.goto("/positions");
    await expect(page.getByRole("heading", { level: 1, name: "Positions" })).toBeVisible();

    await page.getByRole("button", { name: /add position/i }).click();
    const dialog = page.getByRole("dialog");
    await fillTitleAndCode(dialog, rootTitle, rootCode);
    await expect(dialog.getByText(/root position/i)).toBeVisible();
    await dialog.getByRole("button", { name: /create position/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(rootTitle)).toBeVisible();
    await expect(
      page
        .getByRole("row", { name: new RegExp(rootTitle) })
        .getByRole("cell", { name: "1", exact: true })
    ).toBeVisible();
  });

  test("a second attempt to create a rootless position is rejected (only one root per company)", async ({
    page,
  }) => {
    await page.goto("/positions");

    await page.getByRole("button", { name: /add position/i }).click();
    const dialog = page.getByRole("dialog");
    await fillTitleAndCode(dialog, "Should Not Become Root", `E2E-NOROOT-${suffix}`);
    await dialog.getByRole("button", { name: /create position/i }).click();

    await expect(dialog.getByText(/already has a root position/i)).toBeVisible();
  });

  test("HR_EDITOR/ADMIN can create a position reporting to an existing one via the Reports-To combobox", async ({
    page,
  }) => {
    await page.goto("/positions");

    await page.getByRole("button", { name: /add position/i }).click();
    const dialog = page.getByRole("dialog");
    await fillTitleAndCode(dialog, childTitle, childCode);
    await dialog.getByRole("combobox", { name: /reports to/i }).click();
    await dialog.getByRole("combobox", { name: /reports to/i }).fill(rootTitle);
    await page.getByRole("option", { name: new RegExp(rootTitle) }).click();
    await dialog.getByRole("button", { name: /create position/i }).click();

    await expect(dialog).toBeHidden();
    const childRow = page.getByRole("row", { name: new RegExp(childTitle) });
    await expect(childRow).toBeVisible();
    await expect(childRow.getByText(rootTitle)).toBeVisible();
    await expect(childRow.getByRole("cell", { name: "2", exact: true })).toBeVisible();
  });

  test("changing Reports-To shows descendant-recalculation feedback and updates the hierarchy", async ({
    page,
  }) => {
    await page.goto("/positions");

    // A second parent for the child to move under (itself reporting to
    // the root, since only one true root is allowed).
    await page.getByRole("button", { name: /add position/i }).click();
    let dialog = page.getByRole("dialog");
    await fillTitleAndCode(dialog, altParentTitle, altParentCode);
    await dialog.getByRole("combobox", { name: /reports to/i }).click();
    await dialog.getByRole("combobox", { name: /reports to/i }).fill(rootTitle);
    await page.getByRole("option", { name: new RegExp(rootTitle) }).click();
    await dialog.getByRole("button", { name: /create position/i }).click();
    await expect(dialog).toBeHidden();

    const childRow = page.getByRole("row", { name: new RegExp(childTitle) });
    await childRow.getByRole("button", { name: /change reports-to/i }).click();

    dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/reporting hierarchy/i)).toBeVisible();
    await dialog.getByRole("combobox", { name: /new reports-to/i }).click();
    await dialog.getByRole("combobox", { name: /new reports-to/i }).fill(altParentTitle);
    await page.getByRole("option", { name: new RegExp(altParentTitle) }).click();
    await dialog.getByRole("button", { name: /confirm move/i }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("row", { name: new RegExp(childTitle) }).getByText(altParentTitle)
    ).toBeVisible();
  });

  test("VIEWER can view positions but cannot see any mutation control", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, "VIEWER", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/positions");

    await expect(page.getByRole("heading", { level: 1, name: "Positions" })).toBeVisible();
    await expect(page.getByRole("button", { name: /add position/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /change reports-to/i })).toHaveCount(0);
  });

  test("duplicate position code is rejected with a clear error, dialog stays open", async ({
    page,
  }) => {
    await page.goto("/positions");

    await page.getByRole("button", { name: /add position/i }).click();
    const dialog = page.getByRole("dialog");
    await fillTitleAndCode(dialog, "Duplicate Attempt", rootCode);
    await dialog.getByRole("combobox", { name: /reports to/i }).click();
    await dialog.getByRole("combobox", { name: /reports to/i }).fill(rootTitle);
    await page.getByRole("option", { name: new RegExp(rootTitle) }).click();
    await dialog.getByRole("button", { name: /create position/i }).click();

    await expect(dialog.getByText(/already in use/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});
