# ADR-0009: Phase 2 domain-model decisions (Company scoping, JobGrade entity, PositionAssignment, status-model amendment, concurrency)

## Status

Accepted (Phase 2)

## Context

Phase 0 sketched a single-tenant data model (no `Company` entity), a free-text `jobGrade` string on `Position`, a direct `Employee.positionId` FK, and a `Position.status` enum (`FILLED`/`VACANT`/`PLANNED`/`INACTIVE`) that conflated HR-set lifecycle with system-derived occupancy. The Phase 2 task brief explicitly required: an explicit `Company` entity (multi-tenant-ready schema, no multi-tenant access control yet), a dedicated `PositionAssignment` model rather than a direct FK, and — critically — "do not use FILLED as the only source of truth if occupancy is derived from active assignments."

## Decision

1. **`Company`** is a first-class entity. Every domain table carries `companyId`. No cross-company access control is implemented yet (that's Phase 3's job) — this is purely a data-scoping decision.
2. **`JobGrade`** is a normalized entity (`id`, `companyId`, `code`, `name`, `status`), company-scoped unique code, referenced by `Position.jobGradeId`. Independent of `organizationalLevel` — never derived from it, per the standing business rule.
3. **`PositionAssignment`** is a dedicated join entity between `Employee` and `Position`, carrying `isPrimary`, `startDate`, `endDate`. `Position` has no `employeeId` column at all.
4. **`Position.status`** is now lifecycle-only: `PLANNED | ACTIVE | INACTIVE`. `FILLED`/`VACANT` are removed as stored values — occupancy is always computed from whether an `ACTIVE`-status position has an open-ended (`endDate IS NULL`) primary `PositionAssignment`. This is a direct, documented amendment to Phase 0's Confirmed Decision C12 (see `docs/DECISIONS.md`).
5. **Company-scoped composite foreign keys**: self-referencing and cross-entity relationships (`Position.departmentId`, `Position.jobGradeId`, `Position.primaryReportsToPositionId`, `PositionAssignment.employeeId`, `PositionAssignment.positionId`) all reference a compound `(id, companyId)` unique key on the target table, not just `id`. A row in company A can never be linked to a row in company B — the database rejects it, not just the application.
6. **Concurrency-safe uniqueness via partial unique indexes**, hand-added to the generated migration SQL (Prisma's schema DSL has no syntax for `WHERE`-qualified unique indexes):
   - `positions_one_root_per_company`: at most one position with `primaryReportsToPositionId IS NULL` per company.
   - `position_assignments_one_open_primary_per_position` / `..._per_employee`: at most one row with `isPrimary = true AND endDate IS NULL` per position / per employee.

## Rationale

- A stored, redundant "FILLED"/"VACANT" value can drift from the actual assignment data (an assignment ends, nobody updates the position row) — the exact failure mode the task brief called out. Deriving it at query time makes drift structurally impossible.
- A join table (rather than a single FK) is the only design that can hold assignment history (a former occupant's tenure) without deleting or overwriting it, satisfying "employee transfer must not delete the position" and "historical assignments should not be destroyed."
- Composite FKs turn "cross-company reporting/assignment is forbidden" from an application-level convention (which a future forgotten check could violate) into a database constraint that fails closed by construction.
- A naive "check for an existing active assignment, then insert" has a race condition — two concurrent requests can both pass the check before either commits. A partial unique index makes the database itself the tiebreaker: exactly one concurrent insert can win, and the loser gets a clean, catchable `ConflictError` (verified in `tests/integration/employee-and-assignment.integration.test.ts`'s concurrency test).

## Alternatives Considered

- **Keep `FILLED`/`VACANT` as stored, HR-set values:** rejected outright — this is precisely the anti-pattern the task instructed against, and Phase 0's own data dictionary already conceded these should be "derived," just hadn't acted on it yet.
- **Enforce "one active assignment" only at the application layer (no partial index):** rejected — doesn't close the concurrency race; two simultaneous requests could both succeed and leave two people "actively" assigned to one position.
- **Skip company scoping since the MVP is single-company:** rejected per the explicit task instruction to keep company ownership explicit even before multi-tenant access control exists; retrofitting `companyId` onto every table later would be a far more invasive migration than including it now.

## Consequences

- Every service function that creates or moves a `Position`/`PositionAssignment` must resolve and pass an explicit `companyId` — there is no implicit "current company" yet (that arrives with authentication in Phase 3).
- Reading "is this position vacant" always requires a query (`getActivePrimaryAssignmentForPosition`), never a simple column read — this is documented in `docs/DOMAIN_MODEL.md` §4 so future phases don't reintroduce a cached/stored vacancy flag without realizing why one doesn't already exist.
- The two new partial-unique-index migrations must be preserved by hand in any future migration that touches these tables — Prisma's own diffing cannot detect or regenerate them if they were ever accidentally dropped from a schema squash.
