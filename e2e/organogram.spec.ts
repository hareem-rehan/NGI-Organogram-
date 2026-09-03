import { test, expect, type Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";
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
 * ("E2E Org VP Eng ..." vs. "Expand E2E Org VP Eng ..."), so an
 * unanchored name regex matches both and trips Playwright's strict mode.
 * Anchoring with `^` disambiguates without touching component markup.
 */
function nodeCard(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
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
  });

  test("Visual View renders the root and its direct children by default, with the third level collapsed", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await expect(page.getByRole("heading", { level: 1, name: "Organogram" })).toBeVisible();

    await expect(nodeCard(page, rootTitle)).toBeVisible();
    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
    await expect(nodeCard(page, vpSalesTitle)).toBeVisible();
    // Level 3 starts collapsed (default: root + first two levels expanded).
    await expect(nodeCard(page, engManagerTitle)).toHaveCount(0);
    await expect(page.getByText(/1 hidden/i)).toBeVisible();

    // Every default-visible position is vacant (no assignment UI exercised here).
    await expect(page.getByText("Vacant").first()).toBeVisible();
  });

  test("expanding a branch reveals the hidden grandchild; collapsing hides it again", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await toggleButton(page, "Expand", vpEngTitle).click();
    await expect(nodeCard(page, engManagerTitle)).toBeVisible();

    await toggleButton(page, "Collapse", vpEngTitle).click();
    await expect(nodeCard(page, engManagerTitle)).toHaveCount(0);
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

    await expect(nodeCard(page, rootTitle)).toBeVisible();
    await expect(nodeCard(page, vpEngTitle)).toBeVisible();
    await expect(nodeCard(page, engManagerTitle)).toHaveCount(0);

    await toggleButton(page, "Expand", vpEngTitle).click();
    await expect(nodeCard(page, engManagerTitle)).toBeVisible();
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
