/**
 * Pagination/date-range bounds for audit queries. Plain constants, no
 * "server-only" guard, so a client component (the Audit Log list view)
 * can import `DEFAULT_AUDIT_PAGE_SIZE` directly rather than duplicating
 * the number — the enforcement itself still happens server-side in
 * `lib/services/audit.service.ts`'s `queryAuditEvents`.
 */
export const MAX_AUDIT_PAGE_SIZE = 100;
export const DEFAULT_AUDIT_PAGE_SIZE = 25;
export const MAX_AUDIT_DATE_RANGE_DAYS = 366;
