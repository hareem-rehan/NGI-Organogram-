# ADR-0010: Provider-neutral OIDC via Auth.js, replacing the Phase 0 credentials-provider plan

## Status

Accepted (Phase 3). Amends ADR-0003.

## Context

ADR-0003 (Phase 0) chose Auth.js with a credentials provider (email + admin-set password) for MVP, reasoning that a company SSO decision might not arrive in time and that Auth.js's provider abstraction would let SSO be added later without an architecture change.

The Phase 3 task brief settled this differently and explicitly: **"The first release will use Company SSO. The exact SSO provider has not yet been confirmed."** It further required that no application-managed passwords, password reset flow, or password storage be built at all, and that no provider-specific values (Microsoft/Google/tenant/domain/client ID/issuer) be hard-coded anywhere in source — everything provider-specific must live in server-side environment configuration.

This is a genuine amendment, not a silent change: `docs/DECISIONS.md` P8 is updated to record it, alongside this ADR.

## Decision

1. **No credentials provider is implemented.** There is no password field on `User`, no login form that accepts a password, no password-reset flow. The only way into the app is the OIDC provider.
2. **The OIDC provider is configured generically**, not for a named vendor:
   ```ts
   {
     id: "company-sso",
     name: serverEnv.AUTH_PROVIDER_NAME, // display label only, e.g. "Company Account"
     type: "oidc",
     issuer: serverEnv.AUTH_OIDC_ISSUER,
     clientId: serverEnv.AUTH_OIDC_CLIENT_ID,
     clientSecret: serverEnv.AUTH_OIDC_CLIENT_SECRET,
   }
   ```
   `type: "oidc"` with only an `issuer` tells Auth.js to discover the authorization/token/userinfo endpoints via `${issuer}/.well-known/openid-configuration` at runtime. This same code works against Microsoft Entra ID, Google Workspace, Okta, or any other standards-compliant OIDC identity provider — switching providers is a `.env` change, never a source change.
3. **Every provider-specific value lives in server-side env config** (`lib/env.server.ts`): `AUTH_OIDC_ISSUER`, `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET`, optional `AUTH_ALLOWED_TENANT_ID` / `AUTH_OIDC_TENANT_CLAIM`, required `AUTH_ALLOWED_EMAIL_DOMAINS`, and `AUTH_PROVIDER_NAME` (display label only). None of these have a real value committed anywhere — `.env.example` and `.env.test` both use obviously-fake placeholders.
4. **Identity validation runs in the `signIn` callback**, not deferred to the client: email-domain allowlist (`assertEmailDomainAllowed`) and optional tenant claim check (`assertTenantAllowed`) both run before any `User`/`Account` row is touched. A sign-in outside the allowed domain (or, if configured, the allowed tenant) is rejected before it can create or link any account.
5. **`allowDangerousEmailAccountLinking: true`** is set deliberately. Normally this flag is dangerous because it lets an attacker who controls an account at _any_ OAuth provider with a matching email silently take over an existing local account. Here it's safe specifically because: (a) there is only ever one configured OIDC provider (no second provider to spoof against), and (b) the domain/tenant checks in the `signIn` callback already gate every sign-in attempt before linking occurs — an attacker would need to control an account within the company's own configured identity provider and tenant, which is outside this application's threat model to prevent (same as any Company-SSO deployment). Documented at the point of use in `lib/auth/config.ts`, not just here.

## Rationale

- The task brief's own words ("the exact SSO provider has not yet been confirmed") make a vendor-specific integration actively wrong to build right now — it would need to be redone once IT/security names a provider.
- Auth.js's OIDC discovery mechanism is exactly the abstraction needed: one small, provider-agnostic config object, zero vendor SDKs, zero vendor-specific code paths.
- Removing the credentials provider entirely (rather than keeping it as a fallback) matches the explicit "no application-managed passwords" instruction and shrinks the attack surface — there is no password database to leak, no password-reset flow to secure, no credential-stuffing target.

## Alternatives Considered

- **Keep the Phase 0 credentials provider as a fallback alongside OIDC:** rejected — the task brief explicitly forbids any password-based login path, and a dual-path auth system is strictly more attack surface for a feature (self-hosted passwords) nothing asked for.
- **Hard-code a specific vendor's provider (e.g. `next-auth/providers/microsoft-entra-id`) now, on the assumption it will likely be Entra ID:** rejected — the brief is explicit that no provider is confirmed; guessing wrong means a rewrite, and vendor-specific provider modules often bake in vendor-specific claim shapes this generic OIDC config avoids depending on.
- **Defer Phase 3 entirely until a provider is confirmed:** rejected — `docs/DECISIONS.md` §5 is explicit that an open question should get a safe reversible default rather than block a whole phase; a generic OIDC foundation is exactly that default.

## Consequences

- Until a real IdP is configured, the app cannot be signed into by a live user — this is expected and documented, not a bug. `scripts/provision-user.ts` and the mocked-session E2E helper (`e2e/support/seed-session.ts`) exist specifically so the rest of the system is buildable, testable, and demoable before that decision lands.
- The moment a real provider is named, turning it on is: create an app registration with the IdP, set the five `AUTH_OIDC_*`/`AUTH_ALLOWED_*` env vars, redeploy. No source change, no new migration.
- If the eventual provider's tokens carry claims outside the standard OIDC set this code already reads (`sub`, `email`, `name`, `picture`, plus a configurable tenant claim), `lib/auth/identity-validation.ts` is the single place to extend — it stays isolated from `lib/auth/config.ts`'s wiring.
