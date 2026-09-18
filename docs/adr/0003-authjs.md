# ADR-0003: Auth.js with a credentials provider for MVP

## Status

Superseded in Phase 3 by [ADR-0010](0010-authjs-provider-neutral-oidc.md) — the credentials-provider plan described below was never implemented; Company SSO became a firm requirement and no application-managed passwords exist. Auth.js itself (the library choice) remains accepted. Kept here for historical context per `docs/DECISIONS.md` P8's resolution note.

## Context

The task brief allows "Auth.js or the company-approved identity provider." No company IdP/SSO system was named in the proposal or in this repository. Blocking Phase 3 (Authentication and RBAC) on an external IT decision would stall the whole project.

## Decision

Implement authentication with Auth.js (NextAuth), using a **credentials provider** (email + password, accounts provisioned by an admin — no public self-registration) for MVP. Structure the integration behind Auth.js's standard provider abstraction so an OIDC/SAML/SSO provider can be added later without changing how the rest of the app reads the session/role.

## Rationale

- Auth.js integrates natively with Next.js App Router (session access in Server Components/Actions), which is exactly where authorization checks need to happen (business rule 12).
- The provider abstraction is the whole point of choosing Auth.js over a hand-rolled auth system: adding a company SSO provider later is a configuration/provider addition, not an architecture change.
- Credentials-based accounts, provisioned only by `SUPER_ADMIN` (no self-signup), keeps MVP scope small while still being secure (hashed passwords, admin-controlled account creation) per `CLAUDE.md` §1.11 and `docs/PROJECT_SPEC.md` §13.

## Alternatives Considered

- **Wait for HR/IT to name an approved IdP before starting Phase 3:** rejected — this is exactly the kind of open question `docs/DECISIONS.md` P8 defaults through rather than blocking on, since the credentials-provider path doesn't foreclose adding SSO later.
- **Build custom session/auth handling from scratch:** more control, more security surface to get wrong (session fixation, CSRF, password reset flows) for no benefit over a maintained library built for this exact framework.

## Consequences

- Password reset / account recovery flow must be designed in Phase 3 for the credentials provider (admin-driven reset is acceptable for MVP given no self-signup).
- When/if a real IdP is confirmed, adding it is additive (new provider config) — existing session-consumption code in `server/policies` and route handlers should not need to change.
