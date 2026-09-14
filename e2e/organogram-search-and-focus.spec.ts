import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import { gradePositions, occupyPosition, seedJobGradeScale } from "./support/chart-fixtures";
import { signInAs } from "./support/sign-in-as";

// Same isolated-company pattern as e2e/organogram.spec.ts (Phase 8) — one
// session seeded ONCE (beforeAll) against a brand-new company, re-applied
// per test since each test gets a fresh browser context by default.
// Deterministic assertions (exact node sets, exact URL params) need a
// company no other spec file mutates concurrently.
test.describe.configure({ mode: "serial" });

/**
 * The compact card is person-first since the Demo 1 feedback, so its
 * accessible name starts with the occupant, not the title — anchoring on
 * the occupant keeps each query unambiguous against the node's own
 * expand/collapse button ("Expand <title> ...").
 */
function nodeCard(page: Page, occupantName: string) {
  return page.getByRole("button", { name: new RegExp(`^${occupantName}`) });
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
  // Graded as leadership but never filled — the chart leaves it out.
  const vacantTitle = `E2E Search Vacant Lead ${suffix}`;
  const vacantCode = `E2E-SEARCH-VAC-${suffix}`;
  const employeeFirstName = "Nadia";
  const employeeLastName = `Volkov${suffix}`;
  const employeeCode = `E2E-SEARCH-EMP-${suffix}`;

  // Every chart node is addressed by its occupant.
  const vpEngOccupant = `${employeeFirstName} ${employeeLastName}`;
  const ceoOccupant = `Rosalind Search${suffix}`;
  const vpSalesOccupant = `Katherine Search${suffix}`;
  const engManagerOccupant = `Dorothy Search${suffix}`;
  const engineerOccupant = `Mary Search${suffix}`;

  let adminCookieValue: string;
  let companyId: string;

  test.beforeAll(async () => {
    ({ cookieValue: adminCookieValue, companyId } = await seedAuthenticatedSession("ADMIN"));
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
    await createPosition({
      title: vacantTitle,
      code: vacantCode,
      department: deptSalesName,
      reportsTo: vpSalesTitle,
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

    // The chart draws only graded, occupied positions (docs/DECISIONS.md
    // §2b), so the rest of the hierarchy is graded and filled directly —
    // the assignment UI itself is exercised above and in
    // employees.spec.ts; these tests are about search, filters and focus.
    await seedJobGradeScale(companyId);
    await gradePositions(companyId, "L18", [ceoCode]);
    await gradePositions(companyId, "L15", [vpEngCode, vpSalesCode]);
    await gradePositions(companyId, "L10", [engManagerCode]);
    await gradePositions(companyId, "L7", [engineerCode]);
    await gradePositions(companyId, "L10", [vacantCode]);

    for (const [code, name] of [
      [ceoCode, ceoOccupant],
      [vpSalesCode, vpSalesOccupant],
      [engManagerCode, engManagerOccupant],
      [engineerCode, engineerOccupant],
    ] as const) {
      const [firstName = name, lastName = ""] = name.split(" ");
      await occupyPosition(companyId, code, { firstName, lastName });
    }
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
    await expect(nodeCard(page, vpEngOccupant)).toBeVisible();
    // Ancestor context (CEO) is present even though it's not itself a search match.
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
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

  // Reversed on 2026-09-14 (Demo 1 stakeholder feedback). This used to
  // assert that a vacant position was searchable and selectable FROM THE
  // CHART. Vacant positions are no longer drawn on the chart at all, so
  // the chart's own search — which searches what the chart shows — cannot
  // offer one. Nothing was deleted: the position is still listed,
  // searchable and editable on /positions, which is what this now proves.
  test("a vacant position is absent from the chart and its search, but still on Positions", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("combobox", { name: /search the organization chart/i }).fill(vacantTitle);
    await expect(page.getByRole("option", { name: new RegExp(vacantTitle) })).toHaveCount(0);

    await page.goto("/positions");
    await expect(page.getByText(vacantTitle)).toBeVisible();
  });

  test("selecting a deep result auto-expands its full ancestor path", async ({ page }) => {
    await page.goto("/organogram");
    await page
      .getByRole("combobox", { name: /search the organization chart/i })
      .fill(engineerTitle);
    await page.getByRole("option", { name: new RegExp(engineerTitle) }).click();

    // Position Focus for a leaf shows its entire ancestor chain (CEO -> VP
    // Eng -> Eng Manager -> Engineer), never just the leaf in isolation.
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    await expect(nodeCard(page, vpEngOccupant)).toBeVisible();
    await expect(nodeCard(page, engManagerOccupant)).toBeVisible();
    await expect(nodeCard(page, engineerOccupant)).toBeVisible();
  });

  test("filter by department narrows the visible graph to matches plus real ancestor context", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: deptSalesName }).check();
    // The filter drawer is a modal Sheet — Radix marks the rest of the
    // page aria-hidden while it's open, so background role-based
    // queries are unreliable until it closes.
    await page.keyboard.press("Escape");

    await expect(nodeCard(page, vpSalesOccupant)).toBeVisible();
    // CEO is real ancestor context, not a Sales-department match, but must
    // still render to preserve the true reporting path.
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    // Engineering-only positions are excluded entirely — never falsely
    // reattributed to Sales.
    await expect(nodeCard(page, vpEngOccupant)).toHaveCount(0);
  });

  test("filter by organizational level", async ({ page }) => {
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: "Level 1" }).check();
    await page.keyboard.press("Escape");

    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    await expect(nodeCard(page, vpEngOccupant)).toHaveCount(0);
  });

  // Reversed on 2026-09-14 (Demo 1 stakeholder feedback). The Occupied
  // filter used to be what removed vacant cards; the chart now excludes
  // them before any filter runs. So Occupied is a no-op here and Vacant
  // matches nothing — which is exactly what this asserts, rather than
  // pretending the old distinction still exists.
  test("filter by occupancy — the chart is already occupied-only", async ({ page }) => {
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("radio", { name: "Occupied" }).check();
    await page.keyboard.press("Escape");

    await expect(nodeCard(page, vpEngOccupant)).toBeVisible();
    await expect(nodeCard(page, vpSalesOccupant)).toBeVisible();

    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("radio", { name: "Vacant" }).check();
    await page.keyboard.press("Escape");
    await expect(page.getByText("No matching positions")).toBeVisible();
  });

  test("combined filters narrow further than either alone", async ({ page }) => {
    // Sales alone matches VP Sales; Level 1 alone matches the CEO (who is
    // in Engineering). Together they match nobody — the clearest possible
    // demonstration that the two filters intersect rather than union.
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: deptSalesName }).check();
    await page.keyboard.press("Escape");
    await expect(nodeCard(page, vpSalesOccupant)).toBeVisible();

    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: "Level 1" }).check();
    await page.keyboard.press("Escape");
    await expect(page.getByText("No matching positions")).toBeVisible();
  });

  test("Clear All Filters restores the full structure", async ({ page }) => {
    await page.goto("/organogram");
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: deptSalesName }).check();
    await page.keyboard.press("Escape");
    await expect(nodeCard(page, vpEngOccupant)).toHaveCount(0);

    await page.getByRole("button", { name: /^filters/i }).click();

    await page.getByRole("button", { name: /clear all filters/i }).click();
    await page.keyboard.press("Escape");
    await expect(nodeCard(page, vpEngOccupant)).toBeVisible();
  });

  test("Position Focus via the details panel, then change descendant depth", async ({ page }) => {
    await page.goto("/organogram");
    await nodeCard(page, vpEngOccupant).click();
    await page.getByRole("button", { name: /focus on this position/i }).click();

    // VP Eng -> Eng Manager -> Engineer is exactly 2 levels, so the
    // default depth (Two Levels) already shows the whole subtree.
    await expect(page).toHaveURL(/view=position/);
    await expect(nodeCard(page, engManagerOccupant)).toBeVisible();
    await expect(nodeCard(page, engineerOccupant)).toBeVisible();

    // Direct Reports Only (depth 1) hides the grandchild.
    await page.getByRole("combobox", { name: /descendant depth/i }).selectOption("1");
    await expect(nodeCard(page, engManagerOccupant)).toBeVisible();
    await expect(nodeCard(page, engineerOccupant)).toHaveCount(0);

    // All Descendants brings it back.
    await page.getByRole("combobox", { name: /descendant depth/i }).selectOption("all");
    await expect(nodeCard(page, engineerOccupant)).toBeVisible();
  });

  test("Department Focus via the details panel shows cross-department context correctly", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await nodeCard(page, vpSalesOccupant).click();
    await page.getByRole("button", { name: /focus on this department/i }).click();

    await expect(page).toHaveURL(/view=department/);
    await expect(page.getByText("Department Focus")).toBeVisible();
    await expect(nodeCard(page, vpSalesOccupant)).toBeVisible();
    // CEO (a different department) is pulled in as real ancestor context.
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
  });

  test("Return to Full Company View", async ({ page }) => {
    await page.goto("/organogram");
    await nodeCard(page, vpEngOccupant).click();
    await page.getByRole("button", { name: /focus on this position/i }).click();
    await expect(page).toHaveURL(/view=position/);

    await page.getByRole("button", { name: /full company view/i }).click();
    await expect(page).not.toHaveURL(/view=position/);
    await expect(nodeCard(page, vpSalesOccupant)).toBeVisible();
  });

  test("Copy View Link copies a URL that reopens the identical authorized view", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/organogram");
    await nodeCard(page, vpEngOccupant).click();
    await page.getByRole("button", { name: /focus on this position/i }).click();

    await page.getByRole("button", { name: /copy view link/i }).click();
    await expect(page.getByText("Copied!")).toBeVisible();

    const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedUrl).toContain("view=position");
    expect(copiedUrl).not.toContain(employeeFirstName);
    expect(copiedUrl).not.toContain("@");

    await page.goto(copiedUrl.replace(baseURL ?? "http://127.0.0.1:3100", ""));
    await expect(nodeCard(page, vpEngOccupant)).toBeVisible();
  });

  test("browser Back and Forward restore filter/focus state", async ({ page }) => {
    await page.goto("/organogram");
    await nodeCard(page, vpEngOccupant).click();
    await page.getByRole("button", { name: /focus on this position/i }).click();
    await expect(page).toHaveURL(/view=position/);

    await page.goBack();
    await expect(page).not.toHaveURL(/view=position/);

    await page.goForward();
    await expect(page).toHaveURL(/view=position/);
    await expect(nodeCard(page, vpEngOccupant)).toBeVisible();
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
    await nodeCard(page, vpEngOccupant).click();
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
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await expect(page.getByRole("checkbox", { name: deptSalesName })).toBeVisible();
    await page.getByRole("checkbox", { name: deptSalesName }).check();
    await page.keyboard.press("Escape");
    await expect(nodeCard(page, vpSalesOccupant)).toBeVisible();
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
    await expect(nodeCard(page, vpSalesOccupant)).toBeVisible();
  });
});
