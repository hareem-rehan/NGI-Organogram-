# ADR-0006: Vitest + React Testing Library + Playwright, real Postgres for integration tests

## Status

Accepted (Phase 0)

## Context

`CLAUDE.md` §1.7 and §1.14 require tests to ship in the same phase as the code they cover and forbid weakening tests to force a pass. The domain has non-trivial invariants (cycle detection, level recalculation, atomic rollback) that are easy to get subtly wrong and need to be verified against real database transaction behavior, not mocks.

## Decision

- **Unit tests:** Vitest, for domain/service logic and RBAC policy functions.
- **Integration tests:** Vitest, run against a real PostgreSQL test database (via Prisma, migrated fresh per test run/suite) — no mocked ORM/DB layer for anything touching hierarchy invariants or transactions.
- **Component tests:** Vitest + React Testing Library, for forms, filters, and organogram node components.
- **End-to-end tests:** Playwright, for the user journeys in `docs/PROJECT_SPEC.md` §9, run against a seeded test environment.

## Rationale

- Vitest is fast and has first-class TypeScript/ESM support matching the Next.js/Prisma stack; no reason to introduce Jest alongside it.
- Mocking the database for hierarchy-invariant tests would let a broken transaction or constraint pass its own test while still corrupting real data — the entire point of ADR-0005's transaction strategy is to rely on real DB guarantees, so the tests must exercise the real DB to mean anything.
- Playwright covers real browser interaction for the organogram's canvas-based UI (React Flow), which is hard to meaningfully test at the component level alone (pan/zoom/drag interactions, actual rendered layout).

## Alternatives Considered

- **Jest instead of Vitest:** comparable capability; Vitest was chosen for tighter Vite/ESM/TS alignment with the rest of the stack and faster local iteration. Not a strong-conviction choice — revisit only if a real blocker appears.
- **Mocked Prisma Client for all tests (e.g. `prisma-mock`):** rejected for hierarchy/transaction logic specifically (see Rationale); acceptable for pure unit tests of logic with no DB interaction (e.g. a level-arithmetic helper function).
- **Cypress instead of Playwright:** comparable; Playwright chosen for native multi-browser support and first-class TypeScript integration.

## Consequences

- CI needs a disposable/ephemeral PostgreSQL instance for integration tests (`docs/TEST_STRATEGY.md` §CI stages) — this is a required piece of Phase 1/2 setup, not optional tooling.
- Integration and E2E tests will be slower than a fully-mocked suite; the `phase-quality-gate` skill treats them as blocking for phases that touch hierarchy/auth logic regardless of runtime cost.
