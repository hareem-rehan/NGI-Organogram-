import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PLAYWRIGHT_PORT ?? "3100";
const baseURL = `http://127.0.0.1:${PORT}`;

// Mocked, non-functional OIDC configuration (see docs/DECISIONS.md P8 —
// no live provider is confirmed yet). e2e/support/seed-session.ts bypasses
// the real sign-in flow by writing a session row directly, so these
// values only need to satisfy lib/env.server.ts's format validation —
// nothing here ever contacts a real identity provider. `npm run test:e2e`
// loads the real values from .env.test; the literals below are only a
// fallback for running `npx playwright test` directly without dotenv.
const AUTH_ENV = {
  // Required in this non-standard-host, non-"development" NODE_ENV
  // context — see .env.test's comment above AUTH_TRUST_HOST for why.
  AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST ?? "true",
  AUTH_SECRET:
    process.env.AUTH_SECRET ?? "e2e-only-placeholder-secret-value-not-a-real-secret-32ch",
  AUTH_OIDC_ISSUER: process.env.AUTH_OIDC_ISSUER ?? "https://e2e-placeholder.invalid/tenant/v2.0",
  AUTH_OIDC_CLIENT_ID: process.env.AUTH_OIDC_CLIENT_ID ?? "e2e-placeholder-client-id",
  AUTH_OIDC_CLIENT_SECRET: process.env.AUTH_OIDC_CLIENT_SECRET ?? "e2e-placeholder-client-secret",
  AUTH_ALLOWED_EMAIL_DOMAINS: process.env.AUTH_ALLOWED_EMAIL_DOMAINS ?? "e2e-test.invalid",
  AUTH_PROVIDER_NAME: process.env.AUTH_PROVIDER_NAME ?? "E2E Placeholder Account",
  AUTH_AUTO_PROVISION_VIEWERS: process.env.AUTH_AUTO_PROVISION_VIEWERS ?? "false",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Every spec file's default context is restored from the same static
    // storageState (e2e/.auth/admin.json, written once by "setup" above) —
    // meaning every file shares ONE seeded company, not one per file.
    // Position carries a real "at most one root per company" DB
    // constraint, and more than one spec file creates positions against
    // that shared company (positions.spec.ts, and Phase 6's
    // employees.spec.ts, which needs at least one real position to assign
    // employees to). Running those two files in parallel workers risks
    // both racing to create the root simultaneously. Isolating
    // positions.spec.ts into its own project that "chromium" depends on
    // guarantees it runs to completion — and so has already established
    // the company's root and hierarchy — before any other file (including
    // employees.spec.ts) starts, without needing to serialize the whole
    // suite down to one worker.
    {
      name: "positions-first",
      testMatch: /positions\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup", "positions-first"],
      testIgnore: [/auth\.setup\.ts/, /positions\.spec\.ts/],
    },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_APP_NAME: "DotZero Organogram",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://organogram:organogram_dev_password@localhost:5433/organogram_test?schema=public",
      ...AUTH_ENV,
    },
  },
});
