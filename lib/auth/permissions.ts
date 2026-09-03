import type { UserRole } from "@prisma/client";

/**
 * Centralized permission identifiers. Every authorization check in the
 * app goes through `hasPermission()`/`requirePermission()` against one
 * of these — never a scattered `role === "ADMIN"` comparison in a
 * component or route handler (docs/AUTHORIZATION_MATRIX.md).
 */
export const PERMISSIONS = [
  "dashboard:view",
  "organogram:view",
  "departments:view",
  "departments:manage",
  "positions:view",
  "positions:manage",
  "employees:view",
  "employees:manage",
  "imports:execute",
  "exports:execute",
  "audit:view",
  "users:manage",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Deny-by-default role→permission mapping (docs/AUTHORIZATION_MATRIX.md
 * is the source-of-truth narrative; this object is what the code
 * actually enforces). ADMIN and HR_EDITOR are never auto-assigned to a
 * user — see lib/auth/provisioning.ts.
 */
const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  ADMIN: [...PERMISSIONS],
  HR_EDITOR: [
    "dashboard:view",
    "organogram:view",
    "departments:view",
    "departments:manage",
    "positions:view",
    "positions:manage",
    "employees:view",
    "employees:manage",
    "imports:execute",
    "exports:execute",
    "audit:view",
  ],
  VIEWER: [
    "dashboard:view",
    "organogram:view",
    "departments:view",
    "positions:view",
    "employees:view",
  ],
};

/**
 * Deny-by-default: an unrecognized or missing role gets zero
 * permissions, never falls through to "least privileged real role" or
 * any other guess.
 */
export function permissionsForRole(role: string | null | undefined): readonly Permission[] {
  if (role === null || role === undefined) return [];
  if (!(role in ROLE_PERMISSIONS)) return [];
  return ROLE_PERMISSIONS[role as UserRole];
}

export function roleHasPermission(
  role: string | null | undefined,
  permission: Permission
): boolean {
  return permissionsForRole(role).includes(permission);
}
