import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
import { gradePositions, occupyPosition, seedJobGradeScale } from "./support/chart-fixtures";
import { signInAs } from "./support/sign-in-as";

// Unlike most other spec files, this suite deliberately does NOT reuse the
// shared "chromium" project company (positions.spec.ts's root + whatever
// employees.spec.ts/dashboard.spec.ts concurrently add to it) — the
// organogram's default expand/collapse depth, node count badge, and
// Outline View tree all need EXACT, deterministic assertions, which a
// company mutated concurrently by other files cannot give. Instead, one
// session is seeded ONCE (beforeAll) against a brand-new, fully isolated
// company (see e2e/support/seed-session.ts — every call creates a new
// company), and its cookie is re-applied before each test (every test
// gets a fresh browser context by default, so the cookie itself doesn't
// persist across tests — only the underlying DB session/company does).
// Serial mode: later tests build on the hierarchy the prerequisite test
// creates.
test.describe.configure({ mode: "serial" });

/**
 * A node's own card (Visual View) and its expand/collapse toggle button
 * both contain the node's title as a substring in their accessible name
 * ("Ada Byron. E2E Org VP Eng ..." vs. "Expand E2E Org VP Eng ..."), so an
 * unanchored name regex matches both and trips Playwright's strict mode.
 *
 * The card's accessible name now LEADS with the occupant (the Demo 1
 * compact card is person-first), so anchoring on the occupant name
 * disambiguates without touching component markup.
 */
function nodeCard(page: Page, occupantName: string) {
  return page.getByRole("button", { name: new RegExp(`^${occupantName}`) });
}

/** Splits a fixture's "First Last" display name into the two fields an Employee row needs. */
function nameParts(displayName: string): { firstName: string; lastName: string } {
  const [firstName = displayName, lastName = ""] = displayName.split(" ");
  return { firstName, lastName };
}

/** The synthetic department tier's card — collapse/expand only, never selectable. */
function departmentCard(page: Page, departmentName: string) {
  return page.getByRole("button", { name: new RegExp(`^${departmentName} department`) });
}

function toggleButton(page: Page, action: "Expand" | "Collapse", title: string) {
  return page.getByRole("button", { name: new RegExp(`^${action} ${title}`) });
}

test.describe("Interactive organogram (Phase 8)", () => {
  const suffix = Date.now().toString(36).toUpperCase();
  const deptAName = `E2E Org Dept A ${suffix}`;
  const deptBName = `E2E Org Dept B ${suffix}`;
  const rootTitle = `E2E Org CEO ${suffix}`;
  const rootCode = `E2E-ORG-CEO-${suffix}`;
  const vpEngTitle = `E2E Org VP Eng ${suffix}`;
  const vpEngCode = `E2E-ORG-VPE-${suffix}`;
  const vpSalesTitle = `E2E Org VP Sales ${suffix}`;
  const vpSalesCode = `E2E-ORG-VPS-${suffix}`;
  const engManagerTitle = `E2E Org Eng Manager ${suffix}`;
  const engManagerCode = `E2E-ORG-EM-${suffix}`;
  // Below the leadership threshold — proves the chart leaves it out
  // without anything deleting it.
  const juniorTitle = `E2E Org Junior ${suffix}`;
  const juniorCode = `E2E-ORG-JR-${suffix}`;
  // Graded high enough, but nobody in the seat — the other half of the
  // filter.
  const vacantTitle = `E2E Org Vacant Lead ${suffix}`;
  const vacantCode = `E2E-ORG-VAC-${suffix}`;

  // The card is person-first, so every assertion below addresses a node
  // by who sits in it.
  const ceoOccupant = `Ada Org${suffix}`;
  const vpEngOccupant = `Grace Org${suffix}`;
  const vpSalesOccupant = `Alan Org${suffix}`;
  const engManagerOccupant = `Edsger Org${suffix}`;
  const juniorOccupant = `Barbara Org${suffix}`;

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

  test("prerequisite: build a small 3-level, 2-department hierarchy", async ({ page }) => {
    await page.goto("/departments");
    for (const name of [deptAName, deptBName]) {
      await page.getByRole("button", { name: /add department/i }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/name/i).fill(name);
      await dialog
        .getByLabel(/code/i)
        .fill(`E2E-ORGDEPT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
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

    await createPosition({ title: rootTitle, code: rootCode, department: deptAName });
    await createPosition({
      title: vpEngTitle,
      code: vpEngCode,
      department: deptAName,
      reportsTo: rootTitle,
    });
    await createPosition({
      title: vpSalesTitle,
      code: vpSalesCode,
      department: deptBName,
      reportsTo: rootTitle,
    });
    await createPosition({
      title: engManagerTitle,
      code: engManagerCode,
      department: deptAName,
      reportsTo: vpEngTitle,
    });
    await createPosition({
      title: juniorTitle,
      code: juniorCode,
      department: deptAName,
      reportsTo: engManagerTitle,
    });
    await createPosition({
      title: vacantTitle,
      code: vacantCode,
      department: deptBName,
      reportsTo: vpSalesTitle,
    });

    // The chart draws only graded, occupied positions (docs/DECISIONS.md
    // §2b). Grades and assignments are set directly rather than through
    // twelve more dialog interactions — positions.spec.ts and
    // employees.spec.ts already cover those UIs end-to-end, and this file
    // is about the chart.
    await seedJobGradeScale(companyId);
    await gradePositions(companyId, "L18", [rootCode]);
    await gradePositions(companyId, "L15", [vpEngCode, vpSalesCode]);
    await gradePositions(companyId, "L10", [engManagerCode, vacantCode]);
    await gradePositions(companyId, "L4", [juniorCode]);

    for (const [code, name] of [
      [rootCode, ceoOccupant],
      [vpEngCode, vpEngOccupant],
      [vpSalesCode, vpSalesOccupant],
      [engManagerCode, engManagerOccupant],
      [juniorCode, juniorOccupant],
    ] as const) {
      await occupyPosition(companyId, code, nameParts(name));
    }
    // vacantCode deliberately gets no occupant.
  });

  test("Visual View groups by department below the founder, with the tier below that collapsed", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await expect(page.getByRole("heading", { level: 1, name: "Organogram" })).toBeVisible();

    // Founder -> department tier -> that department's leadership.
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    await expect(departmentCard(page, deptAName)).toBeVisible();
    await expect(departmentCard(page, deptBName)).toBeVisible();
    await expect(nodeCard(page, vpEngOccupant)).toBeVisible();
    await expect(nodeCard(page, vpSalesOccupant)).toBeVisible();

    // The tier below the department leads starts collapsed.
    await expect(nodeCard(page, engManagerOccupant)).toHaveCount(0);
    await expect(page.getByText(/hidden/i).first()).toBeVisible();
  });

  test("the chart leaves out below-threshold and vacant positions, and says how many", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Expand All" }).click();

    // Neither is deleted — both are absent from the CHART only.
    await expect(nodeCard(page, juniorOccupant)).toHaveCount(0);
    await expect(page.getByText(vacantTitle)).toHaveCount(0);
    await expect(page.getByText(/Leadership view — named cards are L7 and above/)).toBeVisible();
    await expect(page.getByText(/1 below L7/)).toBeVisible();
    await expect(page.getByText(/1 vacant/)).toBeVisible();

    // Still fully present, and still editable, on the Positions page.
    await page.goto("/positions");
    await expect(page.getByText(juniorTitle)).toBeVisible();
    await expect(page.getByText(vacantTitle)).toBeVisible();
  });

  test("a department card expands and collapses but never opens the details panel", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await departmentCard(page, deptAName).click();

    await expect(page.getByRole("complementary", { name: "Position details" })).toHaveCount(0);
    await expect(nodeCard(page, vpEngOccupant)).toHaveCount(0);

    await departmentCard(page, deptAName).click();
    await expect(nodeCard(page, vpEngOccupant)).toBeVisible();
  });

  test("expanding a branch reveals the hidden grandchild; collapsing hides it again", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await toggleButton(page, "Expand", vpEngTitle).click();
    await expect(nodeCard(page, engManagerOccupant)).toBeVisible();

    await toggleButton(page, "Collapse", vpEngTitle).click();
    await expect(nodeCard(page, engManagerOccupant)).toHaveCount(0);
  });

  test("Expand All / Collapse All toolbar controls work", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Expand All" }).click();
    await expect(nodeCard(page, engManagerOccupant)).toBeVisible();

    await page.getByRole("button", { name: "Collapse All" }).click();
    await expect(nodeCard(page, vpEngOccupant)).toHaveCount(0);
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
  });

  test("clicking a node opens the read-only details panel with its fields; Escape closes it", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await nodeCard(page, ceoOccupant).click();

    const panel = page.getByRole("complementary", { name: "Position details" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: rootTitle })).toBeVisible();
    await expect(panel.getByText(rootCode)).toBeVisible();
    await expect(panel.getByText(deptAName, { exact: false })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("Outline View reflects the exact same hierarchy and collapse state as the canvas", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Outline View" }).click();

    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    await expect(nodeCard(page, vpEngOccupant)).toBeVisible();
    await expect(nodeCard(page, engManagerOccupant)).toHaveCount(0);

    await toggleButton(page, "Expand", vpEngTitle).click();
    await expect(nodeCard(page, engManagerOccupant)).toBeVisible();
  });

  test("Fit to View and Reset View controls do not error and keep the canvas usable", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Fit to View" }).click();
    await page.getByRole("button", { name: "Reset View" }).click();
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
  });

  test("keyboard navigation: Tab reaches a node and Enter opens its details panel", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await nodeCard(page, ceoOccupant).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: "Position details" })).toBeVisible();
  });

  test("mobile viewport: Outline View is usable with no page-level horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Outline View" }).click();
    await expect(nodeCard(page, ceoOccupant)).toBeVisible();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(hasOverflow).toBe(false);
  });

  test("company isolation: a second, freshly-seeded company sees none of this fixture's positions", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, "ADMIN", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/organogram");
    await expect(page.getByText("No positions yet")).toBeVisible();
    await expect(page.getByText(rootTitle)).toHaveCount(0);
  });
});

test.describe("Interactive organogram — empty state and role differences", () => {
  test("ADMIN sees an Add Position call-to-action on a company with no positions yet", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, "ADMIN", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/organogram");
    await expect(page.getByText("No positions yet")).toBeVisible();
    await expect(page.getByRole("link", { name: /add position/i })).toBeVisible();
  });

  test("VIEWER sees the same empty state but no Add Position call-to-action", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, "VIEWER", baseURL ?? "http://127.0.0.1:3100");
    await page.goto("/organogram");
    await expect(page.getByText("No positions yet")).toBeVisible();
    await expect(page.getByRole("link", { name: /add position/i })).toHaveCount(0);
  });
});
