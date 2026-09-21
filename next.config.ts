import type { NextConfig } from "next";

/**
 * Foundation-phase config. Intentionally minimal — no domain-specific
 * rewrites/redirects/headers yet.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next's dev-mode cross-origin protection only trusts "localhost" by
  // default. Playwright's e2e config (playwright.config.ts) deliberately
  // navigates via 127.0.0.1 (a distinct origin from localhost as far as
  // this check is concerned) so that cookies set with an explicit
  // `domain` — required by e2e/support/seed-session.ts's mocked-auth
  // cookie injection — attach correctly. Without this, the dev server
  // silently blocks its own client JS bundle for that origin: the page
  // renders (SSR still works) but never hydrates, so no click handler
  // anywhere on the page — including Sheet/Dialog triggers — ever fires.
  // Discovered via Phase 3's first successful real-browser E2E run
  // (docs/phase-reports/PHASE_03_AUTHENTICATION_AND_RBAC.md).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Phase 10: CSV import file uploads go through a Server Action (FormData
  // with a File), consistent with every other mutation in this app —
  // Server Actions support File uploads natively as of this Next.js
  // version (see node_modules/next/dist/docs/01-app/02-guides/
  // server-actions.md's "Body size limit" section). The default 1MB cap
  // would reject any real CSV; raised to comfortably exceed the app's own
  // 10MB import file-size limit (lib/services/import.service.ts).
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
