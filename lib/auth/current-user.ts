// No direct "server-only" import here: this module is already guarded
// transitively through `auth` (lib/auth/config.ts imports lib/env.server.ts
// and the Prisma client, both directly guarded). A redundant direct guard
// here would also block mocking @/lib/auth/config in unit tests — see
// lib/auth/current-user.test.ts.
import type { UserRole, UserStatus } from "@prisma/client";

import { auth } from "@/lib/auth/config";
import "@/lib/auth/types";
import { type Permission, roleHasPermission } from "@/lib/auth/permissions";
import { ForbiddenError, InactiveUserError, UnauthenticatedError } from "@/lib/auth/errors";

export interface CurrentUser {
  id: string;
  role: UserRole;
  status: UserStatus;
  companyId: string;
  email: string | null;
  name: string | null;
}

/**
 * Centralized server-side authorization utilities
 * (docs/AUTHORIZATION_MATRIX.md "Server-Side Authorization Strategy").
 * Every protected server action / route handler / Server Component that
 * needs to know who's asking calls one of these — never `auth()`
 * directly, so the active-user and permission checks can't be
 * accidentally skipped at a new call site.
 *
 * These read the DATABASE session (via Auth.js's `auth()`, which the
 * database session strategy backs with a fresh Session+User row lookup)
 * — never anything the browser could have supplied unverified.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  return {
    id: session.user.id,
    role: session.user.role,
    status: session.user.status,
    companyId: session.user.companyId,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  };
}

export async function requireAuthenticatedUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

export async function requireActiveUser(): Promise<CurrentUser> {
  const user = await requireAuthenticatedUser();
  if (user.status !== "ACTIVE") throw new InactiveUserError();
  return user;
}

export function hasPermission(user: Pick<CurrentUser, "role">, permission: Permission): boolean {
  return roleHasPermission(user.role, permission);
}

/** Requires an authenticated, active user who also holds `permission`. Returns the resolved user so callers don't need a second lookup. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireActiveUser();
  if (!hasPermission(user, permission)) {
    throw new ForbiddenError(`This action requires the "${permission}" permission.`);
  }
  return user;
}

/**
 * The ONLY trusted source of `companyId` for a server-side operation —
 * derived from the authenticated session, never from a client-supplied
 * value. Every company-scoped service call (Phase 2's
 * lib/services/*.ts) must receive its companyId from here once routes
 * are wired to those services, not from request body/query/params.
 */
export async function getAuthorizedCompanyContext(): Promise<{
  companyId: string;
  userId: string;
  role: UserRole;
}> {
  const user = await requireActiveUser();
  return { companyId: user.companyId, userId: user.id, role: user.role };
}
