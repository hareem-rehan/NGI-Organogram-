# Phase 6 Report — Employee Management and Position Assignments

Date: 2026-09-01

## Phase Objective

Ship Employee CRUD and employee↔position assignment: create/edit employee records, assign an employee to a vacant position, transfer between positions, end an assignment, and a guided termination workflow — all with department/manager/organizational-level/job-grade fields derived from the active position assignment, never stored on Employee (per `docs/IMPLEMENTATION_PLAN.md`'s Phase 6 entry and the user's detailed Phase 6 prompt).

**Preflight discovery:** Phase 6's own prompt assumed Phases 4 (Department Management) and 5 (Position and Hierarchy Management) already existed as prerequisites — they did not (`/departments` and `/positions` were still Phase 1 placeholders). Per explicit user direction (`AskUserQuestion`: "Build Phases 4, 5, then 6 in order"), this session built all three phases in sequence within the same session. Phases 4 and 5 have their own phase reports (`PHASE_04_DEPARTMENT_MANAGEMENT.md`, `PHASE_05_POSITION_AND_HIERARCHY.md`); this report covers Phase 6 specifically, though the two shared some test-infrastructure discoveries called out below.

## Scope

Built:

- `lib/services/employee.service.ts` — `createEmployee`, `updateEmployee` (never accepts `employmentStatus`), `changeEmployeeStatus`, `terminateEmployee` (transactional: ends the active assignment and sets `TERMINATED`/`leavingDate` atomically).
- `lib/services/assignment.service.ts` — extended with eligibility checks (`assertEmployeeEligibleForAssignment`, `assertPositionAcceptsAssignment`) so `createAssignment`/`transferEmployee` reject terminated/transferred employees and inactive positions.
- `lib/repositories/employee.repository.ts` — `searchEmployees` (paginated/filtered), `listCurrentAssignmentsForEmployees` (bulk, effective-date-correct).
- `lib/repositories/position.repository.ts` — `searchEligiblePositions` (server-side eligibility search for the Assign/Transfer pickers).
- `lib/repositories/assignment.repository.ts` — `listAssignmentHistoryWithPositionForEmployee`.
- `lib/validation/employee.ts` — all `.strict()` Zod schemas (create/update/status/terminate/assign/transfer/end/list-query).
- `lib/domain/employee-status.ts` — pure `assignmentDisplayStatus` derivation (assigned/unassigned/future/terminated).
- `app/(app)/employees/actions.ts` — 12 server actions, all via `requirePermission("employees:view"|"employees:manage")`.
- UI: `employees-view.tsx` (list/search/filter/paginate), `employee-form-dialog.tsx` (create/edit — no manager/department/level/status fields), `assign-position-dialog.tsx`, `transfer-employee-dialog.tsx`, `end-assignment-dialog.tsx`, `terminate-employee-dialog.tsx` (typed employee-code confirmation), `employee-details-view.tsx` (hub component wiring all five dialogs, current-position card, record-details card, assignment-history table), and the `/employees/[employeeId]` dynamic route.
- A real bug fix in `lib/domain/assignment.ts` (see "Failures Discovered").

**Explicitly not built** (per the phase's own non-goals and `docs/PROJECT_SPEC.md`'s MVP exclusions): employee photos/contact-detail chart display, multi-position (secondary/dotted-line) assignment, historical point-in-time snapshots of position title/department in the assignment-history view (explicitly disclaimed in the UI instead), CSV import, the organogram canvas, audit-log UI, salary/payroll fields. Phase 7 was not started.

## Acceptance Criteria

| Criterion (from `docs/IMPLEMENTATION_PLAN.md` Phase 6)                                          | Status                                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| FR-E1–E5 implemented and tested                                                                 | Met — create/list/edit/assign/deactivate(terminate) all implemented, all tested                                         |
| Confirms P2's interim default (one active primary assignment) is enforced, not silently ignored | Met — DB partial unique index + application overlap check; EMP12/EMP13 in `docs/NEGATIVE_SCENARIOS.md`                  |
| Business rules 1, 2, 3, 9, 11, 12 hold                                                          | Met — see "Business Rules" below                                                                                        |
| Component, integration, and E2E coverage mirroring Phase 4/5's pattern                          | Met — 7 component test files, 43 integration tests, 9 E2E scenarios (16 including the positions-first dependency chain) |
| lint/typecheck/unit/integration/component/E2E tests/build all pass                              | Met — see "Test Results"                                                                                                |
| phase-quality-gate PASS                                                                         | PASS — see "Gate Result"                                                                                                |

## Business Rules

Per `docs/PROJECT_SPEC.md` §7 / `CLAUDE.md` §2, this phase touches:

1. **Position and Employee are separate entities** — holds. `Employee` has no `positionId` column; `updateEmployee`/`createEmployee` never accept or derive one. Removing/transferring/terminating an employee never deletes or mutates the Position row (verified: `tests/integration/employee-and-assignment.integration.test.ts` "terminateEmployee with an active assignment ends it and preserves the position").
2. **Every active position has exactly one primary Reports-To** — unaffected by this phase (owned by `hierarchy.service.ts`, Phase 5); Phase 6 never writes `primaryReportsToPositionId`.
3. **Organizational Level is system-calculated, never derived from Job Grade or vice versa** — holds; Employee's "level" is always read off the active assignment's `Position.organizationalLevel`, never stored or computed independently on Employee.
4. **No self-reporting / cycles** — unaffected (Phase 5's concern; Phase 6 never mutates the reporting chain).
5. **No duplicate employee codes (case-insensitive)** — holds; DB `@@unique` + `normalizeCode` + service-layer translation to a clean `ConflictError` (EMP1).
6. **Atomic multi-write mutations run in one transaction with full rollback** — holds for `terminateEmployee` (ends assignment + sets status, one `prisma.$transaction`) and `transferEmployee` (ends old assignment + starts new one, one transaction, rollback verified — see EMP11 / the "rolls back the entire transfer..." integration test).

## Scenario Matrix

Full matrix: `docs/NEGATIVE_SCENARIOS.md` §"Employees and Position Assignments (Phase 6)", EMP1–EMP26. Every row has a corresponding automated test at the stated layer; none are marked "not applicable" without a stated reason in this phase. Positive scenarios (create, assign, transfer, end, terminate, details-page derived fields) were additionally verified manually in a real browser (see "Manual Verification" below) before the E2E suite was written.

## Files Changed

**New:**

- `lib/services/employee.service.ts`
- `lib/repositories/employee.repository.ts` (new file; `searchEmployees`, `listCurrentAssignmentsForEmployees`)
- `lib/domain/employee-status.ts` + `.test.ts`
- `lib/validation/employee.ts` + `.test.ts`
- `app/(app)/employees/actions.ts` + `.test.ts`
- `app/(app)/employees/page.tsx`, `[employeeId]/page.tsx`
- `app/(app)/employees/_components/{employees-view,employee-form-dialog,assign-position-dialog,transfer-employee-dialog,end-assignment-dialog,terminate-employee-dialog,employee-details-view}.tsx` + matching `.test.tsx` for each (7 component test files)
- `e2e/employees.spec.ts`
- `tests/integration/employee-and-assignment.integration.test.ts` (43 tests)

**Modified:**

- `lib/services/assignment.service.ts` — added `assertEmployeeEligibleForAssignment`/`assertPositionAcceptsAssignment` eligibility checks
- `lib/repositories/position.repository.ts` — added `searchEligiblePositions`
- `lib/repositories/assignment.repository.ts` — added `listAssignmentHistoryWithPositionForEmployee`
- `lib/repositories/job-grade.repository.ts` — added `listJobGradesForCompany` (read-only, used by the eligible-position summary)
- `lib/domain/assignment.ts` — **bug fix**, see "Failures Discovered"
- `lib/domain/assignment.test.ts` — regression tests added for the bug fix
- `tests/integration/position-hierarchy.integration.test.ts` — added a same-day-eligibility regression test to the existing `searchEligiblePositions` block
- `e2e/shell.spec.ts` — `IMPLEMENTED_ROUTES` extended to include `/employees`
- `e2e/accessibility.spec.ts` — added employees-list and create-dialog axe scans
- `playwright.config.ts` — added a `positions-first` project dependency (see "Failures Discovered")
- `docs/DECISIONS.md` — A17, A18, Phase 6 history entry
- `docs/NEGATIVE_SCENARIOS.md` — replaced the stale pre-Phase-6 "Employees" skeleton with EMP1–EMP26
- `docs/AUTHORIZATION_MATRIX.md` — corrected stale "Phase 3 has no CRUD server actions yet" language, added Phase 4–6 rows to §5
- `docs/DOMAIN_MODEL.md` — corrected the vacancy-calculation formula (was documented as inclusive-end, actual/fixed behavior is exclusive-end)
- `README.md` — updated "Current Implementation Status" from stale Phase 3 text through Phase 6

## Migrations

None. Phase 6 introduced no new Prisma schema changes — `Employee`, `PositionAssignment`, and `EmploymentStatus` were already fully modeled in Phase 2.

## Commands Executed

- `npx vitest run "app/(app)/employees"` (component/action tests, iterative)
- `npx vitest run` (full unit/component suite)
- `npm run test:coverage` (full unit/component suite with coverage, part of `npm run quality`)
- `npm run test:integration`
- `npm run test:e2e` (run multiple times during debugging; final confirmation runs below)
- `npm run format:check` / `npx prettier --write <files>`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Test Results

**Unit/component (`npx vitest run` / `npm run test:coverage`):**

```
Test Files  50 passed (50)
     Tests  379 passed (379)
```

(54 of those tests are the 8 new Phase 6 component/action test files; the rest are Phases 1–5's suites, unchanged and still passing.)

**Integration (`npm run test:integration`):**

```
Test Files  8 passed (8)
     Tests  134 passed (134)
```

(`tests/integration/employee-and-assignment.integration.test.ts`: 43 tests. `tests/integration/position-hierarchy.integration.test.ts`: 36 tests, +1 from Phase 5's 35 for the new same-day-eligibility regression test.)

**E2E (`npm run test:e2e`, full suite, run twice to confirm stability after the ordering fix):**

```
Run 1: 39 passed (1.1m)
Run 2: 39 passed (1.3m)
```

`e2e/employees.spec.ts` alone: 9/9 passing (prerequisite department+2 positions, create employee, duplicate-code rejection, VIEWER read-only, assign to vacant position, occupied-position exclusion from the eligible-position search, transfer with history preserved, guided termination blocking further reassignment).

**Lint (`npm run lint`):** 0 errors, 3 warnings (all pre-existing/unrelated to Phase 6: two React Compiler "incompatible library" notices on `react-hook-form`'s `watch()` in Phase 4/5 dialogs, unrelated to this phase's files).

**Typecheck (`npm run typecheck`):** clean, no errors.

**Build (`npm run build`):** succeeded — `/employees` and `/employees/[employeeId]` both compile as dynamic server-rendered routes.

## Failures Discovered

1. **Real product bug: `dateRangesOverlap` silently blocked same-day handoffs.** `lib/domain/assignment.ts`'s `dateRangesOverlap` — used by the real `createAssignment`/`transferEmployee` overlap check and by `searchEligiblePositions`'s eligible-position picker — compared date-range boundaries with inclusive (`<=`) operators on both sides. This meant an assignment ending on day D and a new assignment starting on day D were flagged as overlapping and rejected, contradicting the exclusive-end convention already used everywhere current occupancy is actually derived (`listCurrentAssignmentsForEmployees`: `endDate IS NULL OR endDate > onDate`) and the End Assignment dialog's own copy ("will become vacant from the end date forward"). Found via `e2e/employees.spec.ts`'s real-browser transfer scenario (end one employee's assignment, then immediately transfer a second employee into that now-vacant position on the same day) — the transfer's eligible-position search returned "No eligible destination positions found for this date" even though the position had just been freed. Root-caused by reading the actual `dateRangesOverlap` implementation against its own docstring, which already claimed "half-open interval overlap check" — the code simply didn't match its own documented contract. See "Fixes Applied" and `docs/DECISIONS.md` A18.

2. **E2E test-infrastructure gap: two spec files racing to create the company's one root Position.** Once `e2e/employees.spec.ts` also needed to create positions (to have something to assign employees to), it and `e2e/positions.spec.ts` both attempted to claim the shared seeded company's single allowed root position. Every spec file's default browser context restores the same static `storageState` (`e2e/.auth/admin.json`, written once by the `setup` project) — meaning every file shares one company, not one per file. Running the two files in parallel Playwright workers caused a real race (`positions.spec.ts`'s own root-creation test failing with the dialog never showing its "root position" hint text, because `employees.spec.ts` had already claimed the root in a different worker). Reducing to a single alphabetical-order dependency didn't fully fix it either, since `employees.spec.ts` sorts before `positions.spec.ts` alphabetically and would then claim the root first, breaking `positions.spec.ts`'s own test instead. See "Fixes Applied."

## Fixes Applied

1. **`dateRangesOverlap` fixed to exclusive-end (strict `<`) comparisons** on both sides, matching the Prisma-query convention used everywhere else. The two related, currently-unused pure helpers `rangeCoversDate`/`isVacantOnDate` (same file) were fixed the same way for internal consistency, since they previously documented and implemented the opposite (inclusive-end) convention and are the kind of function a future phase (e.g. CSV import) would naturally reach for. Added regression tests: `lib/domain/assignment.test.ts` (same-day-handoff, one-day-before still-rejects), `tests/integration/employee-and-assignment.integration.test.ts` ("allows a same-day handoff...", "still rejects a new assignment starting one day before..."), `tests/integration/position-hierarchy.integration.test.ts` (`searchEligiblePositions` same-day case). Corrected `docs/DOMAIN_MODEL.md`'s vacancy-calculation formula, which had documented the wrong (inclusive-end) convention since Phase 2.
2. **`playwright.config.ts` gained a `positions-first` project** that `positions.spec.ts` alone runs under, with the main `chromium` project declared to depend on `["setup", "positions-first"]`. This guarantees `positions.spec.ts` (and its root-position creation) always completes before any other spec file starts, using Playwright's own project-dependency mechanism (already precedented by the existing `setup` project for auth) rather than serializing the entire suite to one worker or relying on incidental alphabetical file-scan order. `e2e/employees.spec.ts`'s prerequisite test was simplified accordingly — it no longer attempts root creation at all, and instead always reads the positions list and attaches under whatever `positions.spec.ts` already created.
3. **A stale test mock caught and fixed while adding component tests**: `app/(app)/employees/actions.test.ts`'s permission-requirement test mocked `assignmentRepoMocks.listPrimaryAssignmentsForEmployee`, but `getEmployeeDetailAction` actually calls `listAssignmentHistoryWithPositionForEmployee` (renamed/changed during this phase's own development). The stale mock meant `getEmployeeDetailAction` was silently failing every time that test ran (masked because the test only asserted `requirePermission` was called, not that the action actually succeeded). Fixed the mock name and strengthened the test to also assert `result.ok === true`, closing the gap so a similar future mock/implementation drift fails loudly instead of silently.

None of these were fixed by weakening, skipping, or deleting a test — all three were genuine defects (two in application code, one in test-double staleness), each with a new or strengthened regression test.

## Regression Results

- Full unit/component suite: 379/379 passing, including every Phase 1–5 test file unchanged.
- Full integration suite: 134/134 passing, including every Phase 2–5 test file unchanged.
- Full E2E suite: 39/39 passing across two consecutive full runs, including `departments.spec.ts`, `positions.spec.ts`, `auth.spec.ts`, `shell.spec.ts`, `mobile-nav.spec.ts`, `health.spec.ts`, and `accessibility.spec.ts` all still green after the `playwright.config.ts` project restructuring.

## Manual Verification

Before the E2E suite existed, the full happy-path flow was exercised end-to-end in a real signed-in browser session against the local dev server: create employee ("Test Verifier") → confirm it renders correctly in the list as Unassigned with blank derived fields → open details page → Assign to Position (searched, selected a vacant position, confirmed department/manager/level/assignment-start all rendered correctly) → Transfer (searched, selected a different vacant position, confirmed the before/after summary and the resulting two-row assignment history) → End Assignment (confirmed the employee returned to Unassigned and the position became vacant again) → Terminate Employee (confirmed the typed employee-code confirmation gates the destructive button — verified via direct DOM inspection that it stays disabled for a wrong code and enables for the exact code — then confirmed the terminated state hides Assign/Transfer/End/Terminate entirely). This manual pass never happened to reuse the same position for two different employees on the same day, so it did not surface the EMP15/A18 same-day-handoff bug — that was found afterward, specifically by `e2e/employees.spec.ts`'s scripted scenario, which deliberately frees a position via one employee's End Assignment and immediately transfers a second employee into it on the same day.

## Coverage Gaps

None identified for this phase's own scope. All 26 EMP scenarios in `docs/NEGATIVE_SCENARIOS.md` have an automated test. One deliberate scope trim, documented rather than silent: the employees **list** view's Assignment-status column only distinguishes "assigned"/"unassigned" (a bulk, single-query derivation via `listCurrentAssignmentsForEmployees`); the finer "future" vs "unassigned" distinction (`assignmentDisplayStatus`'s third state) is only computed on the per-employee **details** page, which already has the full history loaded. Extending the list view to the same granularity would require an additional bulk future-assignment query with no current UI need for it — left for a future phase if HR asks for it.

## Accessibility Findings

`e2e/accessibility.spec.ts` axe scans (`wcag2a`/`wcag2aa`) added for the employees list and the Add Employee dialog — both pass with zero critical/serious violations. The Assign/Transfer/End/Terminate dialogs reuse the same `Dialog`/`Field`/`Combobox` primitives already scanned via the Position dialogs in Phase 5 (no new primitive components introduced this phase), so a full separate scan of each was judged redundant; this is a documented scope decision, not an oversight.

## Security Findings

- Every employee/assignment server action requires `employees:view` or `employees:manage` server-side before touching the repository/service layer (`app/(app)/employees/actions.test.ts`, 15 tests, `it.each`-parametrized across all 12 actions).
- `companyId` is always derived from the authenticated session, never accepted from the client payload (`.strict()` schemas reject an attempted `companyId` field outright; verified explicitly in both `lib/validation/employee.test.ts` and `app/(app)/employees/actions.test.ts`).
- Attempted injection of `role`, `managerId`, `departmentId`, `organizationalLevel`, or `employmentStatus` into `createEmployeeAction`'s payload is rejected outright by the `.strict()` schema (EMP5).
- Creating an Employee never creates an Auth.js `User`/`Account` row — verified by an explicit integration test (EMP22) — so an Employee record never grants application sign-in access, preserving the Employee/User separation established in Phase 3.
- No salary, SSN, or other confidential/payroll field exists anywhere in the Employee schema or any Phase 6 form (true by construction — the schema has none to expose).

## Performance Findings

Not separately measured this phase — no `docs/PROJECT_SPEC.md` §14 performance target is specific to Employee volume yet (the ~2,000-position scale target from P7 concerns the organogram canvas, not built until a later phase). List/search queries use the same paginated, indexed (`companyId`) query pattern established in Phases 4–5.

## Known Limitations

- The assignment-history table explicitly does not preserve a historical snapshot of a position's title/department/code at the time of each assignment — it always shows the position's **current** record. This is disclosed directly in the UI (a visible disclaimer paragraph on the details page) rather than silently implied, and is an explicit MVP exclusion (`docs/PROJECT_SPEC.md`'s "no point-in-time views," P9).
- `Employee.employmentStatus` was kept as the existing Phase 2 `ACTIVE|TRANSFERRED|TERMINATED` enum rather than introducing an `INACTIVE` value some generic guidance might suggest — see A17.
- See "Coverage Gaps" for the list-view assignment-status granularity trim.

## Decisions Added

`docs/DECISIONS.md`:

- **A17** — kept the existing `EmploymentStatus` enum (`ACTIVE|TRANSFERRED|TERMINATED`) rather than introducing `INACTIVE`, per existing `docs/DATA_DICTIONARY.md` documentation predating this phase.
- **A18** — the `dateRangesOverlap` same-day-handoff bug and its fix (see "Failures Discovered"/"Fixes Applied" above).
- A new row in the Decision History table summarizing Phase 6, including the Phase 4/5 preflight discovery and both bugs found this phase (A18, plus the E2E ordering hazard).

## Gate Result

**PASS.** All blocking checks (lint, typecheck, unit, integration, component, E2E, build) pass with real, captured command output (above). No test was skipped, weakened, or deleted to force a pass — the one stale mock found was corrected and strengthened, not loosened. Every EMP scenario in the negative-scenario catalog has an automated test at an appropriate layer. The one real transactional-rollback-sensitive flow this phase adds (`transferEmployee`) has an explicit test proving a failed transfer leaves the original assignment untouched (`tests/integration/employee-and-assignment.integration.test.ts`, "rolls back the entire transfer..."); `terminateEmployee`'s transaction has no code path where a first write can succeed and a second independently fail (all preconditions are guard-checked before any write), so no artificial rollback test was added for it — its happy-path and precondition-rejection paths are both covered instead.

No non-blocking items are being carried forward beyond what's already listed under "Coverage Gaps" and "Known Limitations" above, both of which are deliberate, documented scope decisions rather than defects.

## Recommended Next Phase

Phase 7: Dashboard and Company Overview (per `docs/IMPLEMENTATION_PLAN.md`), which depends on Phases 4–6's data now being real and populated. **Not started in this session** — per the user's explicit "Stop after Phase 6" instruction.
