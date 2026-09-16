import { Badge } from "@/components/ui/badge";
import { isDevSignInBypassingProduction } from "@/lib/auth/dev-sign-in-flag";

/**
 * Shown whenever the running environment isn't production, so nobody
 * mistakes a dev/test/staging instance for the real thing. Renders
 * nothing in production (no badge is itself the "production" signal —
 * still not color-only, since there's no color involved either way).
 *
 * The one exception is a production build running with
 * AUTH_ALLOW_DEV_SIGN_IN on. That instance looks like production and is
 * not secured like production — anyone who reaches it can sign in as
 * ADMIN — so it says so, on every page, rather than being distinguishable
 * only by someone noticing an extra page exists. The wording states the
 * consequence, not the setting: "sign-in bypassed" tells a non-technical
 * reader what is true of the site in front of them.
 */
export function EnvironmentBadge() {
  const environment = process.env.NODE_ENV;

  if (isDevSignInBypassingProduction()) {
    return (
      <Badge variant="destructive" className="tracking-wide uppercase">
        Sign-in bypassed
      </Badge>
    );
  }

  if (environment === "production") {
    return null;
  }

  const label = environment === "test" ? "Test" : "Development";

  return (
    <Badge variant="outline" className="tracking-wide uppercase">
      {label}
    </Badge>
  );
}
