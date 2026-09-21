# ADR-0015: Audit event schema, redaction, and immutability enforcement

## Status

Accepted (Phase 12). Implements [ADR-0008](0008-audit-strategy.md)'s strategy for the first time; extends it with decisions ADR-0008 did not make.

## Context

ADR-0008 established _when_ an audit write happens (synchronously, same transaction as the mutation it documents) but not the event schema, what gets redacted, how HR_EDITOR's category visibility is bounded, or how immutability is enforced beyond "no update/delete service method exists." Phase 12 is the first phase that actually builds the table and write path, so these decisions are made now.

## Decision

1. **Model name is `AuditEvent`**, not `AuditLog` — matching the Phase 12 prompt's field list exactly (`docs/DATA_DICTIONARY.md`'s old placeholder used `AuditLog`; renamed, not aliased, since nothing referenced the old name in code).
2. **Fields**: `id`, `companyId`, `actorUserId` (nullable, for `SYSTEM` events), `actorType` (`USER`|`SYSTEM`), `actorDisplayNameSnapshot`, `actorEmailSnapshot` (both denormalized at write time — see Rationale), `action` (enum), `category` (enum), `entityType`, `entityId`, `entityDisplayReference`, `beforeData`/`afterData`/`changedFields` (JSON, redacted — see below), `correlationId`, `importJobId`/`exportJobId` (optional FKs), `safeMetadata` (JSON), `occurredAt`, `createdAt`. **No `updatedAt`** — immutability by construction (an `updatedAt` column implies an update path exists).
3. **Redaction is centralized in one pure function**, `lib/domain/audit/redact.ts`'s `redactForAudit(value)` — an **allowlist**, not a denylist: any object key not in a small approved set for its entity type is dropped, not merely checked against a list of known-bad names. This is deliberately stricter than the prompt's own enumerated denylist (passwords, tokens, `DATABASE_URL`, etc.) — a denylist only catches names someone thought to list; an allowlist can't leak a field nobody thought of. Recursion is depth-capped (6 levels) and size-capped (8KB serialized) to satisfy the prompt's "reject oversized payloads"/"cap metadata depth and size" requirements, and `__proto__`/`constructor`/`prototype` keys are stripped before any object spread to prevent prototype pollution.
4. **Immutability is enforced at three layers**, not one:
   - **Application**: `lib/repositories/audit.repository.ts` exports only `createAuditEvent`/`createAuditEventsBatch`/read functions — no `update`/`delete` export exists, so no service can call one that doesn't exist.
   - **UI**: no edit/delete control is ever rendered (verified by component tests asserting their absence, not just that a click does nothing).
   - **Database**: a `BEFORE UPDATE OR DELETE` trigger on `audit_events` raises an exception, added by hand to the generated migration (the same "hand-edit the generated SQL" precedent as T14's partial unique indexes) — this protects against a _future_ bug in application code (e.g. someone reaching for `prisma.auditEvent.update` directly), not just the current absence of a code path. **This is a different mechanism from what ADR-0008 rejected.** ADR-0008 rejected using a database trigger to _generate_ audit entries from other tables' mutations (moving business logic into the database). This trigger does the opposite kind of thing — it _blocks_ mutation of an already-written row — and contains no business logic at all, so it does not reintroduce the concern ADR-0008 raised.
5. **HR_EDITOR's `audit:view` is category-restricted**, not all-or-nothing: the query service accepts the caller's role and silently excludes `USER_ADMINISTRATION`/`COMPANY_SETTINGS`/`SECURITY`/`AUTHENTICATION` categories from HR_EDITOR's results (never returns them, never errors — the category simply isn't in scope for that role, same "hidden, not merely disabled" posture the rest of this app uses for out-of-scope data).
6. **A required audit write failing rolls back the mutation it documents** — enforced by construction, since the write happens inside the same `withTransaction` call as the mutation (ADR-0008); there is no separate "catch and continue" path for a critical event. Import/Export batch summary events are the one documented exception (see the Phase 12 report's "Transaction Strategy" section) where a best-effort secondary event is allowed to fail without rolling back an already-committed job-level record, because the job's own row _is_ the durable record of what happened — the batch-level audit event is a convenience index into it, not the only record.

## Rationale

- Denormalizing `actorDisplayNameSnapshot`/`actorEmailSnapshot` at write time means a later-disabled or renamed user doesn't make historical audit entries unreadable ("Missing/deactivated actor remain understandable" — Step 9) — the audit list never needs a live join back to `User` to be meaningful, and never breaks if a `User` row is ever removed (though in practice `User.onDelete: Restrict` already prevents that).
- An allowlist redaction approach is the safer default per CLAUDE.md §5 ("choose the safest reversible default") for a category of bug (secret leakage into an audit trail) that is very hard to fully enumerate in advance and very expensive if missed even once.

## Alternatives Considered

- **Row-level security (Postgres RLS) instead of a trigger:** rejected — RLS is designed for _read_ scoping by role/session, not write-blocking by operation type; a trigger is the correct primitive for "no UPDATE/DELETE, ever, regardless of who's asking."
- **Denylist-based redaction (exactly the prompt's enumerated list):** rejected as the _sole_ mechanism — kept as an explicit test suite (proving every named secret shape is caught) layered _under_ the allowlist, not instead of it.

## Consequences

- Every new field ever added to an audited entity must be explicitly added to that entity's redaction allowlist before it can appear in an audit diff — an omission is invisible in the audit trail (safe by default) rather than a leak, but does mean the allowlist needs updating alongside schema changes; flagged in `docs/AUDIT_AND_ADMIN_GUIDE.md`.
- The immutability trigger must be preserved by any future migration touching `audit_events` — dropping and recreating the table without re-adding it would silently remove the database-layer guarantee; the phase-quality-gate's audit checklist verifies this explicitly.
