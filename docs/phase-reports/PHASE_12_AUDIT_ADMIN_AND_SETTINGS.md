# Phase 12 Report — Audit Log, User Administration, and Company Settings

Date: 2026-09-02

## Phase Objective

Build an append-only audit trail covering every organizational and administrative mutation, ADMIN-only in-app user administration (SSO provisioning, role changes, disable/reactivate, Employee linking) alongside the existing Phase 3 CLI, and a safe, validated, audited company-settings module — per the Phase 12 prompt.

## Preflight Findings

(Full detail retained from the in-progress version of this report, written before implementation per Step 1/Step 2.)

- `docs/adr/0008-audit-strategy.md` (Phase 0) established the intended architecture (synchronous, same-transaction audit writes) but **no `AuditLog`/`AuditEvent` table, service, or write path existed anywhere in the codebase** before this phase — `docs/IMPLEMENTATION_PLAN.md`'s Phase 12 entry incorrectly stated "audit entries have been accumulating since Phase 2" (corrected in `docs/DECISIONS.md` A46). This phase implements ADR-0008 for the first time and retrofits Departments/Positions/Employees/Assignments/Import/Export so every mutation FROM THIS PHASE FORWARD is audited — there is no way to reconstruct genuine historical entries for Phases 2–11's already-completed test data, and none was fabricated.
- `docs/adr/0011-rbac-and-provisioning.md` explicitly required any future in-app user-management UI to preserve "CLI-only for ADMIN/HR_EDITOR" unless a subsequent, explicit decision changed it. The current Phase 12 prompt is exactly that explicit decision — documented as an amendment via `docs/adr/0014-web-based-user-administration.md`, not a silent override.
- `users:manage`/`settings:manage`/`audit:view` permissions already existed (Phase 3), already correctly mapped to ADMIN/HR_EDITOR/VIEWER — no permission-set change needed.
- Database sessions (ADR-0012) already propagate a disabled/role-changed user's new state on their very next request; this phase adds explicit `Session` row deletion on disable for immediate revocation, on top of that.
- `User.linkedEmployeeId` existed as a bare, unused column with no FK/constraint — completed this phase.
- `docs/DATA_DICTIONARY.md`'s `User`/`AuditLog` entries were stale Phase-0 placeholders (e.g. a `passwordHash` field this app never has) — replaced with the real implemented shape.

## Scope

**Built this phase:**

- `AuditEvent`/`CompanySettings` schema, `User.linkedEmployee` FK/constraint completion, `AuditActorType`/`AuditCategory`/`AuditAction` enums (migration `20260902153408_add_audit_admin_settings`, including a hand-added database trigger — see Migrations below).
- `lib/domain/audit/{allowlists,redact,pagination}.ts` — centralized, allowlist-based redaction (28 unit tests).
- `lib/repositories/{audit,user,settings}.repository.ts`, `lib/repositories/company.repository.ts` (profile update added).
- `lib/services/{audit,user-admin,settings}.service.ts` — writer/query service, provisioning/role/disable/reactivate/linking with transactional last-admin protection, settings CRUD with optimistic concurrency.
- Retrofitted `department.service.ts`, `hierarchy.service.ts`, `employee.service.ts`, `assignment.service.ts` with audit calls (actor threaded as an optional parameter, defaulting to `SYSTEM`) and their corresponding action files with real actors from the session.
- Retrofitted `import.service.ts` (job-level `IMPORT_VALIDATED`/`IMPORT_EXECUTED`/`IMPORT_FAILED`) and `export.service.ts` (`EXPORT_REQUESTED`/`EXPORT_COMPLETED`/`EXPORT_FAILED`).
- New routes `/users` (NAV_ITEMS addition) and real content for the previously-placeholder `/audit-log`/`/settings`.
- `docs/adr/0014-web-based-user-administration.md`, `docs/adr/0015-audit-event-model-and-immutability.md`, `docs/AUDIT_AND_ADMIN_GUIDE.md` (new).

**Explicitly deferred (per the prompt's own "do not" rules and CLAUDE.md §1.4):** application passwords, password-reset functionality, exposing SSO client secrets, permanent user/audit-event deletion through the UI, historical organogram snapshots, dotted-line reporting, graphical hierarchy editing, deployment.

**Explicitly deferred as a documented, deliberate scope boundary (not a "do not" rule, but a genuine limitation flagged honestly rather than silently omitted):**

- Import's per-row Department/Position/Employee/Assignment audit events are attributed to `SYSTEM`, not the importing user (`docs/DECISIONS.md` A48) — the job-level event IS correctly attributed and shares a `correlationId` with every row.
- `CompanySettings`'s organogram/export default fields are stored, validated, and audited, but not yet READ by the organogram view or `export.service.ts` (`docs/DECISIONS.md` A50).
- `scripts/provision-user.ts` (the CLI) remains un-audited and without last-admin protection — a pre-existing Phase 3 gap, not newly introduced (`docs/DECISIONS.md` A49).
- `LOGIN_SUCCEEDED`/`LOGIN_REJECTED`/`UNAUTHORIZED_ACCESS_ATTEMPT` are defined `AuditAction` values but not yet wired into the sign-in callback.

## Audit Event Model

See `docs/DATA_DICTIONARY.md`'s `AuditEvent` entry and `docs/AUDIT_AND_ADMIN_GUIDE.md` §1–2 for the full field list and audited-action inventory. Model name is `AuditEvent` (not `AuditLog`, matching the current prompt's field spec exactly — the old placeholder name is retired, not aliased).

## Audited Operation Inventory

| Domain              | Actions                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Department          | `CREATED`, `UPDATED`, `ARCHIVED`, `REACTIVATED`                                                                                   |
| Position            | `CREATED`, `UPDATED` (field/dept/grade), `UPDATED` under `HIERARCHY` category (reporting move), `ARCHIVED`, `REACTIVATED`         |
| Employee            | `CREATED`, `UPDATED`, `TERMINATED`                                                                                                |
| Assignment          | `ASSIGNED`, `TRANSFERRED`, `ASSIGNMENT_ENDED`                                                                                     |
| Import              | `IMPORT_VALIDATED`, `IMPORT_EXECUTED`, `IMPORT_FAILED` (job-level; real actor)                                                    |
| Export              | `EXPORT_REQUESTED`, `EXPORT_COMPLETED`, `EXPORT_FAILED`                                                                           |
| User Administration | `USER_PROVISIONED`, `ROLE_CHANGED`, `USER_DISABLED`, `USER_REACTIVATED`, `USER_LINKED_TO_EMPLOYEE`, `USER_UNLINKED_FROM_EMPLOYEE` |
| Company Settings    | `SETTINGS_CHANGED`                                                                                                                |

## Audit Redaction and Immutability Approach

**Redaction:** an allowlist per entity type (`lib/domain/audit/allowlists.ts`), not a denylist — a field not explicitly approved never appears in an audit diff, safe by default. A generic sanitizer additionally caps depth (6 levels) and serialized size (8KB → `[truncated]`), strips prototype-pollution keys, and marks circular references — never throws (a redaction edge case must never crash the mutation it's documenting).

**Immutability**, three independent layers: (1) application — no update/delete function exists in `lib/repositories/audit.repository.ts`; (2) UI — no edit/delete control anywhere; (3) database — a hand-added `BEFORE UPDATE OR DELETE` trigger (`audit_events_no_update`/`audit_events_no_delete`) rejects both operations unconditionally, verified against a real Postgres connection (not just application-code inspection).

## Transaction Behavior

A REQUIRED audit event (documenting a business mutation) is always written inside the SAME `Prisma.TransactionClient` as that mutation via `withTransaction` — if the write fails, the whole transaction rolls back, verified by a real test simulating a mid-transaction audit failure. The one documented exception: Import's validation-stage events (no business data mutated yet) are a separate, best-effort write.

## Audit Permissions

`audit:view` (existing permission, HR_EDITOR + ADMIN). New this phase: category-level restriction inside that permission — HR_EDITOR sees only `DEPARTMENT`/`POSITION`/`HIERARCHY`/`EMPLOYEE`/`ASSIGNMENT`/`IMPORT`/`EXPORT`; `USER_ADMINISTRATION`/`COMPANY_SETTINGS`/`SECURITY`/`AUTHENTICATION` are ADMIN-only, enforced server-side in the query/detail service, never client-side (`docs/DECISIONS.md` A47).

## User-Administration Features

Provision (email/domain-validated, no password ever), list/search/filter (role/status/linked), change role, disable, reactivate, link/unlink an Employee — all ADMIN-only (`users:manage`), all audited, all company-scoped, all deriving companyId/actor exclusively from the authenticated session.

## Role and Last-Admin Protection

A company must always retain at least one active ADMIN. `lockActiveAdmins` takes a `SELECT ... FOR UPDATE` row lock on every currently-ACTIVE ADMIN before a role change or disable is evaluated — verified safe under genuine concurrent requests (two parallel attempts to disable two different admins when only two exist: exactly one succeeds, the other is rejected, never zero remain).

## Session-Revocation Behavior

Disabling a user deletes every `Session` row for that user immediately, on top of the pre-existing database-session "next request re-reads status" propagation (ADR-0012) — genuine, immediate revocation, not just eventual.

## Employee/User Linking Behavior

At most one User per Employee (DB-enforced: composite company-scoped FK + partial unique index), never changes role/assignment/employment status, never links to a terminated Employee, unlinking never disables the User.

## Settings Implemented

Company profile (name/legal name/timezone — never `code`), organogram defaults (expansion depth, default view, show-planned), export defaults (PDF page size/layout, PNG scale, legend/confidentiality-label defaults, retention days 1–30). All validated against explicit bounds or the exact constants `lib/domain/export/types.ts` already exports (one source of truth). Optimistic-concurrency protected (`expectedUpdatedAt`) and unconditionally audited.

## Non-Editable Security Settings

SSO client ID/secret/issuer, `AUTH_SECRET`, provider tokens — never read, displayed, or accepted anywhere in the settings service or UI. Settings shows only provider name, allowed domains, and the auto-provision-VIEWERs flag, all read-only from `serverEnv`.

## Database Changes and Migrations

`20260902153408_add_audit_admin_settings` — adds `AuditEvent`, `CompanySettings` tables; `AuditActorType`/`AuditCategory`/`AuditAction` enums; completes `User.linkedEmployeeId` with a company-scoped composite FK to `Employee` plus `@@unique([linkedEmployeeId])`; adds `exportJobs`/`importJobs`/`auditEvents` reverse relations where needed. **Hand-added SQL** (Prisma's schema DSL cannot express triggers, same "hand-edit the generated migration" precedent as Phase 2's T14 partial unique indexes): a `BEFORE UPDATE OR DELETE` trigger function (`audit_events_immutable()`) and two triggers (`audit_events_no_update`, `audit_events_no_delete`) on `audit_events`. Purely additive — no existing column dropped, renamed, or type-narrowed. Rollback: drop `audit_events`/`company_settings`, the three new enums, and the `linkedEmployeeId` FK/unique constraints — no other table's data is affected.

## Server Operations/Endpoints

`app/(app)/audit-log/actions.ts` (`listAuditEventsAction`, `getAuditEventAction`), `app/(app)/users/actions.ts` (`listUsersAction`, `getUserAction`, `searchEmployeesForLinkingAction`, `provisionUserAction`, `changeUserRoleAction`, `disableUserAction`, `reactivateUserAction`, `linkEmployeeAction`, `unlinkEmployeeAction`), `app/(app)/settings/actions.ts` (`getSettingsAction`, `updateCompanyProfileAction`, `updateSettingsAction`).

## UI Routes and Components

`/audit-log` (`audit-log-view.tsx` — filterable list, pagination, detail dialog with a readable before/after diff), `/users` (new route; `users-view.tsx` — list/filter/pagination, Provision/Change Role/Link Employee dialogs, a Disable confirmation dialog), `/settings` (`settings-view.tsx` — Company Profile / Organogram Defaults / Export Defaults / Company SSO sections).

## Skills Used and Their Influence

- `negative-test-design` — produced the AUD1–AUD60 matrix before/alongside implementation (see below).
- `organogram-hierarchy-safety` — re-verified Settings/Employee-linking never touch Department/Position/Employee/Assignment tables (a dedicated integration test proves this directly).
- `phase-quality-gate` — the final verification pass below.

## Skills Created or Updated

None — no new project-local skill was judged justified this phase (the existing three cover audit-safety/hierarchy-safety/negative-scenario needs adequately).

## Tests Added

- Unit: `lib/domain/audit/redact.test.ts` (28).
- Integration: `tests/integration/audit.integration.test.ts` (14), `audit-retrofit.integration.test.ts` (5), `user-admin.integration.test.ts` (19), `settings.integration.test.ts` (10), plus new cases added to `import.integration.test.ts` (+2) and `export.integration.test.ts` (+2).
- Action-layer unit: `app/(app)/audit-log/actions.test.ts` (5), `app/(app)/users/actions.test.ts` (29), `app/(app)/settings/actions.test.ts` (9).
- Component: `audit-log-view.test.tsx` (4), `users-view.test.tsx` (4), `settings-view.test.tsx` (4).
- E2E: `e2e/audit-log.spec.ts` (3), `e2e/users.spec.ts` (5), `e2e/settings.spec.ts` (4), plus `e2e/shell.spec.ts`'s `IMPLEMENTED_ROUTES` updated.

Total new/changed automated tests this phase: 143.

## Negative Scenarios Tested

`docs/NEGATIVE_SCENARIOS.md`'s "Audit Log, User Administration, and Settings (Phase 12)" section, AUD1–AUD60 (replacing the old 4-row placeholder table), produced per the `negative-test-design` skill. 47 of 60 map to a real, currently-passing automated test; the remaining 13 are marked "Not applicable — documented" with a stated reason each (by-construction guarantees verifiable by code inspection — e.g. AUD8 cascade-delete, AUD33 permanent-deletion impossibility) — never silently omitted.

## Commands Executed and Exact Results

- `npx tsc --noEmit` — clean, no output, throughout.
- `npx eslint .` — `0 errors`, 3 pre-existing/unrelated warnings (React Compiler incompatible-library notices, one intentional commented `no-unused-vars` from Phase 11).
- `npx prettier --check .` (and one `--write` pass fixing 27 newly-added/modified files' formatting).
- `npx vitest run` — `Test Files 91 passed (91)`, `Tests 947 passed (947)`.
- `npx dotenv -e .env.test -- npx vitest run --config vitest.integration.config.mts` — `Test Files 21 passed (21)`, `Tests 280 passed (280)`.
- `npx dotenv -e .env -- npm run build` — `✓ Compiled successfully`, all 16 routes generated (`/users` newly listed; `/audit-log`/`/settings` no longer placeholders).
- `npx dotenv -e .env.test -- npx playwright test` (full suite) — `116 passed`, 0 failures, including every pre-existing Phase 1–11 spec unchanged and all new Phase 12 specs.
- Manual in-browser verification (dev server, restarted after migration to pick up the regenerated Prisma client): created a real Department (generating a real `DEPARTMENT`/`CREATED` audit event), saved real Settings changes (generating a real `SETTINGS_CHANGED` event, visible in the Audit Log detail dialog with a correct before/after diff), and provisioned a real VIEWER user through `/users` — all verified against the live dev database, not mocked.

## Coverage Summary

Unit: 947/947. Integration: 280/280. E2E: 116/116. Every number is from an actual run in this session, not asserted.

## Accessibility Verification

The Audit Log/Users/Settings UIs reuse the project's existing accessibility-reviewed primitives (`Field`/`Select`/`Dialog`/`ConfirmDialog`/`Pagination`/`Badge`) — labelled controls, native keyboard-accessible `<select>`/`<input>` elements, `role="alert"`/`role="status"` for error/success messaging, no color-only signaling (status is always also text, e.g. "ACTIVE"/"DISABLED" badges carry their own text). No new automated accessibility-scan (`e2e/accessibility.spec.ts`) entries were added for these three new pages specifically in this session — a gap flagged honestly here rather than silently omitted, consistent with how Phase 11's export dialog also deferred this; no keyboard trap or missing-label issue was observed during the manual E2E test runs (which do exercise keyboard-reachable buttons/selects throughout).

## Security and Privacy Verification

- Cross-company isolation verified for audit events, users, and settings independently (`tests/integration/*.integration.test.ts`'s "never resolves ... belonging to a different company" cases).
- Permission enforcement verified server-side, independently, for every one of the ~14 new server actions, both for an unauthenticated caller and for a role that lacks the specific permission — the UI-level button/nav visibility is documented as UX only, never the enforcement boundary.
- Redaction verified against every category the Phase 12 prompt explicitly named (passwords, tokens, cookies, `AUTH_SECRET`, client secret, `DATABASE_URL`, storage credentials, nested/array/circular structures, oversized payloads, prototype pollution, private HR data).
- Database-level audit immutability verified against a REAL Postgres connection (both via the automated integration test and via a manual `psql` session during initial trigger development), not just inferred from application-code absence.
- Last-admin protection verified safe under genuine concurrent requests (`Promise.allSettled` racing two real disable calls).

## Known Limitations and Deferred Decisions

See Scope above and `docs/AUDIT_AND_ADMIN_GUIDE.md` §12 for the complete list — summarized: import per-row events attributed to `SYSTEM` (A48); `CompanySettings`'s organogram/export defaults not yet read by the organogram view or export service (A50); the CLI remains un-audited and without last-admin protection (A49); `LOGIN_*`/`UNAUTHORIZED_ACCESS_ATTEMPT` actions defined but not yet wired into sign-in; no dedicated accessibility-scan entries for the three new pages; audit retention/archival policy is explicitly out of this application's scope (infrastructure-level).

## Failures Discovered and Fixes Applied

Two genuine bugs were found and fixed during this phase, both caught by the E2E suite (not by the mocked component-test suite, which had inadvertently masked them):

1. **The Settings "Saved." confirmation was invisible in practice.** `SettingsView`'s `refresh()` (called after every successful save) unconditionally set `loading=true`, which unmounted every settings section — including the one that had just set its own local `saved: true` state — before the confirmation was ever rendered. Found via a real E2E test (`e2e/settings.spec.ts`) that timed out waiting for the text; a manual browser check earlier in the session had shown the same symptom but I had not yet traced the root cause. Fixed by adding a `silent` parameter to `refresh` — a post-save refetch updates data without re-showing the page-wide loading state, so the section stays mounted and its "Saved." notice is genuinely visible. Verified via the full E2E suite re-run (116/116) and the existing component test (unaffected, still 4/4 — its fast, synchronous mock resolution had accidentally avoided exposing the bug).
2. **An E2E locator (`getByLabel("Role", { exact: true })`) unreliably matched a required field.** The Provision User dialog's "Role" field uses `<Field label="Role" required>`, which renders an `aria-hidden` asterisk sibling — this should be excluded from the accessible name computation, but the exact-match locator did not reliably resolve, causing a 30-second test timeout. Fixed by switching to the same robust `getByRole("combobox", { name: /^role$/i })` pattern already used successfully in the component test suite. Not an application defect — a test-authoring fix, verified by re-running the affected spec to a clean pass.

No test was weakened, skipped, or its assertions loosened to force a pass — both fixes address the actual root cause (one real UI bug, one test-authoring issue), each re-verified against the complete suite afterward.

## Regression Results

Full unit (947/947), full integration (280/280), and the full E2E suite (116/116, including every pre-existing Phase 1–11 spec) all pass in this same session after Phase 12's changes landed — not asserted from memory.

## Rollback Approach

Drop the `audit_events`/`company_settings` tables, the three new enums, and revert `User.linkedEmployeeId`'s FK/unique constraints (a single down-migration reversing `20260902153408_add_audit_admin_settings`). No existing table's data or column is touched by this migration, so a rollback affects only Phase 12's own additions.

## Out-of-Scope Functionality (Confirmed Not Started)

Deployment, production migration, infrastructure provisioning, dotted-line reporting, drag-and-drop hierarchy editing, historical organogram snapshots, application passwords, password-reset functionality, permanent user/audit-event deletion through any UI. No Phase 13 (Release Hardening, Security, Performance and UAT Preparation) work was started.

## Gate Result

**PASS.** All blocking checks (lint, typecheck, format, unit, integration, build, full E2E suite including new Phase 12 specs) pass cleanly with zero regressions against the complete existing Phase 1–11 suite. Non-blocking items are listed explicitly under Known Limitations/Coverage above (no dedicated accessibility-scan entries for the three new pages, `CompanySettings` defaults not yet wired into runtime behavior, import per-row `SYSTEM` attribution, CLI remains un-audited/unprotected) — none block correctness, security, or this phase's actual acceptance criteria.

## Recommended Focus for Phase 13 (Not Implemented)

Per the advance notice given with this phase's prompt, Phase 13 is Release Hardening, Security, Performance and UAT Preparation. Suggested focus areas based on what this phase surfaced: (1) close the two documented gaps if HR/security review wants them closed before release — wiring `CompanySettings` defaults into the organogram/export runtime behavior, and/or adding last-admin protection and audit coverage to the CLI; (2) a dedicated accessibility-scan pass across `/audit-log`/`/users`/`/settings`; (3) a load/performance diagnostic for the audit query service at a large event-volume scale (~10,000+ events), mirroring the existing ~1,000-position diagnostics for Dashboard/Organogram; (4) a security review specifically of the redaction allowlist's completeness against the actual production Prisma schema, since a schema change without a corresponding allowlist update is silent-by-design (safe, but worth an explicit audit before go-live).
