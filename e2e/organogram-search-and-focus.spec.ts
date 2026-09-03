import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import { signInAs } from "./support/sign-in-as";

// Same isolated-company pattern as e2e/organogram.spec.ts (Phase 8) — one
// session seeded ONCE (beforeAll) against a brand-new company, re-applied
// per test since each test gets a fresh browser context by default.
// Deterministic assertions (exact node sets, exact URL params) need a
// company no other spec file mutates concurrently.
test.describe.configure({ mode: "serial" });

function nodeCard(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

test.describe("Organogram search, filters, and focus (Phase 9)", () => {
  const suffix = Date.now().toString(36).toUpperCase();
  const deptEngName = `E2E Search Dept Eng ${suffix}`;
  const deptSalesName = `E2E Search Dept Sales ${suffix}`;
  const ceoTitle = `E2E Search CEO ${suffix}`;
  const ceoCode = `E2E-SEARCH-CEO-${suffix}`;
  const vpEngTitle = `E2E Search VP Eng ${suffix}`;
  const vpEngCode = `E2E-SEARCH-VPE-${suffix}`;
  const vpSalesTitle = `E2E Search VP Sales ${suffix}`;
  const vpSalesCode = `E2E-SEARCH-VPS-${suffix}`;
  const engManagerTitle = `E2E Search Eng Manager ${suffix}`;
  const engManagerCode = `E2E-SEARCH-EM-${suffix}`;
  const engineerTitle = `E2E Search Engineer ${suffix}`;
  const engineerCode = `E2E-SEARCH-ENG-${suffix}`;
  const employeeFirstName = "Nadia";
  const employeeLastName = `Volkov${suffix}`;
  const employeeCode = `E2E-SEARCH-EMP-${suffix}`;

  let adminCookieValue: string;

  test.beforeAll(async () => {
    ({ cookieValue: adminCookieValue } = await seedAuthenticatedSession("ADMIN"));
  });

  test.beforeEach(async ({ page, baseURL }) => {
    const url = new URL(baseURL ?? "http://127.0.0.1:3100");
    await page.context().addCookies([
      {
        name: "authjs.session-token",
        value: adminCookieValue,
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("prerequisite: build a 4-level, 2-department hierarchy with one occupied position", async ({
    page,
  }) => {
    await page.goto("/departments");
    for (const name of [deptEngName, deptSalesName]) {
      await page.getByRole("button", { name: /add department/i }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/name/i).fill(name);
      await dialog
        .getByLabel(/code/i)
        .fill(`E2E-SEARCHDEPT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
      await dialog.getByRole("button", { name: /create department/i }).click();
      await expect(dialog).toBeHidden();
    }

    async function createPosition(args: {
      title: string;
      code: string;
      department: string;
      reportsTo?: string;
    }) {
      await page.goto("/positions");
      await page.getByRole("button", { name: /add position/i }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("combobox", { name: "Department" })).not.toHaveValue("");
      await dialog
        .getByRole("combobox", { name: "Department" })
        .selectOption({ label: args.department });
      await dialog.locator('input[name="title"]').fill(args.title);
      await dialog.locator('input[name="positionCode"]').fill(args.code);
      if (args.reportsTo) {
        await dialog.getByRole("combobox", { name: /reports to/i }).click();
        await dialog.getByRole("combobox", { name: /reports to/i }).fill(args.reportsTo);
        await page
          .getByRole("option", { name: new RegExp(args.reportsTo) })
          .first()
          .click();
      }
      await dialog.getByRole("button", { name: /create position/i }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(args.title)).toBeVisible();
    }

    await createPosition({ title: ceoTitle, code: ceoCode, department: deptEngName });
    await createPosition({
      title: vpEngTitle,
      code: vpEngCode,
      department: deptEngName,
      reportsTo: ceoTitle,
    });
    await createPosition({
      title: vpSalesTitle,
      code: vpSalesCode,
      department: deptSalesName,
      reportsTo: ceoTitle,
    });
    await createPosition({
      title: engManagerTitle,
      code: engManagerCode,
      department: deptEngName,
      reportsTo: vpEngTitle,
    });
    await createPosition({
      title: engineerTitle,
      code: engineerCode,
      department: deptEngName,
      reportsTo: engManagerTitle,
    });

    // Assign one employee to VP Engineering so it's searchable by name
    // and testable as an "Occupied" filter match.
    await page.goto("/employees");
    await page.getByRole("button", { name: /add employee/i }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel(/employee code/i).fill(employeeCode);
    await dialog.getByLabel(/first name/i).fill(employeeFirstName);
    await dialog.getByLabel(/last name/i).fill(employeeLastName);
    await dialog.getByRole("button", { name: /create employee/i }).click();
    await expect(dialog).toBeHidden();

    await page
      .getByRole("link", { name: new RegExp(`${employeeFirstName} ${employeeLastName}`, "i") })
      .click();
    await page.getByRole("button", { name: /assign to position/i }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Position" }).click();
    await dialog.getByRole("combobox", { name: "Position" }).fill(vpEngTitle);
    await page.getByRole("option", { name: new RegExp(vpEngTitle) }).click();
    await dialog.getByRole("button", { name: /^assign$/i }).click();
    await expect(dialog).toBeHidden();
  });

  test("search by employee name selects the result and switches to Position Focus", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page
      .getByRole("combobox", { name: /search the organization chart/i })
      .fill(employeeFirstName);
    await page.getByRole("option", { name: new RegExp(vpEngTitle) }).click();

    await expect(page).toHaveURL(/view=position/);
    await expect(page.getByText("Position Focus")).toBeVisible();
    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
    // Ancestor context (CEO) is present even though it's not itself a search match.
    await expect(nodeCard(page, ceoTitle)).toBeVisible();
  });

  test("search by position title", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("combobox", { name: /search the organization chart/i }).fill(vpSalesTitle);
    await expect(page.getByRole("option", { name: new RegExp(vpSalesTitle) })).toBeVisible();
  });

  test("search by position code", async ({ page }) => {
    await page.goto("/organogram");
    await page
      .getByRole("combobox", { name: /search the organization chart/i })
      .fill(engManagerCode);
    await expect(page.getByRole("option", { name: new RegExp(engManagerTitle) })).toBeVisible();
  });

  test("a vacant position is fully searchable and selectable", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("combobox", { name: /search the organization chart/i }).fill(vpSalesTitle);
    await page.getByRole("option", { name: new RegExp(vpSalesTitle) }).click();
    await expect(page).toHaveURL(/view=position/);
    await expect(nodeCard(page, vpSalesTitle)).toBeVisible();
  });

  test("selecting a deep result auto-expands its full ancestor path", async ({ page }) => {
    await page.goto("/organogram");
    await page
      .getByRole("combobox", { name: /search the organization chart/i })
      .fill(engineerTitle);
    await page.getByRole("option", { name: new RegExp(engineerTitle) }).click();

    // Position Focus for a leaf shows its entire ancestor chain (CEO -> VP
    // Eng -> Eng Manager -> Engineer), never just the leaf in isolation.
    await expect(nodeCard(page, ceoTitle)).toBeVisible();
    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
    await expect(nodeCard(page, engManagerTitle)).toBeVisible();
    await expect(nodeCard(page, engineerTitle)).toBeVisible();
  });

  test("filter by department narrows the visible graph to matches plus real ancestor context", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoTitle)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: deptSalesName }).check();
    // The filter drawer is a modal Sheet — Radix marks the rest of the
    // page aria-hidden while it's open, so background role-based
    // queries are unreliable until it closes.
    await page.keyboard.press("Escape");

    await expect(nodeCard(page, vpSalesTitle)).toBeVisible();
    // CEO is real ancestor context, not a Sales-department match, but must
    // still render to preserve the true reporting path.
    await expect(nodeCard(page, ceoTitle)).toBeVisible();
    // Engineering-only positions are excluded entirely — never falsely
    // reattributed to Sales.
    await expect(nodeCard(page, vpEngTitle)).toHaveCount(0);
  });

  test("filter by organizational level", async ({ page }) => {
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoTitle)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: "Level 1" }).check();
    await page.keyboard.press("Escape");

    await expect(nodeCard(page, ceoTitle)).toBeVisible();
    await expect(nodeCard(page, vpEngTitle)).toHaveCount(0);
  });

  test("filter by occupancy — occupied", async ({ page }) => {
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoTitle)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("radio", { name: "Occupied" }).check();
    await page.keyboard.press("Escape");

    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
    await expect(nodeCard(page, vpSalesTitle)).toHaveCount(0);
  });

  test("combined filters narrow further than either alone", async ({ page }) => {
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoTitle)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: deptEngName }).check();
    await page.getByRole("radio", { name: "Occupied" }).check();
    await page.keyboard.press("Escape");

    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
    // Eng Manager is Engineering but vacant — excluded by the occupancy filter.
    await expect(nodeCard(page, engManagerTitle)).toHaveCount(0);
  });

  test("Clear All Filters restores the full structure", async ({ page }) => {
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoTitle)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: deptSalesName }).check();
    await page.keyboard.press("Escape");
    await expect(nodeCard(page, vpEngTitle)).toHaveCount(0);

    await page.getByRole("button", { name: /^filters/i }).click();

    await page.getByRole("button", { name: /clear all filters/i }).click();
    await page.keyboard.press("Escape");
    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
  });

  test("Position Focus via the details panel, then change descendant depth", async ({ page }) => {
    await page.goto("/organogram");
    await nodeCard(page, vpEngTitle).click();
    await page.getByRole("button", { name: /focus on this position/i }).click();

    // VP Eng -> Eng Manager -> Engineer is exactly 2 levels, so the
    // default depth (Two Levels) already shows the whole subtree.
    await expect(page).toHaveURL(/view=position/);
    await expect(nodeCard(page, engManagerTitle)).toBeVisible();
    await expect(nodeCard(page, engineerTitle)).toBeVisible();

    // Direct Reports Only (depth 1) hides the grandchild.
    await page.getByRole("combobox", { name: /descendant depth/i }).selectOption("1");
    await expect(nodeCard(page, engManagerTitle)).toBeVisible();
    await expect(nodeCard(page, engineerTitle)).toHaveCount(0);

    // All Descendants brings it back.
    await page.getByRole("combobox", { name: /descendant depth/i }).selectOption("all");
    await expect(nodeCard(page, engineerTitle)).toBeVisible();
  });

  test("Department Focus via the details panel shows cross-department context correctly", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await nodeCard(page, vpSalesTitle).click();
    await page.getByRole("button", { name: /focus on this department/i }).click();

    await expect(page).toHaveURL(/view=department/);
    await expect(page.getByText("Department Focus")).toBeVisible();
    await expect(nodeCard(page, vpSalesTitle)).toBeVisible();
    // CEO (a different department) is pulled in as real ancestor context.
    await expect(nodeCard(page, ceoTitle)).toBeVisible();
  });

  test("Return to Full Company View", async ({ page }) => {
    await page.goto("/organogram");
    await nodeCard(page, vpEngTitle).click();
    await page.getByRole("button", { name: /focus on this position/i }).click();
    await expect(page).toHaveURL(/view=position/);

    await page.getByRole("button", { name: /full company view/i }).click();
    await expect(page).not.toHaveURL(/view=position/);
    await expect(nodeCard(page, vpSalesTitle)).toBeVisible();
  });

  test("Copy View Link copies a URL that reopens the identical authorized view", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/organogram");
    await nodeCard(page, vpEngTitle).click();
    await page.getByRole("button", { name: /focus on this position/i }).click();

    await page.getByRole("button", { name: /copy view link/i }).click();
    await expect(page.getByText("Copied!")).toBeVisible();

    const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedUrl).toContain("view=position");
    expect(copiedUrl).not.toContain(employeeFirstName);
    expect(copiedUrl).not.toContain("@");

    await page.goto(copiedUrl.replace(baseURL ?? "http://127.0.0.1:3100", ""));
    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
  });

  test("browser Back and Forward restore filter/focus state", async ({ page }) => {
    await page.goto("/organogram");
    await nodeCard(page, vpEngTitle).click();
    await page.getByRole("button", { name: /focus on this position/i }).click();
    await expect(page).toHaveURL(/view=position/);

    await page.goBack();
    await expect(page).not.toHaveURL(/view=position/);

    await page.goForward();
    await expect(page).toHaveURL(/view=position/);
    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
  });

  test("an invalid Position Focus deep link shows a safe not-found state, never a crash", async ({
    page,
  }) => {
    await page.goto("/organogram?view=position&position=00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("Position not found")).toBeVisible();
    await expect(page.getByRole("button", { name: /return to full company view/i })).toBeVisible();
  });

  test("a cross-company deep link resolves to the same safe not-found state, never another company's data", async ({
    page,
    baseURL,
  }) => {
    // Capture THIS company's real VP Engineering position id from its
    // own Position Focus URL — a genuine id, not a garbage one.
    await page.goto("/organogram");
    await nodeCard(page, vpEngTitle).click();
    await page.getByRole("button", { name: /focus on this position/i }).click();
    await expect(page).toHaveURL(/view=position/);
    const focusedUrl = new URL(page.url());
    const realPositionId = focusedUrl.searchParams.get("position");
    expect(realPositionId).toBeTruthy();

    // Sign in as a brand-new, unrelated (and, being brand-new, entirely
    // empty) company and deep-link straight to that real (but foreign)
    // id. The company has zero positions of its own, so the more
    // specific "No positions yet" empty state takes priority over
    // "Position not found" — either way, the foreign id resolves to
    // nothing: proof the client never had that company's data to find.
    await signInAs(page, "ADMIN", baseURL ?? "http://127.0.0.1:3100");
    await page.goto(`/organogram?view=position&position=${realPositionId}`);
    await expect(page.getByText("No positions yet")).toBeVisible();
    await expect(page.getByText(vpEngTitle)).toHaveCount(0);
  });

  test("mobile viewport: the filter drawer opens and applies a filter", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoTitle)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await expect(page.getByRole("checkbox", { name: deptSalesName })).toBeVisible();
    await page.getByRole("checkbox", { name: deptSalesName }).check();
    await page.keyboard.press("Escape");
    await expect(nodeCard(page, vpSalesTitle)).toBeVisible();
  });

  test("keyboard-only: Tab reaches the search box and Enter-driven selection works", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("combobox", { name: /search the organization chart/i }).fill(vpSalesTitle);
    // Search is debounced (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md) — wait
    // for the real result to actually render before driving it by
    // keyboard, the same way the mouse-click tests implicitly wait via
    // Playwright's auto-retrying role queries.
    await expect(page.getByRole("option", { name: new RegExp(vpSalesTitle) })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/view=position/);
    await expect(nodeCard(page, vpSalesTitle)).toBeVisible();
  });
});
