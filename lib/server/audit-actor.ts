import type { CurrentUser } from "@/lib/auth/current-user";
import type { AuditActor } from "@/lib/services/audit.service";

/**
 * The one place a `CurrentUser` (from `requirePermission`/
 * `requireActiveUser`) is converted into the shape every mutating
 * service's `actor` input expects — every action file uses this rather
 * than constructing the object literal inline, so the mapping can't
 * drift between call sites.
 */
export function toAuditActor(user: CurrentUser): AuditActor {
  return { userId: user.id, displayName: user.name, email: user.email };
}
