/**
 * How Auth.js names its session cookie.
 *
 * It prefixes the name with `__Secure-` and marks the cookie Secure
 * whenever it is running over HTTPS, and uses the bare name otherwise.
 * There is no custom `cookies` config in lib/auth/config.ts, so these are
 * its unmodified defaults.
 *
 * Anything that writes a session cookie by hand has to produce the same
 * name the rest of the app reads, or the session it just created is
 * invisible and sign-in silently bounces back to the sign-in page. That
 * was a real bug the moment dev sign-in became reachable on a deployed
 * HTTPS environment: the name was hard-coded to the plain local-HTTP
 * variant, which nothing reads over HTTPS.
 *
 * Lives in its own module because a "use server" file may only export
 * async functions, so the rule cannot be exported from the action that
 * uses it — and because a naming rule with no dependencies is easy to
 * test directly.
 */
export interface SessionCookieNaming {
  name: string;
  secure: boolean;
}

/**
 * @param protocol the request's `x-forwarded-proto` header, or null.
 *
 * Keyed on the scheme THIS request arrived on rather than on NODE_ENV or
 * AUTH_URL, because that is also what decides whether a browser would
 * accept a `__Secure-` cookie at all.
 */
export function sessionCookieFor(protocol: string | null): SessionCookieNaming {
  const isHttps = protocol === "https";
  return {
    name: isHttps ? "__Secure-authjs.session-token" : "authjs.session-token",
    secure: isHttps,
  };
}
