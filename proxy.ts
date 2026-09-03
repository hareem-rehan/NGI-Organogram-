import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Phase 13 release hardening — security response headers applied to
 * every page request. This is the App Router's "Proxy" file convention
 * (this Next.js version renamed the deprecated `middleware.ts` — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 * and CLAUDE.md's "this is NOT the Next.js you know" warning).
 *
 * A fresh nonce is generated per request and applied to `script-src` —
 * Next.js automatically attaches it to every framework/page script it
 * injects once it sees a `'nonce-...'` value in the CSP header, so no
 * layout/page change is needed for that half of the policy
 * (docs/adr's Security Review §Headers has the full rationale).
 *
 * `style-src` intentionally keeps `'unsafe-inline'` — several existing
 * components (department color swatches, dashboard bar-chart widths,
 * the organogram legend/nodes) use React's `style={{...}}` inline-style
 * ATTRIBUTE for values computed from validated, server-controlled data
 * (a hex color already validated against `#RRGGBB`, or a computed
 * percentage) — CSP nonces cannot be applied to the inline `style`
 * HTML attribute at all (only to `<style>` elements and `<script>`
 * elements), so the only way to drop `'unsafe-inline'` here would be
 * rewriting all of them to CSS custom properties set via a nonced
 * `<style>` tag, a UI refactor explicitly out of scope for a
 * stabilization phase (CLAUDE.md "do not add unapproved features").
 * `script-src` — where actual code execution risk lives — has no such
 * exception.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isProduction = process.env.NODE_ENV === "production";

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data:;
    font-src 'self' data:;
    connect-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    ${isProduction ? "upgrade-insecure-requests;" : ""}
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Defense in depth alongside `frame-ancestors 'none'` above, for
  // browsers that predate CSP frame-ancestors support.
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );
  // Every route in this app renders session/company-scoped data — never
  // safe for a shared/public cache to store. NOTE (verified via live
  // fetch on both an authenticated RSC route and the unauthenticated
  // /sign-in route): Next.js's own dynamic-rendering response pipeline
  // sets its own `Cache-Control: no-cache, must-revalidate` downstream of
  // this file for every dynamically-rendered page, which takes
  // precedence over the value set here — this header has no observable
  // effect for page/document responses in this Next.js version. Left in
  // place for non-page response types it may still reach (and as
  // intent-documentation); the practical protection against stale/shared-
  // cache exposure of private data is Next's own directive, which still
  // forces origin revalidation before any cache may serve a copy. See
  // docs/SECURITY_REVIEW.md for the full writeup.
  response.headers.set("Cache-Control", "private, no-store");

  if (isProduction) {
    // Only meaningful once the app is actually served over HTTPS
    // (Phase 14's concern) — harmless but misleading to send over plain
    // HTTP in the meantime, so gated on NODE_ENV=production specifically
    // rather than always-on.
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
