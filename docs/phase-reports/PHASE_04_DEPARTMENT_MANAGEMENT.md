# Phase 4 Report — Department Management

Date: 2026-09-01

## Phase Objective

Ship the HR-facing Department management UI on top of Phases 2–3: list/create/edit/deactivate/reactivate departments, with server-side enforcement equal to whatever the UI enforces (`docs/IMPLEMENTATION_PLAN.md` Phase 4).

## Preflight Finding

This phase was originally requested as a prerequisite discovered mid-Phase-6-request: the user's Phase 6 (Employee Management) brief assumed Phases 4 and 5 already existed, but neither had ever been implemented — `/departments` and `/positions` were still Phase 1 placeholder pages, no phase reports existed, and no server actions or UI existed beyond the Phase 2 domain/service/repository layer. The user was asked and explicitly chose to build Phases 4, 5, then 6 in order before returning to the originally-requested Phase 6 work.

## Scope

**Built this phase:**

- `lib/services/department.service.ts`: added `updateDepartment` (Phase 2 already had `createDepartment`, `moveDepartment`, `archiveDepartment`, `reactivateDepartment`, `deleteDepartment`)
- `lib/repositories/department.repository.ts`: added `searchDepartments` (server-side paginated/filterable listing)
- `lib/validation/department.ts` + `lib/validation/pagination.ts`: Zod schemas for create/update/move/status-change/list, all `.strict()` (unknown fields rejected, including any attempted `companyId`)
- `app/(app)/departments/actions.ts`: Server Actions wrapping the above with `requirePermission("departments:view"|"departments:manage")`, using `lib/server/action-result.ts`'s shared safe-error-mapping helper (new this phase, reused by Phases 5–6)
- `app/(app)/departments/page.tsx` + `_components/{departments-view,department-form-dialog}.tsx`: real list/search/filter/pagination UI and a create+edit dialog form
- Shared UI primitives (new, reused by Phases 5–6): `components/ui/{input,label,textarea,select,field,dialog,combobox}.tsx`, `components/patterns/{pagination,confirm-dialog,color-swatch-picker}.tsx`; extended `Badge`/`Button` with `success`/`muted`/`destructive` variants using the design system's existing status-color tokens
- `react-hook-form` + `@hookform/resolvers` (fulfilling ADR-0002's existing decision) and `@radix-ui/react-popover` (combobox foundation for Phase 5's Reports-To picker) added as dependencies

**Explicitly deferred:** no organogram rendering (Phase 8); no CSV import (Phase 10); department `headPositionId` (`docs/DECISIONS.md` A2/A12 — Position UI doesn't exist until Phase 5, so there's nothing to pick from yet).

## Acceptance Criteria

| Criterion                                                                                               | Status                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Department list/create/edit/deactivate screens (FR-D1–D4)                                               | Met — `DepartmentsView` + `DepartmentFormDialog`                                                                                                                                                |
| UI enforces nothing the server doesn't also enforce                                                     | Met — every mutation independently calls `requirePermission("departments:manage")`; verified by `app/(app)/departments/actions.test.ts` calling the actions directly, bypassing the UI entirely |
| Duplicate code (incl. case-insensitive) rejected                                                        | Met — DB `@@unique` + `normalizeCode`; `tests/integration/department.integration.test.ts`                                                                                                       |
| Whitespace-only/oversized name rejected                                                                 | Met — `lib/validation/department.test.ts`                                                                                                                                                       |
| Invalid color format rejected                                                                           | Met — `lib/validation/department.test.ts`                                                                                                                                                       |
| Deactivating a department still referenced by active positions                                          | Allowed by design (archiving never blocks — only hard-delete does, and hard-delete isn't exposed in the UI); documented as DEP7 in `docs/NEGATIVE_SCENARIOS.md`                                 |
| VIEWER attempting to mutate rejected (403-equivalent)                                                   | Met — `app/(app)/departments/actions.test.ts`, `e2e/departments.spec.ts`                                                                                                                        |
| Double-submission of the create form produces no duplicate row                                          | Met by construction (submit button disabled for the duration of the pending request) — not separately regression-tested; flagged in Coverage Gaps                                               |
| Component test for the form; integration test for the service+API path; E2E test for the create journey | Met                                                                                                                                                                                             |

## Business Rules

Rules 9 (duplicate codes, portions) and 12 (Job Grade/Organizational Level independence — Department has neither field, so not directly exercised) from `docs/PROJECT_SPEC.md` §7. No hierarchy invariant beyond department-parent cycle prevention is touched — Position reporting hierarchy is untouched by this phase (confirmed by regression: `tests/integration/position-hierarchy.integration.test.ts` still 19/19 passing).

## Scenario Matrix

`docs/NEGATIVE_SCENARIOS.md` §"Departments (Phase 4)" — 15 scenarios (DEP1–DEP15), all automated except DEP12 (double-submission — prevented by construction via the disabled-while-pending submit button, but not covered by a dedicated regression test).

## Files Changed

See "Scope" above for the full list. Notably: `lib/auth/config.ts` (bug fix, see "Failures Discovered"), `e2e/shell.spec.ts` (updated to stop asserting Departments is still a placeholder), `e2e/accessibility.spec.ts` (added two new automated axe scans), `e2e/support/sign-in-as.ts` (new — role-switching helper for E2E specs that need a non-default role).

## Migrations

None. Every field/table Phase 4's UI touches already existed from Phase 2.

## Commands Executed

```
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run test:integration
npm run test:e2e
```

## Test Results

**`npm run quality`** (final run): format clean; lint clean (1 pre-existing informational warning about React Hook Form's `watch()` and the React Compiler, not an error); typecheck clean; build succeeds (`/departments` now `ƒ` dynamic, same as every other `(app)` route); unit/component suite:

```
 Test Files  35 passed (35)
      Tests  227 passed (227)
```

(171 from Phases 1–3 + 8 `action-result.test.ts` + 22 `department.test.ts` (validation) + 7 `department-form-dialog.test.tsx` + 9 `departments-view.test.tsx` + 10 `actions.test.ts` = 227.)

**`npm run test:integration`**:

```
 Test Files  8 passed (8)
      Tests  91 passed (91)
```

(72 from Phases 1–2 + 12 from Phase 3's `user-provisioning` + 7 new: `department.integration.test.ts` grew from 11 to 18 tests, adding 3 cases for `updateDepartment` and 4 for `searchDepartments`.)

**`npm run test:e2e`** (real Chromium, mocked-auth):

```
Running 18 tests using 4 workers
  18 passed (10.6s)
```

Includes 4 new `departments.spec.ts` tests (create journey, duplicate-code rejection, VIEWER read-only view) and 2 new accessibility scans (`/departments` list, the create dialog) — both zero critical/serious axe violations.

## Failures Discovered

1. **`shell.spec.ts`'s "every navigation item renders its own heading" test broke** — it asserted every `NAV_ITEMS` route still shows "Planned for Phase N," which is now false for `/departments`. Fixed by excluding implemented routes from that specific assertion (a small `IMPLEMENTED_ROUTES` set in the spec) while still confirming the route is reachable and renders its heading. Not a weakened test — the underlying behavior legitimately changed; `e2e/departments.spec.ts` now covers what the placeholder assertion used to stand in for.

2. **Real bug: `AUTH_TRUST_HOST` always passed as `false` instead of `undefined` when unset, breaking sign-in on plain `localhost`.** Discovered while manually verifying this phase's UI in a real browser (the first time this session drove the app through an actual signed-in session against local dev rather than only Playwright's non-default `127.0.0.1:3100` host). `lib/auth/config.ts` did `trustHost: serverEnv.AUTH_TRUST_HOST`, and `lib/env.ts`'s Zod boolean transform always produces a literal `false` for an unset variable — never `undefined`. Auth.js's own default (`config.trustHost ?? (auto-trust outside production)`, `@auth/core/lib/utils/env.js`) only applies when the value is nullish, so passing an explicit `false` silently disabled auto-trust everywhere `AUTH_TRUST_HOST` wasn't explicitly `"true"`, including ordinary `NODE_ENV=development` `npm run dev` on `localhost`. Fixed: `trustHost: serverEnv.AUTH_TRUST_HOST || undefined`. See `docs/DECISIONS.md` A14. This is a second real, previously-undetected regression from Phase 3 (after the `allowedDevOrigins` bug) — both were only catchable by actually driving the app through a real signed-in browser session, which no phase had done outside of Playwright's non-default host until now.

3. **`department-form-dialog.tsx`'s `useForm` resolver type mismatch** when I tried to give create and edit different (fully-required vs. partial) Zod schemas — TypeScript correctly rejected a `Resolver<UpdateShape>` where a `Resolver<CreateShape>` was expected. Fixed by using one schema (`createDepartmentSchema`) for both modes, since the edit form is always fully populated with the department's current values on open (never a true partial patch from the client's perspective) — `updateDepartmentSchema`'s server-side partial-field support remains available for any future caller that needs it (e.g., a bulk-edit API), it's just not what this form needs.

## Fixes Applied

All three failures above were fixed as described. None required weakening, skipping, or deleting a test.

## Regression Results

- `npm run test`: 227/227 (171 from Phases 1–3 unchanged + 56 new).
- `npm run test:integration`: 91/91 (all Phase 1–3 cases unchanged, 7 new department cases added).
- `npm run test:e2e`: 18/18 (all Phase 1–3 specs pass, with `shell.spec.ts` updated per Failure #1 above, not weakened).

## Coverage Gaps

- **DEP12 (double-submission of the create form)**: prevented by construction (the submit button is disabled for the duration of a pending request via `useTransition`/`isSubmitting`), but no dedicated regression test simulates a rapid double-click to prove the second click is actually inert. Flagged rather than silently assumed safe — a reasonable Phase 5/6 addition once the pattern is reused enough to justify a shared test helper.
- **No dedicated unit test for `updateDepartment`'s interaction with a concurrent code change** (e.g., two simultaneous renames to the same new code) — the database's own unique constraint is the actual backstop (proven at the schema level since Phase 2), but a dedicated concurrency test wasn't added for this specific operation. Positions and Assignments (Phases 5–6) get dedicated concurrency tests per their own explicit requirements; Departments' equivalent risk is lower (no occupancy/vacancy semantics) and was judged not to need one this phase.

## Accessibility Findings

`e2e/accessibility.spec.ts` now also scans `/departments` (list view) and the create-department dialog (via axe-core, WCAG 2A/2AA tags) — both zero critical/serious violations. The dialog scan specifically confirms the `Field`/`Label`/`aria-describedby` wiring and Radix Dialog's built-in focus-trap/labelling produce a genuinely accessible form, not just a visually-correct one.

## Security Findings

- Every mutation independently re-checks `requirePermission("departments:manage")` server-side — verified by `app/(app)/departments/actions.test.ts` calling the exported action functions directly (bypassing the UI/hidden-button layer entirely) and confirming a `ForbiddenError`/`UnauthenticatedError` blocks the service layer from ever running.
- Every schema is `.strict()` — an attempted `companyId`/other unexpected field in a request payload is rejected outright, not silently dropped; `companyId` is in all cases taken only from `requirePermission`'s returned session user, never from client input (DEP10).
- Cross-company reads/updates return `NotFoundError`, not a "forbidden but confirmed to exist" leak (DEP11).
- No raw Prisma/Postgres error ever reaches the client — `runAction`'s generic fallback (already covered by `lib/server/action-result.test.ts`) plus the service layer's existing `translateWriteError`.

## Performance Findings

Not separately load-tested this phase. `searchDepartments` is bounded (`MAX_PAGE_SIZE = 100`, defaulting to 20) and always company-scoped with an indexed `companyId` lookup (existing `@@index([companyId])` from Phase 2); department counts are expected to stay small relative to positions (`docs/DECISIONS.md` P7), so `listAllDepartmentsAction` deliberately stays unpaginated for use in selects.

## Known Limitations

- No `headPositionId` field/UI — deferred to Phase 5+ (`docs/DECISIONS.md` A12).
- No bulk operations (bulk deactivate, bulk move) — not required by the phase brief.
- Department hard-delete exists at the service layer (`deleteDepartment`, from Phase 2) but is intentionally not exposed anywhere in the UI — archiving is the only lifecycle action a user can take, consistent with `docs/DATA_DICTIONARY.md`'s stated deletion rule.

## Decisions Added

`docs/DECISIONS.md` A12 (headPositionId still deferred), A13 (new dependencies fulfill ADR-0002, not a new decision), A14 (the `trustHost` bug fix) — plus a Phase 4 decision-history entry.

## Gate Result

**PASS.**

## Recommended Next Phase

Phase 5 (Position and Hierarchy Management), as originally planned and as required before the user's actually-requested Phase 6 (Employee Management and Position Assignments) can proceed.
