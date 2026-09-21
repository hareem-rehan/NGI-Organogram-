import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Accessibility smoke checks", () => {
  test("dashboard has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("the page has a meaningful, non-generic title", async ({ page }) => {
    await page.goto("/dashboard");
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title.toLowerCase()).not.toBe("document");
  });

  test("departments list has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/departments");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("the department create dialog has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/departments");
    await page.getByRole("button", { name: /add department/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .include('[role="dialog"]')
      .analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("positions list has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/positions");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("the position create dialog has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/positions");
    await page.getByRole("button", { name: /add position/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .include('[role="dialog"]')
      .analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("employees list has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/employees");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("the employee create dialog has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/employees");
    await page.getByRole("button", { name: /add employee/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .include('[role="dialog"]')
      .analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("organogram (Visual View) has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/organogram");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("organogram (Outline View) has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Outline View" }).click();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("organogram filter drawer has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: /^filters/i }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("organogram search results (open combobox) has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/organogram");
    // "e2e" (3 chars, above the 2-char minimum) reliably matches
    // something in this shared company — most spec files running
    // concurrently create "E2E ..."-prefixed fixtures — so this scan
    // actually exercises the populated `role="option"` list, not just
    // the "type more characters" empty state a 1-character query would
    // have shown instead.
    await page.getByRole("combobox", { name: /search the organization chart/i }).fill("e2e");
    await expect(page.getByRole("option").first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );

    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  // Phase 13 (release hardening) — the remaining named routes not yet
  // covered above. These all run under the default ADMIN storageState
  // (playwright.config.ts's "chromium" project), which holds every
  // permission, so audit-log/imports/users/settings all render their
  // real content rather than an access-denied redirect.
  test("audit log has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/audit-log");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );
    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("imports page has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/imports");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );
    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("users (administration) page has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/users");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );
    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("settings page has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/settings");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );
    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("employee detail page has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    // Self-contained (unlike the rest of this file, which is read-only):
    // e2e/employees.spec.ts's "Ada Lovelace" fixture is NOT a reliable
    // cross-file dependency — it runs in the same unordered "chromium"
    // Playwright project as this file, with no dependency between them,
    // so it may not exist yet when this test runs. Create a dedicated
    // employee here instead.
    const employeeName = `A11yCheck-${Date.now()}`;
    await page.goto("/employees");
    await page.getByRole("button", { name: /add employee/i }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel(/employee code/i).fill(employeeName);
    await createDialog.getByLabel(/first name/i).fill(employeeName);
    await createDialog.getByLabel(/last name/i).fill("Fixture");
    await createDialog.getByRole("button", { name: /create employee/i }).click();
    await expect(createDialog).toBeHidden();

    await page.getByRole("link", { name: new RegExp(employeeName, "i") }).click();
    await expect(page).toHaveURL(/\/employees\/[^/]+$/);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );
    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("access-denied page has no automatically-detectable critical/serious violations", async ({
    page,
  }) => {
    // A static, standalone page — safe to load directly regardless of
    // how a real user would have been routed here.
    await page.goto("/access-denied");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );
    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
  });

  test("sign-in page has no automatically-detectable critical/serious violations", async ({
    browser,
  }) => {
    // Deliberately unauthenticated — the default ADMIN storageState
    // would otherwise make /sign-in redirect straight to /dashboard.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/sign-in");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );
    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n")
    ).toEqual([]);
    await context.close();
  });
});
