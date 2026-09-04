# Authorization Matrix — Dynamic Organogram Manager

Single reference for the Phase 3 role/permission/route/server-operation model. Keep this in sync with [lib/auth/permissions.ts](../lib/auth/permissions.ts) — that file is the executable source of truth; this document is its narrative companion. See [docs/adr/0011-rbac-and-provisioning.md](adr/0011-rbac-and-provisioning.md) and [docs/adr/0012-session-and-route-protection.md](adr/0012-session-and-route-protection.md) for the rationale behind everything below, and [docs/DECISIONS.md](DECISIONS.md) C14/P8 for how this model was reached.

## 1. Roles

Three roles, `prisma/schema.prisma`'s `UserRole` enum. No other value is valid — anything else is treated as zero permissions (deny-by-default, see §3).

| Role        | Summary                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VIEWER`    | Read-only access to organizational data. No mutation, import, export, or audit visibility.                                                                 |
| `HR_EDITOR` | Everything `VIEWER` has, plus creating/editing/deactivating departments, positions, and employees, executing CSV import/export, and viewing the audit log. |
| `ADMIN`     | Everything `HR_EDITOR` has, plus user/role management and system settings.                                                                                 |

## 2. Permissions

Flat, named permission set (`lib/auth/permissions.ts`'s `PERMISSIONS`/`Permission`). A route or server operation checks one of these — never a raw role comparison — so the mapping stays in one place.

| Permission           | Meaning                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `dashboard:view`     | View the dashboard module                                                                                    |
| `organogram:view`    | View the organogram chart                                                                                    |
| `departments:view`   | View department records                                                                                      |
| `departments:manage` | Create/edit/deactivate departments                                                                           |
| `positions:view`     | View position records and reporting hierarchy                                                                |
| `positions:manage`   | Create/edit/move positions, change reporting relationships                                                   |
| `employees:view`     | View employee records                                                                                        |
| `employees:manage`   | Create/edit employees, manage position assignments                                                           |
| `imports:execute`    | Run CSV/Excel import                                                                                         |
| `exports:execute`    | Run PDF/PNG/CSV export                                                                                       |
| `audit:view`         | View the audit log                                                                                           |
| `users:manage`       | Manage user accounts and roles — via `scripts/provision-user.ts` (Phase 3) or the `/users` web UI (Phase 12) |
| `settings:manage`    | Manage system configuration                                                                                  |

## 3. Role → Permission Matrix

| Permission           | VIEWER | HR_EDITOR | ADMIN |
| -------------------- | :----: | :-------: | :---: |
| `dashboard:view`     |   ✅   |    ✅     |  ✅   |
| `organogram:view`    |   ✅   |    ✅     |  ✅   |
| `departments:view`   |   ✅   |    ✅     |  ✅   |
| `departments:manage` |   ❌   |    ✅     |  ✅   |
| `positions:view`     |   ✅   |    ✅     |  ✅   |
| `positions:manage`   |   ❌   |    ✅     |  ✅   |
| `employees:view`     |   ✅   |    ✅     |  ✅   |
| `employees:manage`   |   ❌   |    ✅     |  ✅   |
| `imports:execute`    |   ❌   |    ✅     |  ✅   |
| `exports:execute`    |   ❌   |    ✅     |  ✅   |
| `audit:view`         |   ❌   |    ✅     |  ✅   |
| `users:manage`       |   ❌   |    ❌     |  ✅   |
| `settings:manage`    |   ❌   |    ❌     |  ✅   |

A `null`/missing/unrecognized role has **zero** permissions — no row in this table defaults to "allow." Verified by `lib/auth/permissions.test.ts`.

## 4. Route Access Matrix

Every `(app)` route calls `requirePagePermission(permission)` server-side before rendering (`docs/adr/0012...`). This is the actual enforcement point — the table below is a summary, not an independent guarantee.

| Route          | Required permission | VIEWER |                HR_EDITOR                 |        ADMIN        |
| -------------- | ------------------- | :----: | :--------------------------------------: | :-----------------: |
| `/dashboard`   | `dashboard:view`    |   ✅   |                    ✅                    |         ✅          |
| `/organogram`  | `organogram:view`   |   ✅   |                    ✅                    |         ✅          |
| `/departments` | `departments:view`  |   ✅   |                    ✅                    |         ✅          |
| `/positions`   | `positions:view`    |   ✅   |                    ✅                    |         ✅          |
| `/employees`   | `employees:view`    |   ✅   |                    ✅                    |         ✅          |
| `/imports`     | `imports:execute`   |   ❌   |                    ✅                    |         ✅          |
| `/audit-log`   | `audit:view`        |   ❌   | ✅ (organization-change categories only) | ✅ (all categories) |
| `/users`       | `users:manage`      |   ❌   |                    ❌                    |         ✅          |
| `/settings`    | `settings:manage`   |   ❌   |                    ❌                    |         ✅          |

Phase 3 added the permission gate in front of each route. `/departments` (Phase 4), `/positions` (Phase 5), `/employees` (Phase 6), `/dashboard` (Phase 7, read-only Company Overview), `/organogram` (Phase 8–9, interactive chart with search/filters/focus — see `docs/ORGANOGRAM_RENDERING.md`/`docs/ORGANOGRAM_SEARCH_AND_FOCUS.md`), `/imports` (Phase 10, CSV import — see `docs/CSV_IMPORT_GUIDE.md`), and `/audit-log`/`/users`/`/settings` (Phase 12, see `docs/AUDIT_AND_ADMIN_GUIDE.md`) all now have real content — no Phase-1-era placeholder pages remain.

**Audit Log (Phase 12) is the one route where the SAME permission (`audit:view`) resolves to a different visible dataset per role, not just a different set of controls.** HR_EDITOR can view the page and see organization-change events (`DEPARTMENT`/`POSITION`/`HIERARCHY`/`EMPLOYEE`/`ASSIGNMENT`/`IMPORT`/`EXPORT`); `USER_ADMINISTRATION`/`COMPANY_SETTINGS`/`SECURITY`/`AUTHENTICATION` categories are silently excluded from HR_EDITOR's results (never an error revealing they exist), enforced in `lib/services/audit.service.ts`'s `queryAuditEvents`/`getAuditEvent`, not client-side.

**User Administration (`/users`, Phase 12) is gated by `users:manage`, a DIFFERENT permission from `audit:view` even though both are relevant to the same broad "administration" area** — HR_EDITOR holds `audit:view` but not `users:manage`, so it can see (a restricted view of) the audit trail but cannot reach `/users` at all. This is a deliberate, explicit amendment to ADR-0011 (`docs/adr/0014-web-based-user-administration.md`, `docs/DECISIONS.md` A45): a second, web-based path to grant/change roles and disable/reactivate users, alongside the unchanged Phase 3 CLI (`scripts/provision-user.ts`) — safe because the web path is reachable only by an already-authenticated ADMIN, never by an unauthenticated or under-privileged request.

**Settings (`/settings`, Phase 12) is gated by `settings:manage`** — company profile, organogram/export defaults, and read-only Company SSO status. The SSO client secret/tokens/`AUTH_SECRET` are never read into this page under any role.

**Organogram field visibility (Phase 8):** every role holding `organogram:view` (VIEWER, HR_EDITOR, ADMIN) sees the identical node/edge payload — there is no role-gated field on `OrganogramNode` itself, since the contract already excludes salary/contact/SSO/token data by construction. The one role-sensitive UI decision is downstream of the payload: the Details Panel only links an occupied position's occupant name to `/employees/[id]` when the viewer additionally holds `employees:view` (true for all three current roles); that destination route re-checks authorization independently regardless of this link's visibility.

**Search, filters, and focus (Phase 9) operate transitively under `organogram:view` — no new permission was introduced.** Search, filtering, and Position/Department Focus are pure client-side computations over the same node/edge payload `organogram:view` already gated (`docs/ORGANOGRAM_SEARCH_AND_FOCUS.md` "Architecture") — there is no second server call for these features to independently authorize. A shareable deep link (`/organogram?view=position&position=<id>`) grants no additional access beyond what the visiting session's own `organogram:view` permission and company scoping already allow: loading that URL re-runs the identical `getOrganogramAction` call for whoever opens it, so a link shared with (or guessed by) an unauthorized or different-company user still resolves only to that viewer's own authorized data — never the sharer's. See `docs/NEGATIVE_SCENARIOS.md` ORG91/ORG93/ORG100.

**CSV import (Phase 10) is gated end-to-end by `imports:execute` — no new permission was introduced, but every stage re-checks it independently, not just the page.** Uploading a file, validating it, viewing the preview, confirming, executing, downloading the error report, downloading a template, and viewing job history each call `requirePermission("imports:execute")` in their own server action (`app/(app)/imports/actions.ts`) — a caller who somehow reached one step is never assumed authorized for the next. `companyId` is always derived from the authenticated session; an `ImportJob` row belongs to exactly one company, and every read/write is scoped to it, so a job id from another company resolves to "not found," never that company's data (`docs/CSV_IMPORT_GUIDE.md` §13, `docs/NEGATIVE_SCENARIOS.md`'s "CSV Import (Phase 10)" section). `VIEWER` holds none of the four `*:view` permissions that would substitute for `imports:execute`, so it cannot upload, validate, preview, or execute an import at any point.

**PDF/PNG organogram export (Phase 11) is gated end-to-end by `exports:execute` — the permission was already provisioned in Phase 3's role table but unused until now, no new permission was introduced.** Requesting an export, checking a job's status, listing job history, cancelling a job, and downloading the generated file each call `requirePermission("exports:execute")` independently in their own server action (`app/(app)/organogram/export-actions.ts`). There is no separate `/exports` route — the feature is a dialog on the existing `/organogram` page (`organogram-export-dialog.tsx`), and the Export button itself is only rendered when `hasPermission(user, "exports:execute")` (`app/(app)/organogram/page.tsx`'s `canExport` prop) — but per CLAUDE.md §1.8 that's UX only, not the enforcement boundary: a VIEWER who somehow POSTs directly to `requestExportAction` is still rejected server-side. `companyId` is always derived from the authenticated session; an `ExportJob` row belongs to exactly one company, and `downloadExportFile` re-runs the same company-scoped lookup on every single download (never trusting a previously-seen job id alone), so a job id from another company resolves to "not found," never that company's file (`docs/ORGANOGRAM_EXPORT_GUIDE.md`, `docs/NEGATIVE_SCENARIOS.md`'s "PDF/PNG Export (Phase 11)" section, EXP12/EXP13/EXP15/EXP50). The generated file's bytes never appear in `requestExportAction`'s or `getExportJobAction`'s response — only `downloadExportFileAction`'s dedicated, separately-authorized call returns them (EXP51).

**Unauthenticated visitor** (no session, or an `InactiveUserError`/`UnauthenticatedError` from `requirePermission`): redirected to `/sign-in`.
**Authenticated but lacking the permission** (`ForbiddenError`): redirected to `/access-denied`.
**Hidden nav item ≠ blocked route.** `AppShell` filters the visible nav links by permission for UX, but every route above enforces its own check independently of what's shown in the nav — direct URL entry to a route a role lacks permission for is blocked the same as clicking a link would have been (see `docs/NEGATIVE_SCENARIOS.md`'s "hidden-nav direct URL access" scenario).

## 5. Server-Operation Access

Every server action listed below calls `requirePermission(...)` (never a raw role comparison) before touching the repository/service layer, and every mutation derives `companyId` from the authenticated session, never from client input (verified per-action in `app/(app)/*/actions.test.ts`).

| Operation                                                                                                | Who can perform it                                                                                                                                  | Enforcement                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in via Company SSO                                                                                  | Any identity whose email domain (and tenant, if configured) is allow-listed, resolving to a known/auto-provisionable user                           | `lib/auth/config.ts`'s `signIn` callback + `lib/services/user.service.ts`                                                                                                       |
| Auto-provision a new user as `VIEWER`                                                                    | Only if `AUTH_AUTO_PROVISION_VIEWERS=true` **and** exactly one `Company` row exists                                                                 | `lib/services/user.service.ts`'s `resolveOrProvisionUserForSignIn`                                                                                                              |
| Grant/change `ADMIN`/`HR_EDITOR`/`VIEWER`                                                                | Whoever has CLI/deploy access — **no in-app path exists**                                                                                           | `scripts/provision-user.ts` (`add`, `create-admin`, `set-role`)                                                                                                                 |
| Disable/enable a user                                                                                    | Whoever has CLI/deploy access                                                                                                                       | `scripts/provision-user.ts` (`disable`, `enable`)                                                                                                                               |
| Read `getAuthorizedCompanyContext()`'s `companyId`/`userId`/`role`                                       | Any server code needing the current actor's identity — always derived from the session, never from client input                                     | `lib/auth/current-user.ts`                                                                                                                                                      |
| Sign out                                                                                                 | The signed-in user                                                                                                                                  | `lib/auth/actions.ts`'s `signOutAction` (Server Action, form-submitted)                                                                                                         |
| View/create/edit/move/archive/reactivate a Department (Phase 4)                                          | View: `VIEWER`+. Manage: `HR_EDITOR`/`ADMIN` only                                                                                                   | `app/(app)/departments/actions.ts` — `departments:view`/`departments:manage`                                                                                                    |
| View/create/edit/move/archive/reactivate a Position (Phase 5)                                            | View: `VIEWER`+. Manage: `HR_EDITOR`/`ADMIN` only                                                                                                   | `app/(app)/positions/actions.ts` — `positions:view`/`positions:manage`                                                                                                          |
| View/create/edit an Employee; assign/transfer/end-assignment/terminate (Phase 6)                         | View: `VIEWER`+. Manage: `HR_EDITOR`/`ADMIN` only                                                                                                   | `app/(app)/employees/actions.ts` — `employees:view`/`employees:manage`                                                                                                          |
| View the Company Overview dashboard, all roles (Phase 7)                                                 | `VIEWER`/`HR_EDITOR`/`ADMIN`                                                                                                                        | `app/(app)/dashboard/actions.ts` — `dashboard:view`                                                                                                                             |
| View detailed data-quality warnings and inactive/terminated counts on the dashboard (Phase 7)            | `HR_EDITOR`/`ADMIN` only — gated on the existing `employees:manage` permission (deliberately not a new permission; see `docs/DASHBOARD_METRICS.md`) | `lib/services/dashboard.service.ts`'s `canSeeManagementDetails` flag, set from `hasPermission(user, "employees:manage")` in `app/(app)/dashboard/actions.ts`                    |
| Upload/validate/confirm/execute/cancel a CSV import; view job history, error report, template (Phase 10) | `HR_EDITOR`/`ADMIN` only                                                                                                                            | `app/(app)/imports/actions.ts` — `imports:execute`, re-checked at every stage                                                                                                   |
| Request/check status/list/cancel/download a PDF or PNG organogram export (Phase 11)                      | `HR_EDITOR`/`ADMIN` only                                                                                                                            | `app/(app)/organogram/export-actions.ts` — `exports:execute`, re-checked independently on every action including download                                                       |
| List/view audit events (Phase 12)                                                                        | `HR_EDITOR`/`ADMIN`, category-restricted for `HR_EDITOR` (see §4 above)                                                                             | `app/(app)/audit-log/actions.ts` — `audit:view`, category filtering applied in `lib/services/audit.service.ts`, not the action layer                                            |
| Provision a user, change a role, disable/reactivate, link/unlink an Employee (Phase 12)                  | `ADMIN` only                                                                                                                                        | `app/(app)/users/actions.ts` — `users:manage`, re-checked independently on every action; last-admin protection enforced transactionally in `lib/services/user-admin.service.ts` |
| View/update company profile, organogram/export defaults (Phase 12)                                       | `ADMIN` only                                                                                                                                        | `app/(app)/settings/actions.ts` — `settings:manage`; SSO client secret/tokens never readable through any action                                                                 |

## 6. Disabled-User Behavior

A `User.status = "DISABLED"` row is blocked regardless of role — an `ADMIN` set to `DISABLED` is fully locked out, same as a `VIEWER`. Enforcement is independent of, and checked before, the permission check (`requireActiveUser`/`requirePermission` in `lib/auth/current-user.ts`). Because sessions are database-backed (not JWT), this takes effect on the disabled user's very next request — there is no window where a JWT keeps working after `provision-user.ts disable` runs. See `docs/adr/0012-session-and-route-protection.md` §1.

**Since Phase 12, disabling a user via the web UI (`/users`) additionally deletes every `Session` row for that user immediately** (`lib/repositories/user.repository.ts`'s `deleteUserSessions`), on top of the pre-existing "next request re-reads status" propagation above — genuine, immediate revocation, not just eventual. `scripts/provision-user.ts disable` (the CLI path) does not delete sessions explicitly, relying solely on the pre-existing next-request propagation — a minor, pre-existing asymmetry between the two paths, not a security gap (the very next request is still blocked either way).

## 7. Provisioning Rules Summary

- No self-registration exists at any role. Every account is either pre-provisioned (CLI or, since Phase 12, the `/users` web UI) or auto-provisioned (VIEWER only, narrow conditions — §5 above).
- `ADMIN` and `HR_EDITOR` can be granted via `scripts/provision-user.ts` **or**, since Phase 12, the `/users` web UI (`users:manage`, ADMIN-only) — both paths are audited; only the CLI path lacks last-admin protection (a pre-existing gap, `docs/DECISIONS.md` A49). There is still no request path reachable by an unauthenticated or under-privileged caller that can produce either role — see `docs/adr/0014-web-based-user-administration.md` for why adding the web path does not reopen ADR-0011's original concern.
- `scripts/provision-user.ts` refuses every mutating command under `NODE_ENV=production` unless `--yes-i-am-sure-this-is-production` is explicitly passed.
- A company must always have at least one active `ADMIN` — the web UI enforces this transactionally (`lockActiveAdmins`'s row lock) for both role changes and disabling; the CLI does not enforce this itself.
- See `docs/adr/0011-rbac-and-provisioning.md` and `docs/adr/0014-web-based-user-administration.md` for full rationale.

## 8. Future Extension Guidance

- **Adding a permission**: add it to `PERMISSIONS` in `lib/auth/permissions.ts`, add it to the relevant role(s) in `ROLE_PERMISSIONS`, update this document's §2/§3, and add a unit test case in `lib/auth/permissions.test.ts`.
- **Adding a role**: this is a bigger change — it touches the Prisma `UserRole` enum (new migration), `ROLE_PERMISSIONS`, `scripts/provision-user.ts`'s `VALID_ROLES`, this document, and `docs/DECISIONS.md` (another explicit C14-style amendment, not a silent addition).
- **Adding a server action/mutation (Phase 4+)**: it must call `requirePermission`/`requireActiveUser`/`getAuthorizedCompanyContext` from `lib/auth/current-user.ts`, never read `auth()` directly — this keeps every authorization decision routed through one auditable module (`docs/adr/0012...` Consequences).
- **The in-app user-management UI** (`/users`, Phase 12) exists — see `docs/adr/0014-web-based-user-administration.md` for why it's safe alongside ADR-0011's original "auto-provisioning grants VIEWER only" restriction (unchanged). Any FUTURE additional administrative surface (e.g. a public API) must independently re-derive ADR-0014's safety argument — it does not follow automatically just because this one exists.
