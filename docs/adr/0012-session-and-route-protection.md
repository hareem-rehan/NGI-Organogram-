# ADR-0012: Database session strategy and server-side-only route/page authorization

## Status

Accepted (Phase 3).

## Context

Auth.js supports two session strategies — JWT (stateless, session claims baked into a signed cookie) and database (a `Session` row per login, cookie holds only an opaque token). It also leaves route protection entirely to the application: nothing is protected by default.

`CLAUDE.md` §1.8 is explicit: "Enforce business rules and permissions server-side, not only in the UI. UI-only validation or role gating is a defect, not a shortcut." The task brief additionally required that a disabled user or a role change take effect promptly, not "eventually, when a token expires."

## Decision

1. **Database session strategy**, 12-hour `maxAge`:
   ```ts
   session: { strategy: "database", maxAge: 12 * 60 * 60 }
   ```
   The `session` callback re-reads `role`/`status`/`companyId` from the `User` row (already freshly loaded by `PrismaAdapter` for this request) on every session check. With JWT sessions, a disabled user or a demoted admin would keep working until their token naturally expired; with database sessions, the very next request after an admin runs `provision-user.ts disable`/`set-role` sees the change, because there is no cached claim to go stale.
2. **A single authorization module, `lib/auth/current-user.ts`, is the only place session data is read for authorization decisions:**
   - `getCurrentUser()` — session or `null`, never throws.
   - `requireAuthenticatedUser()` — throws `UnauthenticatedError` if there's no session.
   - `requireActiveUser()` — additionally throws `InactiveUserError` if `status !== "ACTIVE"`.
   - `requirePermission(permission)` — additionally throws `ForbiddenError` if the role lacks the permission (checked via the pure `roleHasPermission` from ADR-0011).
   - `getAuthorizedCompanyContext()` — returns `{ companyId, userId, role }` **derived only from the session**, never from any client-supplied value (request body, query string, header) — this is the specific guard against a browser-supplied `companyId` being trusted (see `docs/NEGATIVE_SCENARIOS.md`).
3. **Every `(app)` route calls `requirePagePermission(permission)` before rendering anything.** `requirePagePermission` wraps `requirePermission` and translates its three error types into the right redirect: `UnauthenticatedError`/`InactiveUserError` → `/sign-in`, `ForbiddenError` → `/access-denied`. This runs inside the Server Component itself, before any DOM is produced — there is no placeholder-then-hide-with-CSS step where a network tab could still reveal a flash of protected content.
4. **`AppShell` (the layout wrapping every `(app)` page) independently calls `getCurrentUser()`** to filter `NAV_ITEMS` down to only the links the current role has permission for. This is a UX convenience, not the authorization boundary — hiding a nav link never substitutes for the page-level `requirePagePermission` check, which is what actually blocks direct-URL access to a hidden route (verified by `docs/NEGATIVE_SCENARIOS.md`'s "hidden-nav direct URL access" scenario).
5. **No Auth.js error code is ever shown to the user verbatim.** `safeSignInErrorMessage()` maps the small set of Auth.js callback error codes to one of four safe, generic messages; anything unrecognized collapses to a single generic "something went wrong" message. The real code is logged server-side only (`lib/auth/config.ts`'s `logger.warn`/`logger.error` calls), never serialized into the redirect URL's visible text or the page body beyond the code already being a query param Auth.js itself appends (which this app never echoes back into rendered text).
6. **`server-only` guards are direct on every module that holds a secret or a database handle** (`lib/env.server.ts`, `lib/db/prisma.ts`, `lib/auth/config.ts`), but deliberately _not_ re-declared on `lib/auth/current-user.ts` and `lib/auth/require-page-permission.ts` themselves — those two rely on the guard being enforced transitively through their real imports. This is a documented tradeoff (see the inline comments in both files): a direct `import "server-only"` at the top of a file makes that file un-mockable in the standard Vitest unit config (the import throws at module-load time, before `vi.mock` can intervene), which would have made these two files — the actual authorization logic — untestable without a real database. The guarantee is unchanged (importing either file from client code still fails the build, via `current-user.ts` → `config.ts` → `env.server.ts`/`prisma.ts`), only where the guard physically sits moved.

## Rationale

- Database sessions cost a query per request but buy immediate propagation of security-relevant state changes, which is exactly the property `CLAUDE.md` §1.8's "server-side, not only UI" principle implies for _authorization_, not just authentication — a stale-but-signed JWT saying "I am ADMIN" is functionally a UI-only check with extra steps if the server never re-verifies it against current state.
- Centralizing every authorization read through one module (`current-user.ts`) means there is exactly one place that knows how to turn a session into a trust decision — every route, action, and future server-side mutation calls into it rather than re-implementing "check role" inline, which is what made the deny-by-default guarantee (ADR-0011) actually enforceable everywhere instead of "everywhere someone remembered to add a check."
- Redirecting _inside_ the Server Component (before render) rather than client-side after a flash of content closes the exact gap `CLAUDE.md` §1.8 calls a defect: there is no moment where protected markup exists in the response at all for an unauthorized request.

## Alternatives Considered

- **JWT sessions with a short expiry (e.g. 5 minutes) as a compromise:** rejected — still leaves a window where a disabled user's existing token keeps working, and shrinking that window doesn't remove the underlying "stale claim" problem, just its duration; database sessions remove the problem class entirely at an acceptable per-request query cost for this app's scale (`docs/DECISIONS.md` P7: ~2,000 positions, not a high-QPS consumer app).
- **Client-side route guards (redirect-on-mount in a `"use client"` wrapper):** rejected outright per `CLAUDE.md` §1.8 — this is precisely "UI-only... a defect, not a shortcut."
- **Keep `import "server-only"` directly on `current-user.ts`/`require-page-permission.ts` and skip unit-testing them, relying only on integration/E2E coverage:** rejected — these two files contain the actual authorization decisions (which error maps to which redirect, whether a permission check runs before or after the active-status check); leaving them unit-untested would be a real coverage gap for the most security-sensitive code in the phase, for a guarantee (the direct guard) that the transitive chain already provides.

## Consequences

- Every session check is a database round-trip; if a future phase's load testing (`docs/PROJECT_SPEC.md` §14 performance targets) shows this is a bottleneck, moving to a hybrid strategy (short-lived JWT cache in front of the DB read) is the documented escape hatch — but that hasn't been shown to be necessary yet, so it isn't built preemptively.
- Any new server-side mutation (Phase 4+) must call `requirePermission`/`requireActiveUser`/`getAuthorizedCompanyContext` from `lib/auth/current-user.ts` rather than reading `auth()` directly — this is the enforced convention `docs/AUTHORIZATION_MATRIX.md` documents, and future phases' negative-scenario matrices should include a "server-side check bypassed by calling `auth()` directly" style regression check if server actions start being added.
- The `server-only`-guard placement tradeoff in point 6 must be re-reviewed if either file is ever refactored to import something _not_ already transitively guarded — the safety argument depends specifically on `current-user.ts`'s and `require-page-permission.ts`'s current import graphs.
