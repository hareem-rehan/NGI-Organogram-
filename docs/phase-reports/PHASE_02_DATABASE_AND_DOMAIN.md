# Phase 2 Report — Database and Core Domain Model

Status: COMPLETE

## Phase Objective

Establish a reliable, production-quality PostgreSQL/Prisma data foundation for the organogram: the core domain schema (Company, Department, JobGrade, Position, Employee, PositionAssignment), a framework-independent domain layer enforcing hierarchy and assignment invariants, an idempotent anonymized seed, and a full integration test suite against a real PostgreSQL database. No public CRUD APIs, no UI, no authentication.

## Preflight Findings

- Repository/Git state: clean; Phase 1's foundation intact and all its quality gates re-verified passing before starting (lint, typecheck, unit/component tests, build).
- Read in full: `CLAUDE.md`, `README.md`, `docs/PROJECT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/DATA_DICTIONARY.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/TEST_STRATEGY.md`, `docs/NEGATIVE_SCENARIOS.md`, `docs/phase-reports/PHASE_01_FOUNDATION.md`, all ADRs, and all three project-local skills.
- Approved database/ORM confirmed: PostgreSQL + Prisma (ADR-0002). TypeScript strict mode and Zod confirmed (existing Phase 1 setup).
- **Environment discovery:** Docker was installed but the daemon was not running; started it (`open -a Docker`). An unrelated pre-existing container (`dotzero_postgres`, a different project) was already using host port 5432 — this project's own PostgreSQL was configured on port **5433** specifically to avoid any interference with that unrelated container, per the standing instruction to preserve unrelated user state.
- No critical Phase 1 issue was found that would block database work.

## Database and ORM Confirmation

PostgreSQL 16 (via Docker Compose, `docker-compose.yml`) + Prisma ORM, pinned to `prisma`/`@prisma/client` **6.19.3** — not the `8.0.0-rc.*` "latest" tag, which is a pre-release requiring Node `>=22.18.0` this environment's Node `v21.1.0` doesn't satisfy (same reasoning discipline as Phase 1's dependency pinning). See `docs/DECISIONS.md` §3 and `docs/adr/0009-phase2-domain-model.md`.

## Scope

Prisma schema + initial migration; `lib/domain/*` (pure hierarchy/assignment/normalization logic); `lib/services/*` (transactional, company-scoped orchestration); `lib/repositories/*` (minimal typed data access); `lib/db/prisma.ts` (server-only client singleton) and `lib/db/test-guard.ts` (destructive-operation safety guard); `prisma/seed.ts` (idempotent, anonymized, production-blocked); full integration test suite (`tests/integration/`) against a real Postgres test database; CI extended with a Postgres service; documentation (`docs/DATA_DICTIONARY.md`, `docs/DOMAIN_MODEL.md`, `docs/DECISIONS.md`, `docs/NEGATIVE_SCENARIOS.md`, `docs/adr/0009-*.md`, `README.md`).

## Out of Scope (explicitly not built)

Authentication/authorization, department/position/employee management UI or CRUD APIs, the organogram visualization, CSV import/export, drag-and-drop, dotted-line reporting, the full audit-log module. No placeholder/fake CRUD was added — the domain layer is a library, not an exposed API.

## Proposed → Actual Entities

`Company` (new — Phase 0 assumed single-tenant), `Department` (revised — company-scoped uniqueness, composite self-FK), `JobGrade` (new — was a free-text field in Phase 0), `Position` (revised — corrected status model, composite FKs, computed level), `Employee` (revised — no `positionId` column), `PositionAssignment` (new — replaces the direct FK Phase 0 sketched). Full field-level detail: `docs/DATA_DICTIONARY.md`. Full narrative/ERD: `docs/DOMAIN_MODEL.md`.

## Proposed → Actual Relationships

Every cross-entity relationship that could theoretically cross companies uses a **composite foreign key** against `(id, companyId)`, not just `id` — see `docs/DOMAIN_MODEL.md` §3 and §7. This makes cross-company references a database-level impossibility, not just an application-level check.

## Hierarchy Strategy

Position-based, position-to-position primary reporting only (no dotted-line). Cycle prevention via ancestor-chain walk (`lib/domain/hierarchy.ts`'s `wouldCreateCycle`) inside the same transaction as every write. Root uniqueness enforced by a partial unique index (`primaryReportsToPositionId IS NULL`), not just application logic. Full detail: `docs/DOMAIN_MODEL.md` §5, §7.

## Position Vacancy Strategy

Never stored. Always derived from `PositionAssignment` (`isPrimary=true`, date range covers "now" or a given date). `Position.status` is lifecycle-only. This is a direct, documented amendment to Phase 0's Confirmed Decision C12 — required by this phase's explicit instruction ("do not use FILLED as the only source of truth"). Full detail: `docs/DOMAIN_MODEL.md` §4, `docs/DECISIONS.md` C12 amendment, `docs/adr/0009-phase2-domain-model.md`.

## Organizational-Level Calculation Strategy

Computed (`lib/domain/hierarchy.ts`'s `calculateLevel`/`recalculateSubtreeLevels`), persisted to `Position.organizationalLevel`, recalculated for a moved position and its **entire** descendant subtree inside one transaction. Never client-settable — no service function accepts it as input.

## Deletion and Archival Strategy

Archive (`status = INACTIVE`) is the normal, always-safe workflow (row persists, all FKs remain valid). Hard delete exists only as a defensive/tested code path, rejected by `ON DELETE RESTRICT` the moment any dependent row exists, with a clean typed-error translation layer so callers never see a raw Postgres error. Full detail: `docs/DOMAIN_MODEL.md` §8.

## Transaction Strategy

Every multi-step mutation (`createPosition`, `movePosition`, `createDepartment`/`moveDepartment`, `createAssignment`, `transferEmployee`) runs inside `prisma.$transaction(...)`. Assignment creation additionally takes a `SELECT ... FOR UPDATE` row lock on the target position to serialize concurrent attempts before the overlap check runs. See `docs/DOMAIN_MODEL.md` §7 for the full per-rule enforcement-layer table (application / transaction / database).

## Migration Strategy

One initial migration (`prisma/migrations/20260901094021_init/`), generated via `prisma migrate dev --create-only` then hand-extended with: two `CHECK` constraints (no self-report, no self-parent), one `CHECK` constraint (`endDate >= startDate`), and three partial unique indexes (one root per company; one open-ended primary assignment per position; per employee) — all documented inline in the migration SQL and in `docs/adr/0009-phase2-domain-model.md`. Applied successfully to both a fresh dev database and a fresh, separately-created test database (`prisma migrate deploy`).

## Seed-Data Strategy

`prisma/seed.ts` — idempotent (every record upserted by its natural unique key; assignments checked-then-created), blocked outside `NODE_ENV=development|test`, entirely fictional (no real names/emails — `@northwind-example.test` domain). Produces: 1 company, 5 departments (including one nested), 3 job grades, 12 positions (5-level deep branch, parallel siblings, 1 vacant, 1 planned), 10 employees, 11 assignments (including one ended/historical, demonstrating a real transfer). Verified idempotent by running 3 times with stable row counts.

## Security and Privacy Considerations

- `DATABASE_URL` is server-only (enforced by the `server-only` package on both `lib/env.server.ts` and `lib/db/prisma.ts`, each with its own boundary test).
- No raw database/Prisma errors ever escape a service function — every service has a `translateWriteError`/equivalent that maps known Postgres error codes to clean typed errors and falls back to a generic message otherwise.
- Seed data is 100% fictional, verified by an automated test asserting every seeded work email matches the fictional domain.
- `lib/db/test-guard.ts` refuses any destructive test operation against a database that doesn't clearly look like a disposable test database.

## Risks

- Node v21.1.0 (non-LTS) again required careful dependency pinning (Prisma 6.19.3, not the 8.x RC) — documented, same pattern as Phase 1.
- A known, low-severity `npm audit` finding (`deepmerge-ts` stack-exhaustion via the `prisma` CLI's config loader, not `@prisma/client`) is accepted rather than fixed — see "Security Findings" below.
- The general (non-open-ended) date-range overlap check is application/transaction-level, not a database constraint (Postgres exclusion constraints would need the `btree_gist` extension) — documented explicitly as a real, accepted layering gap in `docs/DOMAIN_MODEL.md` §7.

## Test Plan

Real PostgreSQL for every integration test (no mocked DB for hierarchy/transaction logic, per ADR-0006). Pure domain logic (`lib/domain/*`) unit-tested in isolation (no DB, no Prisma import). See `docs/TEST_STRATEGY.md` for the layer definitions this follows.

## Negative-Scenario Matrix

34 scenarios (D1–D34) in `docs/NEGATIVE_SCENARIOS.md` §"Database and Domain Model (Phase 2)", each with precondition/action/expected-result/enforcement-layer/test-level/status and a concrete test-file reference. One (D30, orphaned hierarchy data) is marked genuinely not-applicable with a stated reason (structurally unreachable given FK constraints + cycle prevention); two (D25 database unavailable, D26 migration failure) are marked manual with a specific description of what was actually done, not merely asserted.

## Acceptance Criteria

- [x] PostgreSQL configuration operational (Docker Compose, dev + test databases)
- [x] `prisma validate` succeeds
- [x] Initial migration exists and applies to an empty database (both dev and a freshly-created test database)
- [x] Company / Department / Position / Employee / PositionAssignment models exist
- [x] Job Grade implemented (not omitted)
- [x] Positions exist independently from employees (no `positionId` on Employee)
- [x] Vacancy derived, never stored
- [x] Primary hierarchy is position-based
- [x] Organizational level calculated, never client-settable
- [x] Job grade independent of organizational level
- [x] Self-reporting rejected (app + DB `CHECK`)
- [x] Indirect hierarchy cycles rejected (app, ancestor-chain walk)
- [x] Cross-company reporting rejected (composite FK)
- [x] Unsafe deletion prevented (`ON DELETE RESTRICT` + clean error translation)
- [x] Assignment date rules enforced (app + DB `CHECK`)
- [x] Overlapping primary assignments rejected (app overlap check + DB partial unique index for the open-ended case)
- [x] Employee transfer preserves history (verified: ended assignment row persists with its `endDate`)
- [x] Concurrency protection implemented and tested (partial unique index + row lock; concurrent-insert test proves exactly one winner)
- [x] Seed data anonymized and idempotent (verified 3×)
- [x] Seed blocked in production (verified via actual CLI run with `NODE_ENV=production`)
- [x] Database integration tests pass (72/72)
- [x] CI runs database tests (Postgres service added to `.github/workflows/ci.yml`)
- [x] Documentation matches implementation (`docs/DATA_DICTIONARY.md`, `docs/DOMAIN_MODEL.md` rewritten to match the actual schema; every Phase 0 discrepancy called out, not silently changed)
- [x] Quality gates pass (format, lint, typecheck, unit tests, integration tests, build)
- [x] No Phase 3 authentication work started
- [x] No management UI or organogram visualization started

## Rollback Approach

The migration is additive only (new tables; no changes to Phase 1 files beyond `lib/env.ts` making `DATABASE_URL` required — itself a documented, tested change). To roll back Phase 2 entirely: `docker compose down -v` removes the local Postgres volume; `git revert`/`git reset` the added files. No production data exists to migrate back, since this phase never touched a real database.

---

## Commands Executed (with actual results)

| Command                                                                                       | Result                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up -d`                                                                        | Created isolated network/volume; `organogram_postgres_dev` on port 5433, healthy                                                                                           |
| `npx prisma format` / `npx prisma validate`                                                   | Pass                                                                                                                                                                       |
| `npx prisma migrate dev --create-only` then hand-edited, then `npx prisma migrate dev`        | Migration `20260901094021_init` applied cleanly to `organogram_dev`                                                                                                        |
| `npx dotenv -e .env.test -- npx prisma migrate deploy`                                        | Same migration applied cleanly to a freshly-created `organogram_test`                                                                                                      |
| `NODE_ENV=development npx tsx prisma/seed.ts` (×3)                                            | Succeeds; row counts identical across all 3 runs (idempotent)                                                                                                              |
| `NODE_ENV=production npx tsx prisma/seed.ts`                                                  | Refused immediately, exit code 1, clear message                                                                                                                            |
| `npx tsc --noEmit`                                                                            | 0 errors                                                                                                                                                                   |
| `npx eslint .`                                                                                | 0 errors, 0 warnings                                                                                                                                                       |
| `npx prettier --check .`                                                                      | All files formatted                                                                                                                                                        |
| `npx vitest run` (unit/component)                                                             | **24 files, 119 tests, all passing**                                                                                                                                       |
| `npx vitest run --coverage` (unit/component)                                                  | 48.53% overall — see "Coverage Summary" below for why this number alone is misleading                                                                                      |
| `npx dotenv -e .env.test -- npx vitest run --config vitest.integration.config.mts --coverage` | **7 files, 72 tests, all passing**; 87.42% statement coverage on `lib/repositories`+`lib/services`+`lib/db`+`prisma/seed.ts`                                               |
| `npm run build`                                                                               | Success — all 11 routes built, no regression from Phase 1                                                                                                                  |
| `npx playwright install chromium`                                                             | **Not re-attempted** — already documented as failing in this sandbox in Phase 1 (persistent network limitation, unrelated to Phase 2); browser cache confirmed still empty |

## Coverage Summary

Two separate coverage runs, because `lib/repositories`/`lib/services` require the `react-server` resolve condition (only set in the integration Vitest config) to load past their `server-only` guards:

- **Unit/component suite** (`vitest.config.mts`): 119 tests. New pure `lib/domain/*` modules (`hierarchy.ts`, `assignment.ts`, `normalize.ts`) are **100% covered**. `lib/db/prisma.ts`/`lib/db/test-guard.ts` are covered for their boundary-guard behavior; `lib/repositories`/`lib/services` show 0% _in this report only_ because they're exercised exclusively by the integration suite (not a real gap).
- **Integration suite** (`vitest.integration.config.mts`): 72 tests, **87.42% statements / 71.15% branches / 80.85% functions** across `lib/repositories`, `lib/services`, `lib/db`, and `prisma/seed.ts`. Uncovered lines are mostly secondary error-translation branches (specific Prisma error-code paths not independently exercised by a dedicated test) and `test-guard.ts` branches already exhaustively covered by its own dedicated unit test file — not exercised again here since `setup.ts` only calls it once on the happy path.

## Security Findings

- Verified (automated, `security-and-privacy.integration.test.ts`): no `DATABASE_URL`, password, or `postgres://` string ever appears in a thrown error or in `console.log`/`console.error` output during normal service operation.
- Verified (automated, boundary tests): `lib/env.server.ts` and `lib/db/prisma.ts` both throw when imported outside a server context.
- **Known, accepted `npm audit` finding:** `deepmerge-ts <8.0.0` (stack-exhaustion DoS, GHSA-ggr8-5vv4-36mx), pulled in by `@prisma/config` (a dependency of the `prisma` CLI, not `@prisma/client`). The only fix (`npm audit fix --force`) downgrades `prisma` to 6.12.0, losing several patch versions, for a vulnerability that requires merging attacker-controlled deeply-recursive config objects — not a code path any part of this application reaches (it's a build/CLI-time-only tool dependency, never bundled into the running app). Accepted for the same reasoning as Phase 1's Vite/esbuild finding.

## Known Limitations

- Playwright E2E/accessibility verification remains blocked by the same sandbox network limitation documented in Phase 1 (Chromium binary download fails); unrelated to Phase 2's changes. Unit/component/integration suites (191 tests total) provide the verification evidence for this phase instead.
- General (non-open-ended) date-range overlap for historical assignments is enforced at the application/transaction layer, not a database constraint — a real, documented layering choice (see `docs/DOMAIN_MODEL.md` §7), not an oversight.
- Department `color` format and Company `timezone` validity are application-layer checks only — no user-facing input path exists yet to violate them (no CRUD UI ships until Phase 4).

## Gate Result

**PASS.** All acceptance criteria met with real verification evidence. The one carried-over non-blocking item (Playwright/E2E) is a documented, unrelated environment limitation, not a Phase 2 defect.

## Recommended Next Phase

Per the user's own instructions, **Phase 3: Company SSO, Authentication, RBAC, and Security Foundation** — building the `User`/session model on top of this phase's `Company`/`Employee` entities, and centralized server-side authorization utilities that the eventual Phase 4/5 CRUD screens will depend on.
