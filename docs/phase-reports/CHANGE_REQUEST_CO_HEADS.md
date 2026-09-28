# Change Request Report — Co-heads (a position reporting to two heads)

Date: 2026-09-28 · Branch: `position-co-heads` · Decisions: D27, A54 (docs/DECISIONS.md)

## Phase Objective

Let one position report to **two heads at once**, drawn like the Visily reference: a Sr. Software Engineer under both a Sr. Software Engineer II and an Associate Tech Lead, with the two heads' lines merging into one connector above the shared card.

## Scope

Stakeholder answers (2026-09-28):

- **Equal co-heads.**
- **At most two heads.**
- **Solid, merged lines.**

In scope:

- Schema and migration
- Hierarchy service: create, move, set/clear head 2, change both heads atomically, delete guards
- Level rule
- Integrity check
- CSV import validation
- Organogram graph, visibility, focus, leadership projection, outline, export
- Positions UI: Add form, Change Reports-To dialog, list column
- Docs

Out of scope:

- Dotted-line (visually secondary) reporting
- More than two heads
- An import column for head 2 (A54)

## Acceptance Criteria

| #   | Criterion                                                                                          | Evidence                                                                       |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | HR can give a position a second head on create and add/change/remove it later                      | `e2e/positions.spec.ts` "…two heads (D27)"; form + dialog component tests      |
| 2   | The shared position is drawn once, below both heads, with a line from each                         | `e2e/organogram-co-heads.spec.ts` (edge testids + bounding boxes + screenshot) |
| 3   | Level = deepest head + 1, re-levelled for the position and every descendant through either head    | `hierarchy-co-heads.integration.test.ts`; `recalculateDagLevels` unit tests    |
| 4   | No self/duplicate head, no head 2 on the root, no cycle through either head, no cross-company head | integration rejections + DB `CHECK` test                                       |
| 5   | All changes atomic; a failed step leaves nothing applied                                           | "rolls back EVERY step…" integration test                                      |
| 6   | Concurrent conflicting changes cannot jointly create a cycle                                       | two concurrency integration tests                                              |
| 7   | Import cannot create a cycle through an existing head 2                                            | `position-import.test.ts` D27 cases                                            |
| 8   | Server-side authorization (`positions:manage`), strict input validation                            | `actions.test.ts` D27 block                                                    |

## Business Rules

CLAUDE.md §2 amended: "one or two heads; level = deepest head + 1; no cycles through either head".

These were updated to match:

- `.claude/skills/organogram-hierarchy-safety` invariants 1–3, 5, 8
- DECISIONS C13 (amended), D27 and A54

## Scenario Matrix

`docs/NEGATIVE_SCENARIOS.md` → new "Co-heads (D27)" section (17 rows). Every row maps to a test listed there.

N/A categories and reasons:

- **Large data:** the level recalculation is linear (Kahn), and the depth guards are kept.
- **Accessibility:** the new fields reuse the existing labelled `Field` + `Combobox`.

## Files Changed

**Schema and migration**

- `prisma/schema.prisma`
- `prisma/migrations/20260928120000_position_co_heads/`

**Domain and services**

- `lib/domain/hierarchy.ts`: `calculateLevelFromHeads`, `recalculateDagLevels`, `findCycleInHeadGraph`
- `lib/repositories/position.repository.ts`: `getPositionAncestorIds`, `getPositionSubtree` and `countDirectReports` now follow both heads
- `lib/services/hierarchy.service.ts`: `setCoReportsTo`, `changeReportsTo`, and co-head-aware `createPosition` / `movePosition` / `deletePositionSubtree`
- `lib/domain/integrity-check.ts` and its repository
- `lib/domain/import/position-import.ts`, `lib/services/import.service.ts`

**Organogram**

- `lib/domain/organogram.ts`, `organogram-focus.ts`, `organogram-leadership-graph.ts`, `export/subgraph.ts`
- `app/(app)/organogram/_components/organogram-view.tsx`, `organogram-outline-view.tsx`

**Positions**

- `lib/validation/position.ts`
- `app/(app)/positions/actions.ts`
- `position-form-dialog.tsx`, `position-move-dialog.tsx`, `positions-view.tsx`

**Tests**

- New: `tests/integration/hierarchy-co-heads.integration.test.ts`, `position-move-dialog.co-heads.test.tsx`, `e2e/organogram-co-heads.spec.ts`
- Updated: `e2e/support/chart-fixtures.ts`, plus D27 blocks in existing unit/component/e2e tests
- Updated: `Position` test fixtures, which gained `coReportsToPositionId: null`

**Docs**

- `CLAUDE.md`
- The hierarchy-safety skill
- `DECISIONS`, `DATA_DICTIONARY`, `NEGATIVE_SCENARIOS`, `HR_USER_GUIDE`, `POST_MVP_BACKLOG`

## Migrations

`20260928120000_position_co_heads` is additive only:

- A nullable `coReportsToPositionId` column
- An index on it
- A company-scoped composite FK (`ON DELETE RESTRICT`)
- Three `CHECK`s: not self, not head 1, and not on the root

It has no destructive steps and needs no data backfill, since existing rows stay single-head.

It was verified on a **fresh** database: all 11 migrations applied cleanly, and the 3 `CHECK`s and the FK were present. It was also applied to the test and local DBs.

## Commands Executed

```
npm run typecheck                              → clean
npm run lint                                   → 0 errors, 7 warnings (all pre-existing)
npx prettier --check app components lib tests e2e docs prisma CLAUDE.md .claude → clean
npm test                                       → 108 files, 1365/1365 passed
npm run test:integration                       → 32 files, 448/448 passed
npm run test:e2e -- --grep-invert visual       → 125/125 passed
npm run build                                  → Compiled successfully
prisma migrate deploy (fresh throwaway DB)     → 11 migrations applied
```

## Test Results

All green, per the commands above.

New tests:

- **Unit:** DAG helpers (10); integrity checks (5); import (3); organogram, focus, leadership and export (13)
- **Component:** form (4); move dialog (5); actions (6)
- **Integration:** 26
- **E2E:** 2

## Failures Discovered

- **Import test assertion:** the new import test first asserted on `message`, but the issue field is named `safeMessage`. The test was wrong, not the code, so the assertion was corrected.
- **Move-dialog mocks:** the existing tests needed their action mock renamed from `movePositionAction` to `changeReportsToAction`, because the dialog now saves both heads through one atomic action. No assertion was changed.

## Fixes Applied

As above.

The dialog originally risked a half-applied swap of heads (two separate calls). It was redesigned around a single transactional `changeReportsTo`, and the test "rolls back EVERY step" proves it is atomic.

## Regression Results

- Every pre-existing hierarchy, organogram, import and export test passes unchanged.
- The pre-existing move-concurrency test passes.

## Coverage Gaps

None blocking.

The Radix Combobox popover can't be opened in jsdom (a known, documented limitation). The picker interactions are covered by a `<select>` stand-in in component tests, and by real-browser e2e.

## Accessibility Findings

Both new pickers use the existing labelled `Field` + `Combobox` and have descriptive `aria-label`s. No new axe findings: `accessibility.spec.ts` is included in the 125 e2e tests that passed.

## Security Findings

- The new server action is gated on `positions:manage`, with a strict zod schema that rejects extra keys (including a client-supplied level).
- Company scoping is enforced by the composite FK and by the service lookups.
- VIEWER denial and malformed-input rejection are tested.

## Performance Findings

- Re-levelling is a single topological pass over the affected sub-graph, plus one query for external head levels.
- Unchanged rows are no longer rewritten.
- The ancestor walk is a BFS, one query per tier, with the existing depth guard.

## Known Limitations

- **A54:**
  - CSV import can't set head 2; import validation does respect existing ones.
  - The chart's department/sub-division grouping still hangs off head 1, with head 2 drawn as an extra line.
- **Employees page:** the employee detail page's "Manager" line still shows head 1 only.
- **Details panel:** the organogram details panel has no reports-to row (none existed before).

## Decisions Added

- **D27:** co-heads
- **A54:** app-only head 2, and the branch-delete refusal
- **C13:** amended

## Gate Result

**PASS WITH NON-BLOCKING ITEMS.** The non-blocking items are the Known Limitations above.

## Recommended Next Phase

Organogram card spacing and department segregation, plus the Visily colour palette (requested 2026-09-28).
