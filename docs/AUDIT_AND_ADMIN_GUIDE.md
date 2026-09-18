# Audit Log, User Administration, and Settings Guide

Reference for Phase 12's audit trail, user-administration, and company-settings features. See [docs/adr/0008-audit-strategy.md](adr/0008-audit-strategy.md), [docs/adr/0011-rbac-and-provisioning.md](adr/0011-rbac-and-provisioning.md), [docs/adr/0014-web-based-user-administration.md](adr/0014-web-based-user-administration.md), and [docs/adr/0015-audit-event-model-and-immutability.md](adr/0015-audit-event-model-and-immutability.md) for the design rationale behind everything below.

## 1. Audited Events

Every mutation below writes exactly one `AuditEvent` (or, for a multi-step operation, one event per meaningful step, sharing a `correlationId`):

| Domain              | Actions audited                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Department          | `CREATED`, `UPDATED` (field edit or parent move), `ARCHIVED`, `REACTIVATED`                                                                                                                                                    |
| Position            | `CREATED`, `UPDATED` (field/department/grade edit), `UPDATED` under category `HIERARCHY` (reporting-relationship move), `ARCHIVED`, `REACTIVATED`                                                                              |
| Employee            | `CREATED`, `UPDATED`, `TERMINATED`                                                                                                                                                                                             |
| Assignment          | `ASSIGNED`, `TRANSFERRED`, `ASSIGNMENT_ENDED` (including the one auto-generated when terminating an employee)                                                                                                                  |
| Import              | `IMPORT_VALIDATED`, `IMPORT_EXECUTED`, `IMPORT_FAILED` (one job-level event per stage; per-row Department/Position/Employee/Assignment changes are separately audited under their own domain, attributed to `SYSTEM` — see §7) |
| Export              | `EXPORT_REQUESTED`, `EXPORT_COMPLETED`, `EXPORT_FAILED`                                                                                                                                                                        |
| User Administration | `USER_PROVISIONED`, `ROLE_CHANGED`, `USER_DISABLED`, `USER_REACTIVATED`, `USER_LINKED_TO_EMPLOYEE`, `USER_UNLINKED_FROM_EMPLOYEE`                                                                                              |
| Company Settings    | `SETTINGS_CHANGED` (Company profile or CompanySettings)                                                                                                                                                                        |

`LOGIN_SUCCEEDED`/`LOGIN_REJECTED`/`UNAUTHORIZED_ACCESS_ATTEMPT` exist as defined `AuditAction` enum values for forward compatibility but are not yet wired into `lib/auth/config.ts`'s sign-in callback in this phase — a documented scope boundary (see Known Limitations in the phase report), not an oversight.

## 2. Audit Fields

See `docs/DATA_DICTIONARY.md`'s `AuditEvent` entry for the full field list. Key points:

- `actorDisplayNameSnapshot`/`actorEmailSnapshot` are captured at write time — an audit entry stays fully readable even after the actor's `User` row is later disabled or (hypothetically) removed.
- `beforeData`/`afterData`/`changedFields` are always redacted through `lib/domain/audit/redact.ts` before they ever reach the database — no caller can bypass this.
- `correlationId` groups every event produced by one logical operation (e.g. a single import execution's job-level event and, in future, its per-row events).
- `safeMetadata` is free-form but still passes through the same generic sanitizer (depth/size caps, prototype-pollution guard) as `beforeData`/`afterData`.

## 3. Redaction Policy

`lib/domain/audit/allowlists.ts` defines, per entity type, the ONLY fields that may ever appear in an audit diff — an allowlist, not a denylist (see ADR-0015 for why). Adding a new field to an audited Prisma model does **not** make it visible in the audit trail until it is explicitly added to that entity's allowlist here. When adding a new audited entity type or field:

1. Add the entity's allowlist entry to `AUDIT_FIELD_ALLOWLISTS`.
2. Never include: passwords, tokens/secrets, cookies, connection strings, salary/national-ID/medical data, raw file bytes, or complete uploaded file content.
3. Add a test to `lib/domain/audit/redact.test.ts` proving the new field is included and nothing unapproved leaks alongside it.

## 4. Immutability

Three independent layers (see ADR-0015 for the full rationale):

1. **Application** — `lib/repositories/audit.repository.ts` exports only create/read functions. There is no `updateAuditEvent`/`deleteAuditEvent` to call.
2. **UI** — no edit/delete control exists anywhere in the Audit Log view.
3. **Database** — a `BEFORE UPDATE OR DELETE` trigger (`audit_events_no_update`/`audit_events_no_delete`, added by hand to migration `20260902153408_add_audit_admin_settings`) rejects both operations unconditionally, regardless of which database role issues them.

If a future migration ever touches the `audit_events` table, re-verify these two triggers survive it — dropping and recreating the table without re-adding them would silently remove the database-layer guarantee.

## 5. Transaction Strategy

Per ADR-0008/0015: a REQUIRED audit event (one documenting a business mutation) is always written inside the exact same `Prisma.TransactionClient` as that mutation, via `withTransaction`. If the audit write fails for any reason, the whole transaction — mutation included — rolls back.

The one documented exception: Import's `IMPORT_VALIDATED`/`IMPORT_FAILED` events at the _validation_ stage (not execution) are written as a separate, best-effort call outside any transaction, because validation itself never mutates business data — there is nothing to roll back together with. Import's `IMPORT_EXECUTED` event, in contrast, IS written inside the same transaction as every row change that execution stage applies.

## 6. Audit Visibility by Role

| Role      | Categories visible under `audit:view`                                                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADMIN     | All twelve categories                                                                                                                                                                                                               |
| HR_EDITOR | `DEPARTMENT`, `POSITION`, `HIERARCHY`, `EMPLOYEE`, `ASSIGNMENT`, `IMPORT`, `EXPORT` only — `USER_ADMINISTRATION`/`COMPANY_SETTINGS`/`SECURITY`/`AUTHENTICATION` are invisible (never returned, never erroring to reveal they exist) |
| VIEWER    | No `audit:view` permission at all                                                                                                                                                                                                   |

This is a conservative default (`docs/DECISIONS.md` A47) since no explicit HR decision approved HR_EDITOR seeing user-administration/settings/security events — revisit if HR provides one.

## 7. Import/Export Attribution

Job-level events (`IMPORT_VALIDATED`, `IMPORT_EXECUTED`, `IMPORT_FAILED`, `EXPORT_REQUESTED`, `EXPORT_COMPLETED`, `EXPORT_FAILED`) are attributed to the real requesting user (`ImportJob.requestedByUserId`/`ExportJob`'s `userId`). Import's per-row Department/Position/Employee/Assignment changes, however, are currently attributed to `SYSTEM`, not the importing user — a documented scope boundary (`docs/DECISIONS.md` A48): the job-level event (correctly attributed, with the same `correlationId`) is always sufficient to answer "who ran this import and what happened," and retrofitting per-row attribution would require threading the importing user through every `apply*Row` helper in `import.service.ts`, a larger change deferred to a future phase if per-row attribution is specifically requested.

## 8. User Administration

Two provisioning/administration paths now coexist (ADR-0014):

- **CLI** (`scripts/provision-user.ts`) — unchanged since Phase 3, still the only way to bootstrap the very first ADMIN for a new company, and still un-audited (a pre-existing, documented limitation).
- **Web UI** (`/users`, ADMIN-only via `users:manage`) — provisioning, role changes, disable/reactivate, and Employee linking, all audited, all last-admin-protected.

### Last-Admin Protection

A company must always have at least one active ADMIN. Enforced transactionally: `lockActiveAdmins` takes a `SELECT ... FOR UPDATE` row lock on every currently-ACTIVE ADMIN before checking whether a role change or disable would leave zero — this closes the race where two concurrent requests each target a different one of only two ADMINs.

### Disable/Reactivate

Disabling: sets `status = DISABLED`, deletes every `Session` row for that user (immediate revocation, on top of the database-session strategy's own "next request re-reads status" propagation from ADR-0012), and is rejected if it would leave zero active ADMINs. Reactivating: sets `status = ACTIVE` only — never touches or restores a role.

### Employee Linking

A `User` may optionally link to at most one `Employee` in the SAME company (DB-enforced via a composite FK + a partial unique index — see `docs/DATA_DICTIONARY.md`). Linking/unlinking never changes the User's role, the Employee's assignment, or the Employee's employment status. A terminated Employee cannot be newly linked.

## 9. Settings

One `CompanySettings` row per company, lazily created with safe defaults on first read. Editable: company profile (name/legal name/timezone — never `code`, read-only after setup), organogram defaults (expansion depth, default view, show-planned), export defaults (PDF page size/layout, PNG scale, legend/confidentiality-label defaults, retention days). All numeric/enum fields are validated against explicit bounds or the exact same constants the export pipeline itself uses (`lib/domain/export/types.ts`) — never a duplicated allowlist.

Every settings change is optimistic-concurrency protected (`expectedUpdatedAt`, rejecting with `StaleUpdateError` on a stale write) and unconditionally audited.

## 10. Non-Editable Security Settings

The SSO client ID/secret/issuer, `AUTH_SECRET`, and any provider token are never read, displayed, or accepted anywhere in this application's UI or settings service — they exist only as environment variables (`lib/env.server.ts`). The Settings page's "Company SSO" section shows only three read-only values: provider name, allowed email domains, and whether VIEWER auto-provisioning is enabled.

## 11. Troubleshooting

- **"This company must always have at least one active ADMIN" when I know there are multiple admins**: check `status = ACTIVE` specifically — a `DISABLED` admin doesn't count toward the minimum.
- **A settings save fails with "This record was changed by someone else"**: someone else (or another browser tab) saved after you loaded the page. Reload and retry.
- **An audit event I expect to see is missing from the list**: check the active category/action/date-range filters first (they're cumulative); then check your role — HR_EDITOR cannot see `USER_ADMINISTRATION`/`COMPANY_SETTINGS`/`SECURITY`/`AUTHENTICATION` events at all.

## 12. Known Limitations

- No in-app path exists to permanently delete a `User` or an `AuditEvent` — by design (Phase 12 prompt's own "do not allow" rules).
- The CLI (`scripts/provision-user.ts`) remains un-audited and has no last-admin protection of its own — a pre-existing gap from Phase 3, not newly introduced, and out of this phase's scope to close (see ADR-0014's Consequences).
- Import's per-row Department/Position/Employee/Assignment audit events are attributed to `SYSTEM`, not the importing user (§7) — the job-level event is correctly attributed.
- `LOGIN_SUCCEEDED`/`LOGIN_REJECTED`/`UNAUTHORIZED_ACCESS_ATTEMPT` are defined but not yet wired into the sign-in callback.
- Audit retention/archival policy is an infrastructure-level decision outside this application's scope — this app never deletes an audit event itself, under any circumstance.
- **Organogram/export defaults in `CompanySettings` are stored, validated, and audited this phase, but not yet READ anywhere else** — the interactive organogram still uses its own Phase 8 hardcoded default-collapse logic, and `export.service.ts` still uses its own hardcoded `EXPORT_RETENTION_DAYS`/option defaults, independent of `CompanySettings`'s values (`docs/DECISIONS.md` A50). Wiring these in is a small, low-risk follow-up, not attempted this phase to keep the (already large) Phase 12 scope bounded to what the prompt explicitly required: that the settings be editable, validated, and audited.
