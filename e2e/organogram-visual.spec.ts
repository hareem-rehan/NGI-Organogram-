import { test, expect } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";

// Baseline screenshots must be deterministic — same reasoning as
// organogram.spec.ts's own isolated-company setup (an always-new company
// via seedAuthenticatedSession, session seeded ONCE and re-applied per
// test since each test gets a fresh browser context). Node text uses a
// FIXED suffix (not Date.now()) so committed baseline PNGs never go
// stale just because the wall-clock moved — see
// docs/ORGANOGRAM_RENDERING.md "Visual-Regression Baselines" for how to
// regenerate these with `--update-snapshots` after an intentional visual
// change.
test.describe.configure({ mode: "serial" });

test.describe("Organogram visual regression", () => {
  const rootTitle = "VR CEO";
  const rootCode = "VR-CEO-FIXED";
  const childTitle = "VR VP Eng";
  const childCode = "VR-VPE-FIXED";
  const salesTitle = "VR VP Sales";
  const salesCode = "VR-VPS-FIXED";

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

  test("prerequisite: build a small fixed hierarchy", async ({ page }) => {
    await page.goto("/departments");
    await page.getByRole("button", { name: /add department/i }).click();
    let deptDialog = page.getByRole("dialog");
    await deptDialog.getByLabel(/name/i).fill("VR Dept");
    await deptDialog.getByLabel(/code/i).fill("VR-DEPT-FIXED");
    await deptDialog.getByRole("button", { name: /create department/i }).click();
    await expect(deptDialog).toBeHidden();

    await page.getByRole("button", { name: /add department/i }).click();
    deptDialog = page.getByRole("dialog");
    await deptDialog.getByLabel(/name/i).fill("VR Dept Sales");
    await deptDialog.getByLabel(/code/i).fill("VR-DEPT-SALES-FIXED");
    await deptDialog.getByRole("button", { name: /create department/i }).click();
    await expect(deptDialog).toBeHidden();

    await page.goto("/positions");
    await page.getByRole("button", { name: /add position/i }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox", { name: "Department" })).not.toHaveValue("");
    await dialog.getByRole("combobox", { name: "Department" }).selectOption({ label: "VR Dept" });
    await dialog.locator('input[name="title"]').fill(rootTitle);
    await dialog.locator('input[name="positionCode"]').fill(rootCode);
    await dialog.getByRole("button", { name: /create position/i }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: /add position/i }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Department" }).selectOption({ label: "VR Dept" });
    await dialog.locator('input[name="title"]').fill(childTitle);
    await dialog.locator('input[name="positionCode"]').fill(childCode);
    await dialog.getByRole("combobox", { name: /reports to/i }).click();
    await dialog.getByRole("combobox", { name: /reports to/i }).fill(rootTitle);
    await page
      .getByRole("option", { name: new RegExp(rootTitle) })
      .first()
      .click();
    await dialog.getByRole("button", { name: /create position/i }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: /add position/i }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("combobox", { name: "Department" })
      .selectOption({ label: "VR Dept Sales" });
    await dialog.locator('input[name="title"]').fill(salesTitle);
    await dialog.locator('input[name="positionCode"]').fill(salesCode);
    await dialog.getByRole("combobox", { name: /reports to/i }).click();
    await dialog.getByRole("combobox", { name: /reports to/i }).fill(rootTitle);
    await page
      .getByRole("option", { name: new RegExp(rootTitle) })
      .first()
      .click();
    await dialog.getByRole("button", { name: /create position/i }).click();
    await expect(dialog).toBeHidden();
  });

  test("Visual View matches its baseline", async ({ page }) => {
    await page.goto("/organogram");
    await expect(page.getByRole("button", { name: new RegExp(`^${childTitle}`) })).toBeVisible();
    // Layout settles asynchronously (ELK + fitView animation); wait past
    // the 200ms fitView transition before capturing.
    await page.waitForTimeout(400);
    await expect(
      page.getByRole("application", { name: "Interactive organization chart" })
    ).toHaveScreenshot("organogram-visual-view.png", { maxDiffPixelRatio: 0.02 });
  });

  test("Outline View matches its baseline", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Outline View" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^${childTitle}`) })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("organogram-outline-view.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("a department filter (match + ancestor context) matches its baseline", async ({ page }) => {
    await page.goto("/organogram");
    await expect(page.getByRole("button", { name: new RegExp(`^${childTitle}`) })).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: "VR Dept Sales" }).check();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: new RegExp(`^${salesTitle}`) })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(
      page.getByRole("application", { name: "Interactive organization chart" })
    ).toHaveScreenshot("organogram-filter-match-context.png", { maxDiffPixelRatio: 0.02 });
  });

  test("Position Focus matches its baseline", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: new RegExp(`^${childTitle}`) }).click();
    await page.getByRole("button", { name: /focus on this position/i }).click();
    await expect(page.getByText("Position Focus")).toBeVisible();
    await page.getByRole("button", { name: /close position details/i }).click();
    await page.waitForTimeout(400);
    await expect(
      page.getByRole("application", { name: "Interactive organization chart" })
    ).toHaveScreenshot("organogram-position-focus.png", { maxDiffPixelRatio: 0.02 });
  });

  test("Department Focus matches its baseline", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: new RegExp(`^${salesTitle}`) }).click();
    await page.getByRole("button", { name: /focus on this department/i }).click();
    await expect(page.getByText("Department Focus")).toBeVisible();
    await page.getByRole("button", { name: /close position details/i }).click();
    await page.waitForTimeout(400);
    await expect(
      page.getByRole("application", { name: "Interactive organization chart" })
    ).toHaveScreenshot("organogram-department-focus.png", { maxDiffPixelRatio: 0.02 });
  });

  test("no-filter-matches empty state matches its baseline", async ({ page }) => {
    await page.goto("/organogram");
    await expect(page.getByRole("button", { name: new RegExp(`^${childTitle}`) })).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("radio", { name: "Occupied" }).check();
    await page.keyboard.press("Escape");
    await expect(page.getByText("No matching positions")).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("organogram-no-matches.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("mobile filter drawer matches its baseline", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/organogram");
    await expect(page.getByRole("button", { name: new RegExp(`^${childTitle}`) })).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Filters" })).toHaveScreenshot(
      "organogram-mobile-filter-drawer.png",
      { maxDiffPixelRatio: 0.02 }
    );
  });

  test("Outline View match/context states match their baseline", async ({ page }) => {
    await page.goto("/organogram");
    await page.getByRole("button", { name: "Outline View" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^${childTitle}`) })).toBeVisible();
    await page.getByRole("button", { name: /^filters/i }).click();
    await page.getByRole("checkbox", { name: "VR Dept Sales" }).check();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: new RegExp(`^${salesTitle}`) })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("organogram-outline-match-context.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
