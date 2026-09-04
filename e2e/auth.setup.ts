/**
 * Playwright "setup" project (see playwright.config.ts `projects`).
 * Seeds a real, authenticated database session (see
 * e2e/support/seed-session.ts) and saves it as storage state so the
 * main "chromium" project's tests run already signed in as ADMIN —
 * this is the project's mocked-auth E2E strategy, since no live SSO
 * provider is confirmed yet (docs/DECISIONS.md P8).
 */
import { test as setup } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/seed-session";

const AUTH_FILE = "e2e/.auth/admin.json";

setup("seed an authenticated ADMIN session", async ({ page, baseURL }) => {
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
});
