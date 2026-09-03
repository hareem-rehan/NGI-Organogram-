# ADR-0002: PostgreSQL + Prisma ORM, with Zod for validation

## Status

Accepted (Phase 0)

## Context

The hierarchy domain has hard relational-integrity requirements: unique codes, self-referencing foreign keys (`Position.reportsToPositionId`), and multi-row atomic updates (moving a branch recalculates every descendant's level in one transaction — `docs/PROJECT_SPEC.md` §7 rule 10). This needs strong transactional guarantees and real foreign-key constraints, not an eventually-consistent or schemaless store.

## Decision

Use PostgreSQL as the database, accessed exclusively through Prisma ORM. Use Zod for input/schema validation, shared between client forms (via React Hook Form's Zod resolver) and server-side validation.

## Rationale

- PostgreSQL gives real FK constraints, unique indexes (case-insensitive via functional indexes/citext where needed for code uniqueness), and `SERIALIZABLE`/`READ COMMITTED` transaction isolation suitable for the atomic hierarchy-move requirement.
- Prisma gives type-safe query building tied directly to the schema, a first-class migration workflow, and an explicit `$transaction` API that maps directly onto ADR-0005's transaction strategy.
- Zod schemas double as both runtime validation and TypeScript types (`z.infer`), keeping client and server validation rules from drifting apart — critical since business rule 12 requires server-side enforcement regardless of what client validation already did.

## Alternatives Considered

- **MongoDB / a document store:** no native FK/relational integrity for the self-referencing hierarchy; would push cycle-prevention and multi-document atomicity entirely into application code with weaker guarantees. Rejected.
- **Raw SQL / a lighter query builder (e.g. Kysely) instead of Prisma:** more control, but higher hand-written boilerplate for migrations and type safety with no clear benefit for this project's scope. Prisma's migration tooling directly supports the phase-by-phase delivery plan.
- **Joi/Yup instead of Zod:** Zod's TypeScript-first inference is a better fit for a fully-typed Next.js + Prisma stack.

## Consequences

- Requires a running PostgreSQL instance for local development and CI integration tests (`docs/TEST_STRATEGY.md`) — no in-memory DB substitute for hierarchy logic tests, since the goal is to catch real constraint/transaction behavior.
- Prisma migrations must be reviewed for destructive changes before `migrate deploy` runs against real data, especially once real HR data is imported.
