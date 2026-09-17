import "server-only";
import { resolveServerEnv, type ServerEnv } from "./env";

/**
 * Server-only environment values. Importing this file from client
 * component code fails the build (the "server-only" package throws when
 * resolved outside a server context) rather than silently leaking
 * DATABASE_URL or other server secrets into the browser bundle.
 *
 * Never re-export individual fields of `serverEnv` through a module that
 * a client component imports — import `serverEnv` only from server-side
 * code (route handlers, server actions, server components that don't
 * pass the values as props to a client component).
 */

/**
 * `next build` evaluates server modules (this one, via the auth config)
 * to collect page data, and a build has no database and no real secrets:
 * it must not require DATABASE_URL, AUTH_SECRET, or the OIDC values. The
 * build-phase tolerance lives in `resolveServerEnv` (pure, and tested in
 * env.test.ts). Validation stays strict at runtime, where a genuinely
 * missing or malformed secret still fails fast.
 */
export const serverEnv: ServerEnv = resolveServerEnv(process.env, {
  isBuildPhase: process.env.NEXT_PHASE === "phase-production-build",
});
