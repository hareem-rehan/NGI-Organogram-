# ADR-0008: Synchronous, same-transaction audit logging

## Status

Accepted (Phase 0)

## Context

Business rule (proposal §9/§10, `docs/PROJECT_SPEC.md` FR-A1) requires every structural mutation to be recorded in an audit log with user, action, timestamp, old value, new value. An async/queued audit approach risks a committed structural change with no corresponding audit entry (if the queue/worker fails), or an audit entry for a change that itself rolled back.

## Decision

`audit.service.record(entry, tx)` writes the `AuditLog` row synchronously, inside the **same** `Prisma.TransactionClient` as the structural mutation it documents (ADR-0005). There is no separate audit queue, background job, or async write path.

## Rationale

- Guarantees the audit trail and the data it describes can never diverge: both commit together or both roll back together.
- Keeps the audit requirement simple to verify in tests — a rollback test can assert zero rows changed across _both_ the entity table and `AuditLog` in one check.
- Avoids operational complexity (a queue, a worker, retry/dead-letter handling) that an internal HR tool at this scale doesn't need.

## Alternatives Considered

- **Async audit logging via a queue/event bus:** rejected for MVP — adds infrastructure and a failure mode (lost or duplicated audit events) with no scale justification at ~2,000 positions and the transaction volume of routine HR changes.
- **Database trigger-based audit logging:** rejected — moves business logic (what counts as "old value"/"new value," which fields matter) out of the application layer and into the database, making it harder to test and reason about alongside the rest of the domain logic in `server/services`.

## Consequences

- Every new mutating service method must remember to call `audit.service.record(...)` with the shared transaction client — this is enforced by code review and the `phase-quality-gate` skill checking for it whenever a phase touches a mutating service.
- If audit volume ever becomes a performance concern at much larger scale, that's a future re-evaluation, not a reason to relax the same-transaction guarantee now.
