import type { Page } from "@playwright/test";
import type { UserRole } from "@prisma/client";

import { seedAuthenticatedSession } from "./seed-session";

/**
 * Overrides the current page's session cookie with a freshly seeded
 * session for the given role — used by specs that need to test a role
 * other than the "setup" project's default ADMIN storageState (e.g.
 * proving a VIEWER cannot see/use a mutation control). Call this BEFORE
 * navigating (or navigate again afterwards) so the new cookie is sent on
 * the next request.
 */
export async function signInAs(page: Page, role: UserRole, baseURL: string): Promise<void> {
  const { cookieValue } = await seedAuthenticatedSession(role);
  const url = new URL(baseURL);
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
}
