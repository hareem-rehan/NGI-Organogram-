/**
 * Pagination bounds for user-listing queries. Plain constants, no
 * "server-only" guard, so the Users list view (a client component) can
 * import `DEFAULT_USER_PAGE_SIZE` directly — the enforcement itself
 * still happens server-side in `lib/services/user-admin.service.ts`'s
 * `listUsers`.
 */
export const MAX_USER_PAGE_SIZE = 100;
export const DEFAULT_USER_PAGE_SIZE = 25;
