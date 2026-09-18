// No direct "server-only" import: already guarded transitively through
// requirePermission (lib/auth/current-user.ts -> lib/auth/config.ts). A
// redundant direct guard here would block mocking @/lib/auth/current-user
// in unit tests — see lib/auth/require-page-permission.test.ts.
import { redirect } from "next/navigation";

import type { Permission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/current-user";
import { ForbiddenError, InactiveUserError, UnauthenticatedError } from "@/lib/auth/errors";

/**
 * Server Component page-level guard: proves "direct URL access is still
 * denied when navigation is hidden" (docs/NEGATIVE_SCENARIOS.md) — every
 * placeholder route calls this with its own required permission, not
 * just relying on the shell's nav-visibility filtering
 * (components/layout/app-shell.tsx), which is UX-only.
 */
export async function requirePagePermission(permission: Permission): Promise<void> {
  try {
    await requirePermission(permission);
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof InactiveUserError) {
      redirect("/sign-in");
    }
    if (error instanceof ForbiddenError) {
      redirect("/access-denied");
    }
    throw error;
  }
}
