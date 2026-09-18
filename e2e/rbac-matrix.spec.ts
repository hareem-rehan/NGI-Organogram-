import { test, expect } from "@playwright/test";

import { NAV_ITEMS } from "../config/navigation";
import { roleHasPermission } from "../lib/auth/permissions";
import { signInAs } from "./support/sign-in-as";

/**
 * Consolidated RBAC route/nav matrix (Phase 13 "Release Hardening").
 *
 * This is additive to, not a replacement for, the existing per-module
 * specs (e2e/imports.spec.ts, e2e/audit-log.spec.ts, e2e/settings.spec.ts,
 * e2e/users.spec.ts) which each already assert their own "VIEWER/HR_EDITOR
 * cannot access this one route" case in their own domain context. What
 * those files don't do, and this one does:
 *
 *   1. Assert nav-item visibility in a REAL, rendered browser session for
 *      all 3 roles — docs/NEGATIVE_SCENARIOS.md's A19 previously listed
 *      role-specific direct-URL denial as verified only by unit tests
 *      (lib/auth/current-user.test.ts) plus MANUAL per-role verification
 *      during Phase 3; the only existing automated nav-visibility check
 *      (components/layout/app-shell.test.tsx) mocks `hasPermission` at
 *      the component level rather than rendering with a real session.
 *   2. Walk EVERY (role × route) combination — all 3 roles × all 9
 *      docs/AUTHORIZATION_MATRIX.md §4 routes — in one systematic sweep,
 *      rather than one hand-picked "denied" case per module file, so a
 *      future route added to config/navigation.ts without a matching
 *      permission gate fails here even if no one thought to add a
 *      module-specific negative test for it.
 *   3. Prove directly that a hidden nav item and a blocked route are two
 *      independent guarantees: for every denied route this test never
 *      even looks at the nav (it drives `page.goto` directly), so a bug
 *      that only hid the link without protecting the route would still
 *      be caught.
 *
 * The expected allow/deny matrix is derived from the same
 * `roleHasPermission`/`NAV_ITEMS` the application itself uses — never a
 * second, hand-maintained copy of the permission table that could drift
 * out of sync with docs/AUTHORIZATION_MATRIX.md.
 */

const ROLES = ["ADMIN", "HR_EDITOR", "VIEWER"] as const;

for (const role of ROLES) {
  test.describe(`RBAC matrix — ${role}`, () => {
    test(`${role}: nav shows exactly the permitted items, and every route independently enforces its own permission`, async ({
      page,
      baseURL,
    }) => {
      const url = baseURL ?? "http://127.0.0.1:3100";
      await signInAs(page, role, url);

      // --- 1. Real, rendered nav visibility (desktop "Primary" landmark) ---
      await page.goto("/dashboard");
      const primaryNav = page.getByRole("navigation", { name: "Primary" });
      for (const item of NAV_ITEMS) {
        const allowed = roleHasPermission(role, item.permission);
        const link = primaryNav.getByRole("link", { name: item.label });
        if (allowed) {
          await expect(link, `${role} should see the "${item.label}" nav link`).toBeVisible();
        } else {
          await expect(link, `${role} should NOT see the "${item.label}" nav link`).toHaveCount(0);
        }
      }

      // --- 2. Direct URL navigation, independent of what the nav shows ---
      for (const item of NAV_ITEMS) {
        const allowed = roleHasPermission(role, item.permission);
        await page.goto(item.href);
        if (allowed) {
          await expect(page, `${role} should be able to reach ${item.href} directly`).toHaveURL(
            new RegExp(`${item.href}$`)
          );
          await expect(page.getByRole("heading", { level: 1, name: item.label })).toBeVisible();
        } else {
          await expect(
            page,
            `${role} navigating directly to ${item.href} should be blocked server-side, not just hidden from nav`
          ).toHaveURL(/\/access-denied$/);
        }
      }
    });
  });
}
