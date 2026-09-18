/**
 * Playwright "setup" project (see playwright.config.ts `projects`).
 * Seeds a real, authenticated database session (see
 * e2e/support/seed-session.ts) and saves it as storage state so the
 * main "chromium" project's tests run already signed in as ADMIN —
 * this is the project's mocked-auth E2E strategy, since no live SSO
 * provider is confirmed yet (docs/DECISIONS.md P8).
 *
 * It also WARMS the heaviest routes (see below) — this project runs
 * first and alone, which is the only point in the run where a route can
 * be compiled without several workers racing for the same CPU.
 */
import { test as setup } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";

const AUTH_FILE = "e2e/.auth/admin.json";

setup("seed an authenticated ADMIN session", async ({ page, baseURL }) => {
  // Long enough for the cold route compiles at the end of this test — the
  // default 30s test timeout would cancel them regardless of the per-goto
  // timeout below.
  setup.setTimeout(300_000);

  const { cookieValue } = await seedAuthenticatedSession("ADMIN");

  const url = new URL(baseURL ?? "http://127.0.0.1:3100");
  await page.context().addCookies([
    {
      name: "authjs.session-token",
      value: cookieValue,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.context().storageState({ path: AUTH_FILE });

  // Playwright drives `next dev`, so the FIRST request to a route pays
  // its Turbopack compile. /organogram is much the heaviest (React Flow +
  // ELK), and once several parallel workers request it simultaneously as
  // their first navigation, that compile has repeatedly blown the 30s
  // navigation timeout — in specs that only pass THROUGH the route, like
  // shell.spec.ts and rbac-matrix.spec.ts (the DEF-001 flakiness recorded
  // in docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md).
  //
  // Compiling it once, here, where nothing else is competing, costs a few
  // seconds and removes the race for every worker that follows. The
  // generous timeout is for the compile itself, not for the app.
  for (const route of ["/organogram", "/positions", "/employees", "/dashboard"]) {
    await page.goto(route, { timeout: 120_000, waitUntil: "domcontentloaded" });
  }
});
