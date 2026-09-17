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
 * both contain the node's title in their accessible name ("E2E Org VP Eng
 * ... . Grace Org... ." vs. "Expand E2E Org VP Eng ..."), so an unanchored
 * regex matches both and trips Playwright's strict mode. The card leads
 * with the ROLE, so anchoring there picks out the card alone.
 */
function nodeCard(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
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
  const vpEngTitle = `E2E Org VP Eng ${suffix}`;
  const vpSalesTitle = `E2E Org VP Sales ${suffix}`;
  const engManagerTitle = `E2E Org Eng Manager ${suffix}`;
  // Below the leadership threshold — proves the chart leaves it out
  // without anything deleting it.
  const juniorTitle = `E2E Org Junior ${suffix}`;
  // Graded high enough, but nobody in the seat — the other half of the
  // filter.
  // Deliberately does NOT contain the word "Vacant": the assertion below
  // is that the card carries no such label, and a title containing it
  // would make that assertion unfalsifiable.
  const vacantTitle = `E2E Org Unfilled Lead ${suffix}`;

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

    async function createPosition(args: { title: string; department: string; reportsTo?: string }) {
      await page.goto("/positions");
      await page.getByRole("button", { name: /add position/i }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("combobox", { name: "Department" })).not.toHaveValue("");
      await dialog
        .getByRole("combobox", { name: "Department" })
        .selectOption({ label: args.department });
      await dialog.locator('input[name="title"]').fill(args.title);
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

    await createPosition({ title: rootTitle, department: deptAName });
    await createPosition({
      title: vpEngTitle,
      department: deptAName,
      reportsTo: rootTitle,
    });
    await createPosition({
      title: vpSalesTitle,
      department: deptBName,
      reportsTo: rootTitle,
    });
    await createPosition({
      title: engManagerTitle,
      department: deptAName,
      reportsTo: vpEngTitle,
    });
    await createPosition({
      title: juniorTitle,
      department: deptAName,
      reportsTo: engManagerTitle,
    });
    await createPosition({
      title: vacantTitle,
      department: deptBName,
      reportsTo: vpSalesTitle,
    });

    // The chart draws only graded, occupied positions (docs/DECISIONS.md
    // §2b). Grades and assignments are set directly rather than through
    // twelve more dialog interactions — positions.spec.ts and
    // employees.spec.ts already cover those UIs end-to-end, and this file
    // is about the chart.
    await seedJobGradeScale(companyId);
    await gradePositions(companyId, "L18", [rootTitle]);
    await gradePositions(companyId, "L15", [vpEngTitle, vpSalesTitle]);
    await gradePositions(companyId, "L10", [engManagerTitle, vacantTitle]);
    await gradePositions(companyId, "L4", [juniorTitle]);

    for (const [title, name] of [
      [rootTitle, ceoOccupant],
      [vpEngTitle, vpEngOccupant],
      [vpSalesTitle, vpSalesOccupant],
      [engManagerTitle, engManagerOccupant],
      [juniorTitle, juniorOccupant],
    ] as const) {
      await occupyPosition(companyId, title, nameParts(name));
    }
    // vacantTitle deliberately gets no occupant.
  });

  test("Visual View groups by department below the founder and opens at leadership level", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await expect(page.getByRole("heading", { level: 1, name: "Organogram" })).toBeVisible();

    // Founder -> department tier -> that department's leadership. The
    // opening depth is the GRADE threshold, not an arbitrary tier count:
    // every L7-and-above role is on screen however deep it sits.
    await expect(nodeCard(page, rootTitle)).toBeVisible();
    await expect(departmentCard(page, deptAName)).toBeVisible();
    await expect(departmentCard(page, deptBName)).toBeVisible();
    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
    await expect(nodeCard(page, vpSalesTitle)).toBeVisible();
    await expect(nodeCard(page, engManagerTitle)).toBeVisible();

    // Only the junior rung is folded.
    await expect(nodeCard(page, juniorTitle)).toHaveCount(0);
  });

  test("says plainly that junior roles are folded rather than missing", async ({ page }) => {
    await page.goto("/organogram");

    await expect(page.getByText(/Leadership view — opens at L7 and above/)).toBeVisible();
    await expect(page.getByText(/1 more junior role is folded away/)).toBeVisible();

    // And it is genuinely one click away, not gone.
    await expect(nodeCard(page, juniorTitle)).toHaveCount(0);
    await toggleButton(page, "Expand", engManagerTitle).click();
    await expect(nodeCard(page, juniorTitle)).toBeVisible();

    // Still fully present, and still editable, on the Positions page.
    await page.goto("/positions");
    await expect(page.getByText(juniorTitle)).toBeVisible();
  });

  test("shows a role nobody holds, with no name on it rather than a Vacant stamp", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Expand All" }).click();

    const card = nodeCard(page, vacantTitle);
    await expect(card).toBeVisible();
    // The name line is simply absent; only the accessible name says it.
    await expect(card).not.toContainText("Vacant");
    await expect(card).toHaveAttribute("aria-label", new RegExp(`^${vacantTitle}\\. Vacant\\.`));
  });

  test("a department card expands and collapses but never opens the details panel", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await departmentCard(page, deptAName).click();

    await expect(page.getByRole("complementary", { name: "Position details" })).toHaveCount(0);
    await expect(nodeCard(page, vpEngTitle)).toHaveCount(0);

    await departmentCard(page, deptAName).click();
    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
  });

  test("expanding a branch reveals the hidden grandchild; collapsing hides it again", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await toggleButton(page, "Expand", engManagerTitle).click();
    await expect(nodeCard(page, juniorTitle)).toBeVisible();

    await toggleButton(page, "Collapse", engManagerTitle).click();
    await expect(nodeCard(page, juniorTitle)).toHaveCount(0);
  });

  test("Expand All / Collapse All toolbar controls work", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Expand All" }).click();
    await expect(nodeCard(page, engManagerTitle)).toBeVisible();

    await page.getByRole("button", { name: "Collapse All" }).click();
    await expect(nodeCard(page, vpEngTitle)).toHaveCount(0);
    await expect(nodeCard(page, rootTitle)).toBeVisible();
  });

  test("clicking a node opens the read-only details panel with its fields; Escape closes it", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await nodeCard(page, rootTitle).click();

    const panel = page.getByRole("complementary", { name: "Position details" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: rootTitle })).toBeVisible();
    // The position code is auto-generated and no longer shown; the
    // department remains a stable, known thing to assert on.
    await expect(panel.getByText(deptAName, { exact: false })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("Outline View reflects the exact same hierarchy and collapse state as the canvas", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Outline View" }).click();

    await expect(nodeCard(page, rootTitle)).toBeVisible();
    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
    await expect(nodeCard(page, engManagerTitle)).toBeVisible();
    await expect(nodeCard(page, juniorTitle)).toHaveCount(0);

    await toggleButton(page, "Expand", engManagerTitle).click();
    await expect(nodeCard(page, juniorTitle)).toBeVisible();
  });

  test("Fit to View and Reset View controls do not error and keep the canvas usable", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Fit to View" }).click();
    await page.getByRole("button", { name: "Reset View" }).click();
    await expect(nodeCard(page, rootTitle)).toBeVisible();
  });

  test("keyboard navigation: Tab reaches a node and Enter opens its details panel", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await nodeCard(page, rootTitle).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: "Position details" })).toBeVisible();
  });

  test("mobile viewport: Outline View is usable with no page-level horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Outline View" }).click();
    await expect(nodeCard(page, rootTitle)).toBeVisible();
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
