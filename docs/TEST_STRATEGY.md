# Test Strategy — Dynamic Organogram Manager

Tooling: Vitest, React Testing Library, Playwright, real PostgreSQL for integration tests (rationale: [ADR-0006](adr/0006-testing-tools.md)).

## 1. Unit-Test Approach

Scope: pure logic with no I/O — level-arithmetic helpers, Zod schema behavior, RBAC policy functions, error-mapping utilities. Runner: Vitest. No database, no network, no filesystem. Fast, run on every save locally and on every CI push.

## 2. Domain-Test Approach

Scope: `server/services/*` business logic — hierarchy invariants (cycle detection, level recalculation), status-transition rules, assignment rules, import validation logic. These call into the real repository layer against a real test database (see §3) because the invariants that matter (atomicity, constraint enforcement) cannot be meaningfully verified against a mock. Treated as integration tests in practice, even though they test "domain" code.

## 3. Database Integration Tests

Scope: repository layer + Prisma schema constraints + transaction/rollback behavior. Run against a real PostgreSQL instance, migrated fresh (or reset via a transaction-rollback-per-test pattern) for isolation between tests. Required for every scenario in [ADR-0005](adr/0005-transaction-strategy.md) (atomic hierarchy move) and [ADR-0008](adr/0008-audit-strategy.md) (audit-and-mutation commit/rollback together). No DB mocking permitted for these tests — see ADR-0006 rationale.

## 4. API / Server-Action Tests

Scope: the boundary between the network/session layer and the service layer — authentication required, authorization enforced, input validated, typed errors returned correctly. These exercise server actions/route handlers directly (not just the service functions underneath), specifically to catch the case where a service is correct but its entry point forgot to call the authorization check ([ADR-0001](adr/0001-nextjs-app-router.md) consequence).

## 5. Component Tests

Scope: forms (React Hook Form + Zod validation surfaced correctly), filters, search input, organogram node/card components, import preview table. Runner: Vitest + React Testing Library. Assert rendered output and user-interaction behavior (typing, submitting, selecting), not implementation details.

## 6. E2E Tests

Scope: the user journeys in `docs/PROJECT_SPEC.md` §9, run with Playwright against a seeded environment with synthetic fixture data. Covers real browser interaction for the React Flow canvas (zoom/pan/expand/collapse, drag on the canvas controls — not drag-and-drop hierarchy editing, which doesn't exist) that can't be meaningfully asserted at the component level alone.

## 7. Permission Tests

Scope: the full Role–Permission Matrix (`docs/PROJECT_SPEC.md` §10) cross-producted with every mutating capability — each cell gets an explicit allow-path test and deny-path test. Run at the API/server-action layer (§4), not just as policy-function unit tests, so a forgotten guard on one endpoint can't hide behind a correct policy function that nothing calls.

## 8. Migration Tests

Scope: every Prisma migration is validated by (a) applying it to a fresh database and confirming the resulting schema matches expectations, and (b) where a migration is non-trivial (renames, backfills), a specific test that seed data survives the migration correctly. Destructive migrations (column drops, type narrowing) require an explicit rollback/backward-compatibility note in the relevant phase report.

## 9. Accessibility Tests

Scope: automated checks (axe-core or equivalent, run against key screens: Overview, Full Organogram, Focus View, forms) plus manual keyboard-navigation and screen-reader spot checks recorded in the phase report for screens automated tooling can't fully cover (canvas-based interaction in particular). Targets: `docs/PROJECT_SPEC.md` §12 (WCAG 2.1 AA, non-color-only status indication, keyboard operability, non-graphical data fallback).

## 10. Security Tests

Scope: authorization bypass attempts (direct API calls skipping the UI), input-injection attempts on every text field and the CSV import path, session/CSRF handling verification, confirmation that no confidential field is present in an API response payload to a role that shouldn't see it (not just hidden client-side — verified at the payload level). Dependency audit (`npm audit` or equivalent) run as a CI stage.

## 11. Performance Tests

Scope: organogram render/interaction and CSV import validation at the ~2,000-position representative scale defined in `docs/DECISIONS.md` P7, measured against the targets in `docs/PROJECT_SPEC.md` §14. Run at minimum once per relevant phase (8, 9, 10, 11) and again as part of Phase 13 hardening against the full combined dataset.

## 12. Regression Strategy

Every phase's full test suite (all layers relevant to that phase) runs in CI on every push, not just the new tests for that phase — a phase cannot introduce a regression in a prior phase's covered behavior and still pass its quality gate. Phase 13 additionally re-runs the entire negative-scenario catalog (`docs/NEGATIVE_SCENARIOS.md`) as one consolidated pass to catch cross-phase interaction bugs (e.g. import-created data behaving differently from manually-created data under hierarchy rules).

## 13. Test-Data Strategy

All test/fixture data is synthetic — no real employee names, emails, or organizational data, ever (`CLAUDE.md` §1.11). Fixtures live under a dedicated `tests/fixtures/` (or equivalent) directory, organized by domain (departments, positions, employees, CSV sample files including intentionally-malformed ones).

## 14. Deterministic Seed-Data Strategy

The seed script (Phase 2 deliverable) produces a fixed, deterministic small hierarchy (a handful of departments, a few dozen positions across 4–5 levels, a mix of Filled/Vacant/Planned/Inactive) used by integration and E2E tests so that test assertions can reference known codes/levels rather than randomly generated ones. A separate, larger deterministic dataset (~2,000 positions, generated by a documented, seedable script — not `Math.random()`/wall-clock-dependent) is used specifically for performance tests (§11).

## 15. Mocking Rules

- **Never mock the database for hierarchy invariant or transaction/rollback tests** (ADR-0006) — these must run against real PostgreSQL.
- Mocking is acceptable for: pure unit tests of logic with no I/O, external boundaries the project doesn't control (if any are introduced later, e.g. an email-sending provider), and isolating a component test from network calls it doesn't need to make.
- Never mock away an authorization check in a test that's supposed to verify authorization.

## 16. CI Testing Stages

Ordered, each stage gating the next:

1. Install / cache dependencies
2. Lint
3. Typecheck
4. Unit tests
5. Integration tests (spin up ephemeral Postgres, run migrations, run tests)
6. Component tests
7. Production build
8. E2E tests (against the built app, seeded environment)
9. Accessibility audit (automated portion)
10. Dependency/security audit

## 17. Blocking vs. Non-Blocking Failures

**Blocking** (fails the phase, per `phase-quality-gate`): lint errors, typecheck errors, any failing unit/integration/component/permission test, build failure, migration failure, any hierarchy-invariant or transaction-rollback test failure, any authorization test failure, any confidential-data-leakage test failure.

**Non-blocking** (recorded in the phase report as a known limitation, does not fail the gate, but must not be silently dropped): E2E flakiness clearly isolated to test-environment timing (documented and ticketed, not just ignored), accessibility findings on a genuinely deferred/out-of-scope feature, performance measurements that are within a documented acceptable margin but worth watching.

Nothing is downgraded from blocking to non-blocking by weakening or deleting the test (`CLAUDE.md` §1.14) — only by fixing the underlying issue or by an explicit, reasoned decision recorded in `docs/DECISIONS.md`.

## 18. Required Evidence Before Phase Completion

Per `CLAUDE.md` §1.15, a phase is not "done" on assertion alone. The phase report must include: the actual commands run, their actual output/summary (pass/fail counts, not "should pass"), and the gate verdict (PASS / PASS WITH NON-BLOCKING ITEMS / FAIL) from `phase-quality-gate`.
