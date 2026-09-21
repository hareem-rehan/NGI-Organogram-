# ADR-0005: Transaction strategy for hierarchy mutations

## Status

Accepted (Phase 0)

## Context

Business rule 10 (`docs/PROJECT_SPEC.md` §7) requires that moving a position — updating its parent and recalculating its level and every descendant's level — happens atomically, with full rollback on any failure. CSV import commits (FR-I2) and employee assignment (which flips position status) have the same "all writes succeed together, or none do" requirement.

## Decision

Any service method that performs more than one related write to the hierarchy (Position, Employee-assignment, or AuditLog tables) must wrap all of those writes in a single `prisma.$transaction(...)` call. Repository methods used inside such a flow accept an optional `Prisma.TransactionClient` so they can be composed into the caller's transaction rather than opening their own.

## Rationale

- Prisma's `$transaction` API maps directly onto PostgreSQL transactions, giving real atomicity and rollback — not an application-level "undo" that could itself fail partway through.
- Requiring the transaction client to be threaded through repository calls (rather than each repository method managing its own transaction) makes it structurally impossible for a service to "forget" to include a write in the atomic unit — the calling code has to explicitly decide which client is passed in.
- Writing the `AuditLog` entry inside the same transaction (ADR-0008) means a committed structural change and its audit trail can never disagree.

## Alternatives Considered

- **Application-level compensating actions (try each write, manually undo on failure):** rejected — significantly more error-prone than a real DB transaction, and doesn't protect against concurrent readers seeing a half-updated hierarchy mid-operation.
- **Optimistic, per-row updates with a background consistency-check job:** rejected — introduces a window where the hierarchy is genuinely inconsistent, which the product explicitly must prevent (business rule 10, and the "Concurrent hierarchy moves" negative scenario in `docs/NEGATIVE_SCENARIOS.md`).

## Consequences

- Every hierarchy-mutating service method needs an integration test that asserts a mid-operation failure (e.g. a simulated DB error on the second write) leaves the database completely unchanged — this is a required test category in `docs/TEST_STRATEGY.md` and the `organogram-hierarchy-safety` skill.
- Long-running descendant-recalculation transactions (very large subtrees) need to be measured in Phase 5; if transaction duration becomes a problem at scale, the mitigation is batching descendant updates within the same transaction, not abandoning atomicity.
