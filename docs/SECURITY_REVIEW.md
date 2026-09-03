# Security Review — Dynamic Organogram Manager

Phase 13 (Release Hardening) deliverable, Steps 5-7. Covers authentication, authorization, input/output security, file handling, privacy, and operational security, plus the dependency/secret-scan results. This is a review of the implementation as it stands — it does not itself constitute a formal penetration test or third-party audit.

## 1. Authentication

- Company SSO via provider-neutral OIDC (`lib/auth/config.ts`, `docs/adr/0010-authjs-provider-neutral-oidc.md`). No credentials/password provider exists anywhere in the codebase (verified by grep during Phase 13's MVP traceability review).
- Sessions are **database-backed** (Auth.js's `database` strategy via `@auth/prisma-adapter`), not JWT — a disabled user is blocked on their very next request, not merely on token expiry (`docs/AUTHORIZATION_MATRIX.md` §6).
- Disabling a user via the web UI (`/users`) additionally deletes every `Session` row for that user immediately (`lib/repositories/user.repository.ts`'s `deleteUserSessions`) — genuine, immediate revocation, confirmed in Phase 12.
- `AUTH_SECRET`/OIDC client secret/tokens are never read into any page or API response under any role (`docs/AUTHORIZATION_MATRIX.md`, Settings section).
- Auth.js's `useSecureCookies` auto-enables based on `url.protocol === "https:"` (confirmed via `node_modules/@auth/core/lib/init.js`) — secure/httpOnly/sameSite cookie flags are automatic once deployed over HTTPS, no explicit app code needed; this is a Phase 14 deployment-environment concern (HTTPS termination), not something this codebase can misconfigure.
- **New this phase — a real, manually-confirmed gap: closing a modal dialog with Escape returns focus to `<body>`, not the triggering element (DEF-007, Low).** Not an authentication issue per se, but worth noting here since it was found during the same manual session-behavior verification pass.

## 2. Authorization

- Full role/permission/route/server-operation model documented in `docs/AUTHORIZATION_MATRIX.md` — 3 roles (`VIEWER`/`HR_EDITOR`/`ADMIN`), a flat named-permission set, checked server-side via `requirePermission`/`requirePagePermission`, never a raw role comparison.
- **New this phase:** a consolidated RBAC/company-isolation automated test matrix (`tests/integration/rbac-company-isolation.integration.test.ts`, 26 tests; `e2e/rbac-matrix.spec.ts`, 3 tests) exercises all 3 roles × all 9 module groups at both the server-action layer (mocking only the outermost `auth()` call, then driving real permission checks/services/repositories against a real database) and the UI layer (direct URL navigation, confirming denied routes redirect to `/access-denied` server-side, not merely hidden from nav). **The original brief's "7 roles" figure does not match the implemented 3-role system** — documented as a scope clarification, not a defect (see `docs/phase-reports/PHASE_13_RELEASE_HARDENING.md`).
- Cross-company isolation specifically tested using two companies with **deliberately colliding codes** (department `ENG`, position `POS-001`, employee `EMP-001` in both) — confirmed no list/get/update/role-change/disable action ever leaks or mutates the other company's same-coded record.
- **No RBAC or cross-company-isolation defect was found** by this new test matrix.

## 3. Input / Output Security

- Server Actions re-validate every mutation independently of client-side form validation (Zod schemas in `lib/validation/*.ts`), per CLAUDE.md §1.8 — UI-only validation is treated as a defect class, not a shortcut, and the codebase consistently avoids it (confirmed across all `*/actions.ts` files during Phase 12/13 review).
- **New this phase — Content-Security-Policy** (`proxy.ts`, this Next.js version's `middleware.ts` renamed file convention): nonce-based `script-src 'self' 'nonce-{random}' 'strict-dynamic'` (a fresh nonce every request, auto-applied by Next.js to all framework-injected scripts), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. `style-src` keeps `'unsafe-inline'` deliberately — CSP nonces cannot apply to the inline `style={{...}}` HTML attribute (only `<style>`/`<script>` elements can be nonced), and 5 existing components use it for validated, server-computed values (hex colors, percentages); rewriting them to nonced `<style>` tags is judged a UI refactor out of scope for a stabilization phase.
- **New this phase — additional security headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (defense-in-depth alongside `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/microphone/geolocation/FLoC disabled), `Strict-Transport-Security` (production-only — meaningless over plain HTTP in dev).
- **Correction (Phase 14, verified against a real production build):** the finding originally recorded here — that Next.js overrides `Cache-Control: private, no-store` with `no-cache, must-revalidate` — was verified via `next dev` only. Re-verified in Phase 14 against a real `next build && next start` (`NODE_ENV=production`) local instance: `Cache-Control: private, no-store` is present exactly as `proxy.ts` sets it, unmodified. The earlier override is specific to `next dev`'s own development-mode response handling, not a general Next.js framework behavior, and does not apply to a real production deployment. No residual gap exists in production. (The same production-mode check also newly confirmed `Strict-Transport-Security` is present, correctly gated on `NODE_ENV=production`, which `next dev` never exercises.)
- Functional verification confirmed the new CSP does not break client interactivity — no CSP-violation console errors observed opening a real dialog and submitting a real form via the Browser pane.
- Audit event redaction (`lib/domain/audit/redact.ts`, Phase 12) — depth/size-capped, denylist-based redaction before any `beforeData`/`afterData`/`safeMetadata` reaches the `AuditEvent` table; 28 unit tests.

## 4. File Handling

- CSV import (`lib/services/import.service.ts`): file size capped (`MAX_IMPORT_FILE_SIZE_BYTES`), filename sanitized (`sanitizeFilename` strips path separators and disallowed characters) before ever being used in a downloadable filename, checksum-verified before execution (re-validates the SHA-256 checksum recorded at upload against the stored bytes, refusing to execute if it no longer matches).
- PDF/PNG export (`lib/services/export.service.ts`, Phase 11): server-rendered (no headless browser), private storage (a `Bytes` column, not a public path), server-checked download authorization re-run on every single download request — a job id from another company resolves to "not found," never that company's file.
- No user-uploaded file is ever served back verbatim without going through the app's own validated pipeline — there is no generic file-serving endpoint in this app.

## 5. Privacy

- No real employee data anywhere in source, fixtures, seeds, or docs (CLAUDE.md §1.11) — verified this phase via the UAT seed dataset review and the MVP traceability grep pass; only synthetic/fictional names are used throughout.
- Confidential fields (salary/contact/SSO/token data) are excluded from the organogram payload **by construction, for every role** — not a per-role toggle (`docs/AUTHORIZATION_MATRIX.md` §4). This is a stricter guarantee than the original proposal's per-role field-visibility-flag design (Pending Decision P1) — see `docs/DECISIONS.md`'s Phase 13 annotation on P1/P3 for why that original design is superseded rather than literally implemented.
- Audit trail redaction (§3 above) prevents secrets/tokens from ever entering `AuditEvent.beforeData`/`afterData`/`safeMetadata`.

## 6. Operational Security

### 6.1 Dependency Audit

`npm audit`: **5 vulnerabilities (4 High, 1 Moderate)**, both advisory chains are **dev-tooling-only** (never shipped in the production runtime bundle):

| Package        | Severity | Advisory                                                          | Path                                 | Production runtime exposure                                                                  |
| -------------- | -------- | ----------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `deepmerge-ts` | High     | GHSA-ggr8-5vv4-36mx (stack exhaustion on recursive object graphs) | `@prisma/config` → `prisma`          | None — only the Prisma CLI (`migrate`/`generate`, dev/CI-time) uses this chain               |
| `esbuild`      | Moderate | GHSA-67mh-4wv8-2f99 (dev server accepts arbitrary requests)       | `vite` (Vitest's transform pipeline) | None — only the Vitest dev-mode test runner uses this chain, never `next build`/`next start` |

**Accepted for release — see `docs/DEFECT_REGISTER.md` DEF-004** for the full, explicit release-blocking decision this constitutes (per CLAUDE.md's "no unresolved Critical/High vulnerability without an explicit decision" rule). `npm audit fix --force` would introduce an unreviewed breaking Prisma downgrade and Vite major upgrade — out of scope for a stabilization phase; recommended as a deliberate, dedicated future migration instead.

`npm outdated`: several packages have newer majors available (Prisma, Vitest, ESLint, TypeScript, `next-auth` stable release, etc.) — informational only, not a vulnerability signal; no action taken this phase.

### 6.2 Secret Scan

Pattern-based scan (AWS access keys, private key headers, OpenAI-style `sk-` tokens, Slack tokens, Google API keys) across every git-tracked file: **zero real secrets found.** The only connection-string-shaped matches (`postgresql://organogram:...@localhost/...`) are confirmed, already-documented, non-functional placeholder credentials for disposable local-dev/CI-only Postgres containers (`.env.example`, `playwright.config.ts`, `.github/workflows/ci.yml`) — never real credentials, and never reachable outside a throwaway container. This same scan now runs as a required CI step (`.github/workflows/ci.yml`).

### 6.3 Domain-Integrity Check

New read-only, system-wide diagnostic (`scripts/check-domain-integrity.ts`, `npm run check:integrity`) covering 18 corruption categories (hierarchy/root/level/cycle integrity, duplicate codes, overlapping/invalid assignments, cross-company reference leaks, last-admin protection, disabled-user session revocation, audit-event company consistency) — see `docs/phase-reports/PHASE_13_RELEASE_HARDENING.md`'s "Domain-Integrity Check" section for full detail. Runs clean (`PASS`) against the current test database; now a required CI smoke step.

### 6.4 Database Migration and Backup/Restore

Both rehearsed against disposable databases this phase — see `docs/DATABASE_RELEASE_RUNBOOK.md` for full command-by-command evidence, including a genuine drop-and-restore disaster simulation (not just a truncate) that confirmed row counts, hand-authored constraints, the audit-immutability trigger, and app-level (Prisma) queryability all survive intact.

## 7. Findings Summary (cross-referenced to `docs/DEFECT_REGISTER.md`)

| ID      | Summary                                                                                                                                | Severity              | Status                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| DEF-004 | 5 `npm audit` findings, all dev-tooling-only                                                                                           | High (per audit tool) | Accepted for release                               |
| DEF-006 | Concurrent hierarchy moves could jointly create a reporting cycle                                                                      | High                  | **Fixed** this phase                               |
| DEF-009 | CSV import too slow (31.8s/1,000 rows) and fails to complete (5,000 rows) at scale, after a partial fix removed the prior hard failure | High                  | Partially mitigated — pending stakeholder decision |
| DEF-005 | Audit-log pending-row color contrast below WCAG AA                                                                                     | Medium                | Fixed                                              |
| DEF-007 | Dialog focus not restored to trigger on close                                                                                          | Low                   | Accepted, not fixed                                |

No Critical-severity finding exists. Two High-severity findings remain outstanding in some form: DEF-004 is explicitly accepted (dev-tooling-only, no production exposure); DEF-009 requires an explicit stakeholder decision before release (see Defect Register for the two concrete options).
