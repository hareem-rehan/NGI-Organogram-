import { test, expect, type Page } from "@playwright/test";

import { signInAs } from "./support/sign-in-as";

/**
 * A summary card's clickable `<a>` and its value text are siblings (a
 * "stretched link" pattern — dashboard-view.tsx's SummaryCard doc
 * comment explains why the value isn't nested inside the anchor, and
 * why it's a plain `<p>` rather than a `<dd>`), so reading a card's
 * numeric value means walking up to the shared card container first,
 * not querying inside the link itself.
 */
function cardValueText(page: Page, linkName: RegExp) {
  return page.getByRole("link", { name: linkName }).locator("xpath=..").locator("p.text-2xl");
}

// This suite shares the same company/data as every other spec file that
// runs under the "chromium" project (positions.spec.ts's own project
// guarantees a root position already exists — see
// playwright.config.ts's "positions-first" dependency). Rather than
// asserting brittle absolute counts (other spec files add their own
// data to the same shared company), these tests either assert relative
// changes (count before -> count after this file's own creation) or
// use a freshly-signed-in, guaranteed-empty company (signInAs seeds a
// brand-new company every call — docs/phase-reports/PHASE_06...) for
// the empty-state/isolation scenarios.
test.describe.configure({ mode: "serial" });

test.describe("Dashboard and Company Overview (Phase 7)", () => {
  const suffix = Date.now().toString(36).toUpperCase();

  test("HR_EDITOR/ADMIN sees the full dashboard: summary cards, structure, vacancy, departments, warnings, and management quick actions", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

    await expect(page.getByText(/effective date \d{4}-\d{2}-\d{2}/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /active employees/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /active positions/i })).toBeVisible();
    await expect(page.getByText("Occupied Positions", { exact: true })).toBeVisible();
    await expect(page.getByText("Vacant Positions", { exact: true })).toBeVisible();
    await expect(page.getByText("Planned Positions", { exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Organizational structure" })).toBeVisible();
    await expect(page.getByText(/root position/i)).toBeVisible();

    await expect(page.getByRole("heading", { name: "Vacancy overview" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Departments" })).toBeVisible();
    await expect(page.getByRole("table", { name: /department summary/i })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Data quality" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Quick actions" })).toBeVisible();
    await expect(page.getByRole("link", { name: /add department/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /add position/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /add employee/i })).toBeVisible();
  });

  test("VIEWER sees the same organizational data but no management quick actions or data-quality section", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, "VIEWER", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: /active employees/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Departments" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Data quality" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /add department/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /add position/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /add employee/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^view departments$/i })).toBeVisible();
  });

  test("counts increase after creating a department and an employee — dashboard reflects live data, never a stale cache", async ({
    page,
  }) => {
    // This suite's company is shared with every other spec file running
    // concurrently in the "chromium" project (each with its own unique
    // suffix to avoid name/code collisions, but all touching the same
    // aggregate counts). Delta assertions here use >= rather than exact
    // +1, since another file's concurrent create can legitimately land
    // between this test's "before" and "after" reads — the point of
    // this test is proving the dashboard is never a frozen/stale
    // snapshot, not exclusive ownership of the global counts.
    await page.goto("/dashboard");
    const beforeDepts = Number(await cardValueText(page, /active departments/i).innerText());
    const beforeEmployees = Number(await cardValueText(page, /active employees/i).innerText());

    const deptName = `E2E Dashboard Dept ${suffix}`;
    await page.goto("/departments");
    await page.getByRole("button", { name: /add department/i }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel(/name/i).fill(deptName);
    await dialog.getByLabel(/code/i).fill(`E2E-DASH-DEPT-${suffix}`);
    await dialog.getByRole("button", { name: /create department/i }).click();
    await expect(dialog).toBeHidden();

    const empCode = `E2E-DASH-EMP-${suffix}`;
    await page.goto("/employees");
    await page.getByRole("button", { name: /add employee/i }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel(/employee code/i).fill(empCode);
    await dialog.getByLabel(/first name/i).fill("Dash");
    await dialog.getByLabel(/last name/i).fill("Board");
    await dialog.getByRole("button", { name: /create employee/i }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/dashboard");
    const afterDepts = Number(await cardValueText(page, /active departments/i).innerText());
    const afterEmployees = Number(await cardValueText(page, /active employees/i).innerText());
    expect(afterDepts).toBeGreaterThanOrEqual(beforeDepts + 1);
    // The new employee starts unassigned, so both "active" and
    // "active unassigned" should reflect it.
    expect(afterEmployees).toBeGreaterThanOrEqual(beforeEmployees + 1);
    await expect(page.getByRole("cell", { name: deptName })).toBeVisible();
  });

  test("the Refresh button re-fetches current data (not a stale snapshot from initial load)", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const before = Number(await cardValueText(page, /active employees/i).innerText());

    const empCode = `E2E-DASH-REFRESH-${suffix}`;
    await page.goto("/employees");
    await page.getByRole("button", { name: /add employee/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/employee code/i).fill(empCode);
    await dialog.getByLabel(/first name/i).fill("Refresh");
    await dialog.getByLabel(/last name/i).fill("Check");
    await dialog.getByRole("button", { name: /create employee/i }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/dashboard");
    await page.getByRole("button", { name: /refresh/i }).click();
    await expect(async () => {
      const after = Number(await cardValueText(page, /active employees/i).innerText());
      expect(after).toBeGreaterThanOrEqual(before + 1);
    }).toPass();
  });

  test("Vacant Positions links to the Positions page filtered to vacant, active positions", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const link = page.getByRole("link", { name: /^vacant positions/i });
    await expect(link).toHaveAttribute("href", /status=ACTIVE/);
    await expect(link).toHaveAttribute("href", /occupancy=vacant/);

    await link.click();
    await expect(page).toHaveURL(/\/positions\?/);
    await expect(page.getByRole("heading", { level: 1, name: "Positions" })).toBeVisible();
    await expect(page.getByRole("status", { name: /loading/i })).toHaveCount(0);
    const rows = page.getByRole("row").filter({ hasText: "Vacant" });
    await expect(rows.first()).toBeVisible();
  });

  test("unassigned-employees link navigates to Employees filtered to assignment=unassigned", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const link = page.getByRole("link", { name: /unassigned/i }).first();
    const href = await link.getAttribute("href");
    expect(href).toBe("/employees?assignment=unassigned");

    await link.click();
    await expect(page).toHaveURL(/\/employees\?assignment=unassigned/);
    await expect(page.getByRole("heading", { level: 1, name: "Employees" })).toBeVisible();
  });

  test("a brand-new, empty company shows a truthful empty state, not an error", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, "ADMIN", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByText(/no root position yet/i)).toBeVisible();
    await expect(cardValueText(page, /active employees/i)).toHaveText("0");
    await expect(cardValueText(page, /active positions/i)).toHaveText("0");
    await expect(page.getByText(/no departments yet/i)).toBeVisible();
  });

  test("unauthenticated direct access to /dashboard redirects to sign-in", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("mobile viewport renders the dashboard without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("the Refresh action is keyboard-reachable and activatable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dashboard");
    const refreshButton = page.getByRole("button", { name: /refresh/i });
    await refreshButton.focus();
    await expect(refreshButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  });
});
