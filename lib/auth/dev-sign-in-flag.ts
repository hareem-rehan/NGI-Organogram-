/**
 * The dev-sign-in gate, on its own and deliberately free of any server
 * dependency — no `server-only`, no Prisma, no config object.
 *
 * It lives apart from `dev-sign-in.ts` for two reasons. The header badge
 * that warns about the bypass is reachable from a client module and
 * cannot import a `server-only` file, and a gate with no dependencies is
 * one that cannot be affected by how or when anything else initialises.
 *
 * Both entry points into the feature (the page and the server action)
 * check this independently, and so does `createDevSession` itself —
 * never trusting that an earlier check already ran (CLAUDE.md §1.8:
 * server-side enforcement, not UI-only).
 */

/**
 * Whether the local-development sign-in page exists at all.
 *
 * Outside a production build this is simply what "local development"
 * means, and it is how the E2E suite signs in.
 *
 * On a DEPLOYED environment it takes an explicit opt-in, because
 * switching it on hands ADMIN to anyone who can reach the URL. That
 * exists for one situation: a staging deployment with no identity
 * provider registered yet, which would otherwise be unusable. Such an
 * environment is protected by nothing but the obscurity of its address,
 * so it must not hold real employee data — and the production deploy job
 * fails outright if it finds the page reachable.
 *
 * Compared against the exact string, so a truthy-looking value such as
 * "false", "0" or "yes" does not enable it.
 */
export function isDevSignInEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.AUTH_ALLOW_DEV_SIGN_IN === "true";
}

/**
 * True only in the combination that warrants a standing warning in the
 * UI: a production build with the bypass switched on. Deliberately
 * distinct from `isDevSignInEnabled()`, which is also true in ordinary
 * local development, where a warning would be noise.
 */
export function isDevSignInBypassingProduction(): boolean {
  return process.env.NODE_ENV === "production" && isDevSignInEnabled();
}
