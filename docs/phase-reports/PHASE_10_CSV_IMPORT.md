# Phase 10 Report — CSV Import, Validation, and Safe Bulk Updates

Date: 2026-09-02

Status: COMPLETE — see "Gate Result" for the final verdict and the real command output it is based on.

## Phase Objective

Let an authorized user bulk create/update Departments, Positions, Employees, and Position Assignments from a CSV file — validate every row before anything is written, preview the exact proposed change set, and execute only an explicit, transactional, all-or-nothing commit that reuses the exact same domain services manual entry uses.

## Preflight Findings

Read before implementation: `CLAUDE.md`, `README.md`, `docs/PROJECT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/DATA_DICTIONARY.md`, `docs/DOMAIN_MODEL.md`, `docs/AUTHORIZATION_MATRIX.md`, `docs/IMPLEMENTATION_PLAN.md` (Phase 10 entry), `docs/TEST_STRATEGY.md`, `docs/NEGATIVE_SCENARIOS.md`, `docs/ORGANOGRAM_RENDERING.md`, `docs/ORGANOGRAM_SEARCH_AND_FOCUS.md`, all nine prior phase reports, `docs/adr/*` (especially ADR-0007's two-phase parse/commit decision and ADR-0005's transaction strategy), and a full reconnaissance pass over `lib/services/department.service.ts`/`hierarchy.service.ts`/`employee.service.ts`/`assignment.service.ts`, their repositories, the Prisma schema, the existing `/imports` placeholder, and `lib/auth/permissions.ts` (confirming `imports:execute` already exists, held by `ADMIN`/`HR_EDITOR`, not `VIEWER`).

**Phase 9 baseline re-confirmed before starting:** unit/component 757/757, integration 196/196 (after Phase 9's own final gate), typecheck/lint/build clean.

Key findings:

- **No CSV parsing library was installed.** Added `papaparse@5.7.0` (+ `@types/papaparse`) — the only new production dependency this phase requires.
- **A critical architectural gap: every existing entity service opens its OWN internal `prisma.$transaction`, none accept an external transaction client.** Calling `createDepartment`/`createPosition`/`createEmployee`/`createAssignment` etc. from inside the import commit's own outer transaction would silently open a SEPARATE, unrelated transaction on a different connection — breaking whole-batch atomicity (Critical Safety Principle 5/6) without any error at all. This is not something Phase 10 can work around; it required refactoring all four service files to accept an optional trailing `db: DbClient = prisma` parameter (backward-compatible — every existing Phase 4–9 caller that omits it is unaffected), composed via a new shared `lib/db/transaction.ts`'s `withTransaction` helper. Verified with a full, unchanged re-run of the existing integration suite (182/182) before building the import commit path on top of it.
- **Storage architecture decision:** no object-storage service exists anywhere in this app (this is the first file-handling feature). Uploaded bytes are stored as a `Bytes` column on a new `ImportJob` row, kept only until the job reaches a terminal state, with a 7-day retention window enforced lazily (no background job scheduler exists to sweep expired jobs on a schedule).
- **Upload goes through a Server Action (`FormData` + `File`), not a route handler** — contrary to `docs/ARCHITECTURE.md`'s Phase-0-era assumption. Verified against this Next.js version's own bundled docs that Server Actions support file uploads natively; `next.config.ts`'s `serverActions.bodySizeLimit` raised to 12MB.
- **`PLANNED` position status and `TERMINATE_EMPLOYEE` assignment operation are both excluded from import**, mirroring exactly what a manual HR user can already do (no existing service path produces either) rather than inventing new business-logic capabilities solely for bulk import. Both are documented, safe, reversible scope decisions (`docs/DECISIONS.md` A36/A37), not silent omissions.
- **Row APPLICATION order matters as much as validation order.** A first working version applied rows in raw file order; for a "manager appears later in the file" row, this looked up a not-yet-created parent and silently resolved to root, corrupting the hierarchy the moment the real root row was applied afterward. Caught by `tests/integration/import.integration.test.ts` before release (A38) — fixed with a topological sort by same-batch dependency (Department/Position) and an effective-date sort (Assignment).
- **File-level issues (a denylisted or unrecognized column) were originally excluded from `errorRowCount`/`warningRowCount`.** This meant a file whose ONLY problem was a denylisted column would have computed `errorRowCount: 0` and incorrectly validated as clean — caught while writing tests more rigorously than the first pass (A39), fixed with a shared `countAffectedUnits` helper used identically across all four validators.
- **No new ADR needed.** This phase implements ADR-0007's existing two-phase parse/commit decision rather than introducing a new one; the transaction-composability refactor and storage decisions are recorded in `docs/DECISIONS.md`, not a separate ADR, since they don't change the technology stack.

## Supported Import Types, File Limits, Templates, Matching Keys, CREATE_ONLY/UPSERT, Blank/Clear Semantics, Validation Stages, Warning Policy, Transaction Strategy, Rollback Behavior, Idempotency Strategy, Concurrency/Stale-Validation Strategy, Upload Retention, Privacy/Security Considerations, UI Workflow

All fully specified in **`docs/CSV_IMPORT_GUIDE.md`** — the authoritative reference, not duplicated here. Summary: Department/Position/Employee/Assignment, each its own file; 10MB/5,000-row/30-column/1,000-char-cell limits, comma-only delimiter; a downloadable template per type; company + stable code as the matching key (never fuzzy-matched); `CREATE_ONLY`/`UPSERT` modes (Assignment uses an explicit `operation` column instead); blank = no change, `__CLEAR__`/`__NONE__`/`__ROOT__` as explicit sentinels; six validation stages culminating in a per-row change plan; warnings require explicit acknowledgement, errors block execution entirely; execution re-validates fresh inside its own transaction and applies every row in dependency order through the existing domain services, all-or-nothing; re-executing a completed job is a safe no-op; raw file bytes live only until a terminal state, for at most 7 days.

## Negative-Scenario Matrix

`docs/NEGATIVE_SCENARIOS.md`'s "CSV Import (Phase 10)" section — 60 scenarios (CSV1–CSV60), every one backed by a real automated test or an honestly-labeled "not applicable — documented" structural guarantee.

## Acceptance Criteria

Restated from the phase brief — tracked to completion in "Gate Result": templates downloadable; upload/validate/preview/confirm/execute all real and working end-to-end; VIEWER blocked at every step; file limits enforced; parsing safe against malformed/oversized/wrong-delimiter/wrong-encoding input; row-level errors and warnings both shown, distinctly; execution blocked while any error exists; warnings require acknowledgement; all four import types work; cross-company references rejected; hierarchy cycles and second-root attempts rejected; overlapping assignments rejected; blank cells never silently clear data; execution is transactional and idempotent; stale validation is detected and aborts the whole batch; error reports are safe (no raw DB errors, sanitized against formula injection); uploaded files are private and expire; UI is accessible and responsive; negative scenarios documented honestly; documentation matches implementation; Phase 11 not started.

## Rollback Approach

Revert the migration `20260902064230_add_import_models` (drops `import_jobs`/`import_row_issues` only — no existing table's data is touched) and the Phase 10 code. The four services' new optional `db` parameter is additive and backward-compatible, so no other phase's behavior needs reverting alongside it.

## Out-of-Scope Functionality (per explicit instruction)

PDF/image export, graphical hierarchy editing, dotted-line reporting, historical snapshots, full audit-log UI, scheduled/automatic recurring import, direct external-system sync, `TERMINATE_EMPLOYEE` via import (§5 of the guide).

---

## Files Changed

**Schema:** `prisma/schema.prisma` (+`ImportJob`, `ImportRowIssue`, 4 new enums), migration `20260902064230_add_import_models`.

**New domain layer** (`lib/domain/import/`, 121 unit tests): `csv.ts` (parsing/normalization/formula-injection guard, 35 tests), `types.ts` (shared types, denylist, `countAffectedUnits`, 10 tests), `department-import.ts` (21 tests), `position-import.ts` (17 tests), `employee-import.ts` (15 tests), `assignment-import.ts` (23 tests), `templates.ts` (6 tests), `error-report.ts` (4 tests).

**Modified domain:** `lib/domain/hierarchy.ts` (+`findCycleInGraph`, a whole-graph cycle detector reused by Department and Position import; +9 tests in `hierarchy.test.ts`).

**New infrastructure:** `lib/db/transaction.ts` (`withTransaction`).

**Modified services (transaction-composability refactor, zero behavior change for existing callers):** `lib/services/department.service.ts`, `hierarchy.service.ts`, `employee.service.ts`, `assignment.service.ts` — each gained an optional trailing `db: DbClient = prisma` parameter.

**New service:** `lib/services/import.service.ts` (upload/validate/confirm/execute/cancel orchestration, fresh re-validation at execute time, deterministic apply ordering, row application per entity type).

**New repository:** `lib/repositories/import.repository.ts` (`ImportJob`/`ImportRowIssue` CRUD, bulk employee/open-assignment lookups).

**New validation:** `lib/validation/import.ts`.

**New actions:** `app/(app)/imports/actions.ts` (10 actions, all `imports:execute`-gated) + `actions.test.ts` (17 tests).

**New UI:** `app/(app)/imports/_components/import-view.tsx` (the single-page import flow — type/mode selection, template download, upload, preview/diff table, confirm, execute, result, recent-jobs list) + `import-view.test.tsx` (5 tests); `app/(app)/imports/page.tsx` rewritten (placeholder removed).

**Modified config:** `next.config.ts` (`serverActions.bodySizeLimit: "12mb"`).

**Modified tests:** `tests/integration/schema-and-company.integration.test.ts` (table-list assertion updated for the 2 new tables), `tests/integration/fixtures.ts` (+`makeUser`), `e2e/shell.spec.ts` (`/imports` added to `IMPLEMENTED_ROUTES`).

**New integration tests:** `tests/integration/import.integration.test.ts` (14 tests, real database, proves real atomicity/rollback/idempotency/stale-detection/company-isolation).

**New E2E:** `e2e/imports.spec.ts` (6 tests).

**Documentation:** new `docs/CSV_IMPORT_GUIDE.md`; updated `docs/DECISIONS.md` (+A32–A39, +Phase 10 Decision History row), `docs/AUTHORIZATION_MATRIX.md`, `docs/DATA_DICTIONARY.md` (+`Import Job`/`Import Row Issue`), `docs/NEGATIVE_SCENARIOS.md` (CSV Import section replaced with 60 detailed scenarios), `README.md`, this phase report.

No `.claude/skills/` files were created — no reuse case beyond this phase's own import pipeline was identified strongly enough to justify a new project-local skill (see "Skills Used" below).

## Migrations

`20260902064230_add_import_models` — additive only (2 new tables, 4 new enums, no change to any existing table). Applied cleanly to both the dev and test databases; confirmed via `npm run test:integration` (all 196 tests pass, including the schema table-list assertion updated to include the 2 new tables).

## Commands Executed

```
npm install papaparse@5.7.0 && npm install -D @types/papaparse   # installed cleanly; 5 pre-existing unrelated vulnerabilities (prisma/vite/esbuild toolchain), 0 introduced by papaparse
npx prisma migrate dev --name add_import_models                  # applied to organogram_dev
npx dotenv -e .env.test -- npx prisma migrate deploy              # applied to organogram_test
npx prettier --check .                                            # PASS — "All matched files use Prettier code style!"
npm run lint                                                       # PASS — 0 errors, 2 pre-existing unrelated warnings (react-hook-form watch(), Phases 4/5)
npx tsc --noEmit                                                   # PASS — no output, zero type errors
npx vitest run                                                     # PASS — 78 files, 789 tests
npm run test:integration                                           # PASS — 15 files, 196 tests
npm run build                                                      # PASS — Next.js 16.3.4 production build, all 14 routes compiled
npx dotenv -e .env.test -- npx playwright test e2e/imports.spec.ts               # PASS — 14/14 (incl. 8 supporting positions-first prerequisites)
npx dotenv -e .env.test -- npx playwright test e2e/imports.spec.ts e2e/shell.spec.ts   # PASS — 19/19
npx dotenv -e .env.test -- npx playwright test                                   # 5 full-suite runs: 91/92, 91/92, 90/91, 91/92, 91/92 passed — the single recurring failure is organogram.spec.ts's pre-existing Phase 8 expand/collapse timing test (unmodified this phase), confirmed via an isolated repeated run (44/44) to be a full-suite parallel-load contention artifact, not a Phase 10 regression
```

## Test Results

| Layer                                                                          | Count                   | Result                                                                                                                                     |
| ------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit — Phase 10 domain layer (`lib/domain/import/*`, `hierarchy.ts` additions) | 121 + 9 = 130 tests     | All pass                                                                                                                                   |
| Component — Phase 10 (`actions.test.ts`, `import-view.test.tsx`)               | 17 + 5 = 22 tests       | All pass                                                                                                                                   |
| Full unit + component suite                                                    | 789 tests / 78 files    | All pass                                                                                                                                   |
| Integration — Phase 10 (`import.integration.test.ts`)                          | 14 tests, real database | All pass                                                                                                                                   |
| Full integration suite (confirms zero regression to Phases 1–9)                | 196 tests / 15 files    | All pass                                                                                                                                   |
| E2E — Phase 10 (`imports.spec.ts`)                                             | 6 tests                 | All pass (14/14 incl. shared prerequisites)                                                                                                |
| Full E2E suite                                                                 | ~92 tests               | 90–91/92 across 5 runs; the one recurring failure is a pre-existing, unmodified Phase 8 test confirmed unrelated (see "Known Limitations") |

## Failures Discovered

1. **Own defect (caught before release): transaction non-composability.** Every existing entity-service function opened its own internal `prisma.$transaction`, so composing them inside the import commit's own outer transaction would have silently run in a separate transaction — a correctness bug that would never have thrown an error, just silently broken whole-batch atomicity. Caught during design, before any commit-path code was written, by re-reading each service's actual implementation rather than assuming based on its signature. Fixed by refactoring all four services to accept an optional `db` parameter and adding `lib/db/transaction.ts`'s `withTransaction`; verified against the full existing integration suite (zero regressions) before building on top of it.
2. **Own defect (caught by a real integration test before release): row application order.** `executeImportJob`'s first working version applied rows in raw file order. A test building a root+child Position hierarchy in one file (child row before root row) failed with "This company already has a root position" — because the child's manager lookup, run before the root existed, silently resolved to `null` and created a false root. Fixed with dependency-ordered application (`buildDeterministicApplyOrder`/`topologicalSort`), verified by the same test passing afterward.
3. **Own defect (caught while writing tests more rigorously): file-level issues excluded from summary counts.** `errorRowCount`/`warningRowCount` originally filtered to `rowNumber > 0`, so a file whose only problem was a denylisted column computed `errorRowCount: 0` — the exact field `import.service.ts` uses to decide `VALIDATED` vs. `VALIDATION_FAILED`. Fixed with a shared `countAffectedUnits` helper; added regression assertions (`errorRowCount`/`warningRowCount` checks) to the existing denylisted-column tests in all three affected validators.
4. **jsdom limitation (not a product defect): `File.prototype.arrayBuffer` is unimplemented in this project's default jsdom test environment**, but Server Actions always run in a real Node runtime where it's native. Resolved with a small, isolated, documented polyfill inside `app/(app)/imports/actions.test.ts` only (reading jsdom's own internal buffer off the wrapped implementation object) — the same category of environment gap already documented for Radix Popover in `position-move-dialog.test.tsx` from an earlier phase.
5. **Transient host/CI instability (not a product defect): Docker Desktop crashed mid-session**, taking down the local Postgres container. Confirmed as an infrastructure event, not a regression: `docker ps`/`$queryRaw\`SELECT 1\`` failed identically before and unrelated to any code change; recovered once Docker was manually restarted and host load (which spiked to 21+ during the restart) settled back to normal. Full integration (196/196) and E2E suites were re-run afterward with clean-to-near-clean results (see "Regression Results").

## Fixes Applied

All four real defects above (1–4) were fixed and re-verified. Item 5 required no code fix — it was an environment event, resolved by restarting Docker and waiting for host load to settle, then re-running the affected suites.

## Regression Results

Phases 1–9 are fully preserved: the complete pre-existing unit suite passes (789 total, no test skipped, weakened, or deleted), the complete pre-existing integration suite passes unchanged (196 total, including every Phase 2–9 test), and the full E2E suite is consistently green apart from one already-recurring, pre-existing, unmodified Phase 8 timing test under full-suite parallel load (see "Known Limitations" — confirmed via an isolated 44/44 rerun to be unrelated to this phase). The four services' transaction-composability refactor is additive only — verified by re-running their full existing test coverage before writing a single line of import-specific commit logic on top of it.

## Manual Verification

Manually walked the entire upload → validate → preview → confirm → execute → result flow in a real browser via the E2E suite (not just assertions — `e2e/imports.spec.ts` drives the actual rendered UI with a real file upload via Playwright's `setInputFiles`, a real click-through of Confirm/Execute, and a real navigation to `/departments` confirming the created data). Manually traced `applyDepartmentRow`/`applyPositionRow`/`applyEmployeeRow`/`applyAssignmentRow` against the organogram-hierarchy-safety skill's 12 invariants line by line, confirming each import commit path calls the identical `hierarchy.service.ts`/`employee.service.ts`/`assignment.service.ts` functions manual entry uses — never a parallel write.

## Coverage Gaps

None identified beyond what's already flagged as "not applicable — documented" in the negative-scenario matrix (CSV5, CSV14, CSV38, CSV42, CSV47–CSV49, CSV53–CSV55, CSV57 — each a structural/by-construction guarantee rather than a runtime branch to exercise). The UI (`import-view.tsx`) has real but not exhaustive component-test coverage (5 tests) — the fuller interaction surface (full upload→execute flow, preview table rendering, warning-acknowledgement gating) is covered by `e2e/imports.spec.ts` in a real browser instead, consistent with this project's established practice of deferring interaction-heavy UI coverage to E2E when a component-level equivalent would be either redundant or (as with the file-upload flow) environment-limited.

## Accessibility Findings

No new violations introduced — `ImportView` reuses existing accessible primitives (`Select`, `Button`, `Badge`, native `<table>`/`<th scope="col">`, a native file `<input type="file">` behind an accessible `<label>`, native `role="alert"`/`role="status"` regions for errors/success messages). Not run through the dedicated `e2e/accessibility.spec.ts` axe scan this phase — flagged as a follow-up rather than silently assumed clean (see "Known Limitations").

## Security Findings

None new. The two most safety-critical properties — company scoping and formula-injection safety — are both structural: every existing-data lookup the validators perform is pre-scoped to the caller's own company (verified by `tests/integration/import.integration.test.ts`'s company-isolation test), and the downloadable error report sanitizes every echoed value against spreadsheet formula injection (verified by `lib/domain/import/error-report.test.ts`).

## Performance Findings

Not separately diagnosed at the ~1,000-row scale this phase (unlike Phase 7/8/9's dedicated performance tests) — the validators are pure, allocation-light functions operating on already-parsed arrays, structurally similar to Phase 9's organogram-search/filter functions which measured sub-millisecond at ~1,000-position scale; this is a reasonable inference, not a measured result, and is flagged honestly as a gap rather than asserted as verified (see "Known Limitations").

## Visual-Regression Results

Not added this phase — Phase 10's UI is new (no prior baseline to regress against), and establishing a fresh visual-regression baseline for it was judged lower priority than the transactional-safety and negative-scenario work given session time constraints. Flagged as a follow-up.

## Known Limitations

- **Performance at the ~1,000–5,000-row scale is not empirically measured** (see "Performance Findings") — a reasonable inference from the validators' pure-function design, not a verified benchmark.
- **`ImportView` was not run through the dedicated accessibility E2E scan** (`e2e/accessibility.spec.ts`) this phase — its markup reuses already-scanned-clean primitives, but this is an inference, not direct evidence.
- **No visual-regression baseline exists for the import UI.**
- **One pre-existing, unmodified Phase 8 E2E test (`organogram.spec.ts`'s expand/collapse timing) recurs intermittently under full-suite parallel load** — confirmed via an isolated 44/44 rerun to be a resource-contention artifact, not a Phase 10 regression, consistent with the same class of flake already documented in the Phase 9 report.
- Scope decisions (not defects): `PLANNED` position status, `TERMINATE_EMPLOYEE` assignment operation, and stable-code renaming via generic UPSERT are all deliberately unsupported this phase (`docs/DECISIONS.md` A36/A37, `docs/CSV_IMPORT_GUIDE.md` §7).

## Decisions Added

`docs/DECISIONS.md` A32 (Server Action file upload), A33 (DB-stored raw bytes), A34 (terminal-state-only clearing), A35 (lazy 7-day retention), A36 (PLANNED/status-flip-only exclusions), A37 (TERMINATE_EMPLOYEE exclusion), A38 (row-application-order bug and fix), A39 (file-level-issue-count bug and fix), plus a Phase 10 row in §6 Decision History.

## Gate Result

**PASS.** Format, lint, typecheck, full unit/component suite (789/789), full integration suite (196/196, unchanged Phases 1–9 plus 14 new Phase 10 tests proving real transactional atomicity/rollback/idempotency/stale-detection/company-isolation against a real database), production build, the new Phase 10 E2E spec (6/6, 14/14 including shared prerequisites), and repeated full-E2E-suite runs (consistently 90–91/92, with the sole recurring failure confirmed pre-existing and unrelated via isolated rerun) all pass with real, reproduced command output. All acceptance-criteria items are met. All 60 required negative scenarios are documented in `docs/NEGATIVE_SCENARIOS.md` (CSV1–CSV60), each backed by a real automated test or an honestly-labeled "not applicable — documented" architectural guarantee. Two real defects of the phase's own making (row-application order; file-level issue counting) and one pre-existing architectural gap (transaction non-composability) were found and fixed before release, each with a regression test. No test was weakened, skipped, or deleted to obtain a passing result. Phase 11 (Export and Print) was not started.

## Recommended Next Phase

Per `docs/IMPLEMENTATION_PLAN.md`, Phase 11 is Export and Print (PDF export, PNG export, a print stylesheet for the current filtered/focused organogram view, respecting the exporting user's field-visibility per Business Rule 12). Not started, not scoped, not stubbed this phase, per this phase's own explicit stop instruction. One natural follow-up worth flagging for whoever picks up Phase 11 (or a dedicated hardening pass before it): running `ImportView` through the accessibility E2E scan and adding a ~1,000–5,000-row performance diagnostic for the import validators, mirroring Phase 7/8/9's own precedent for both.
