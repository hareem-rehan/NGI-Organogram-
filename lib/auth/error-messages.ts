/**
 * Maps Auth.js's error codes (its own `?error=` query values — see
 * https://authjs.dev/reference/core/errors) to a safe, generic
 * user-facing message. Never render the raw error code/provider detail
 * directly (docs/PROJECT_SPEC.md §13 / CLAUDE.md §1.8) — this is the
 * only place that translation happens, so it can't be missed at a call
 * site. Pure function — unit-testable without a live provider.
 */
export function safeSignInErrorMessage(errorCode: string | null | undefined): string | null {
  if (!errorCode) return null;

  switch (errorCode) {
    case "AccessDenied":
      return "Your account isn't authorized to access this application, or has been disabled. Contact your administrator if you believe this is a mistake.";
    case "Configuration":
      return "Sign-in is temporarily unavailable due to a configuration issue. Please contact your administrator.";
    case "Verification":
      return "Your sign-in link has expired or was already used. Please try signing in again.";
    default:
      // OAuthSignin, OAuthCallback, OAuthCreateAccount, Callback, and any
      // other/unknown code all collapse to one generic message — the
      // specific code is logged server-side (lib/auth/config.ts), never
      // shown to the user.
      return "Something went wrong while signing in. Please try again.";
  }
}
