# Change Request Report — Organogram round 3 (drag-and-drop, cards, colours, delete rule, employee list)

Date: 2026-09-28 · Branch: `organogram-dnd-and-cards` · Decisions: D29 (D20 and D21 amended)

## Phase Objective

Eight stakeholder requests:

1. Drag and drop onto any position or department; the branch moves along; refuse self/subordinate drops.
2. Vivid, readable colours; medium boxes that are clear on open; clean, bold key text.
3. Boxes show title, person, level, and roles under at the bottom.
4. Sub-division colour mode shows only sub-divisions.
5. A colour picker when creating a department.
6. Correct Level in the employee table.
7. A Sub-division column in the employee table.
8. Deleting a vacant position must not be blocked by past history.

## Scope

Stakeholder answers (2026-09-28):

- Drop on a department → join the department and report to its top position.
- Delete allowed if nobody holds the position now.
- Sub-division mode → only sub-division colours.
- Box count → everyone under it.

Visual and hierarchy changes only. No schema change and no migration.

## Acceptance Criteria

| #   | Criterion                                                                                                         | Evidence                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Drop onto a card re-parents; drop onto a department heading moves the position and its branch into the department | `move-position-to-department.integration.test.ts` (9); `e2e/organogram-drag-drop.spec.ts` (real mouse)             |
| 1   | Self/subordinate drops refused with a reason, before any dialog                                                   | `organogram-drag.test.ts`; e2e "refuses a drop onto the card's own subordinate"                                    |
| 2   | Medium cards, bold key text, readable opening zoom, vivid AA colours                                              | `organogram-family-colors.test.ts` (every swatch/palette/any colour ≥ 4.5:1); e2e screenshot                       |
| 3   | Title, person, level, "N roles under" (whole branch)                                                              | `organogram.test.ts` totalReportCount; `position-node.test.tsx` roles-under footer; export renders the same footer |
| 4   | Sub-division mode: only sub-divisions coloured                                                                    | canvas resolver + `svg-renderer.test.ts` neutral headings/unclassified cards                                       |
| 5   | Visible custom colour picker                                                                                      | `color-swatch-picker.test.tsx`                                                                                     |
| 6/7 | Employee list: job level + Sub-division column                                                                    | `employees-view.test.tsx`; integration `listCurrentAssignmentsForEmployees`                                        |
| 8   | Vacant position with past history deletable; current holder blocks and is named                                   | `position-hierarchy.integration.test.ts` (4 new/updated tests)                                                     |

## Business Rules

- **Hierarchy invariants** (CLAUDE.md §2) hold through the new department move. It reuses `movePosition` (locking, cycle checks through both heads, level recalculation) and runs in one transaction.
- **Levels on a department move:** job levels are department-scoped, so each moved position's level is re-mapped to the same code in the new department. The sub-division of the old department is cleared.
- **D20 amended:** past assignment history is removed with a deleted position, each removal audited with its full before-snapshot. The current holder still protects the position.

## Scenario Matrix

`docs/NEGATIVE_SCENARIOS.md` → new section "Organogram round 3 (D29)" (14 rows), each mapped to a test.

## Files Changed

**Services**

- `lib/services/hierarchy.service.ts`: `movePositionToDepartment`, `clearPastAssignmentsOrRefuse`
- `lib/domain/audit/allowlists.ts`: adds `coReportsToPositionId` (a gap left by D27)

**Domain**

- New: `lib/domain/organogram-drag.ts`
- `lib/domain/organogram.ts`: `totalReportCount`
- `lib/domain/organogram-family-colors.ts`: `vividFill`, `contrastRatio`, purple lift
- `lib/domain/export/svg-renderer.ts`

**Organogram**

- `app/(app)/organogram/_components/organogram-canvas.tsx`: drop judging, hover rings, overlap targeting, readable framing
- `organogram-view.tsx`
- `position-node.tsx`
- `_lib/elk-layout.ts`: 216×112 cards, compact spacing

**Positions**

- `app/(app)/positions/actions.ts`: `movePositionToDepartmentAction`, `getSubtreeIdsAction`
- `positions-view.tsx`: delete wording

**Employees**

- `lib/repositories/employee.repository.ts`
- `employees-view.tsx`

**Components**

- `components/patterns/color-swatch-picker.tsx`

**Tests**

- New:
  - `lib/domain/organogram-drag.test.ts`
  - `tests/integration/move-position-to-department.integration.test.ts`
  - `e2e/organogram-drag-drop.spec.ts`
  - `e2e/support/department-layout-fixtures.ts` (`readPositionByTitle`)
- Updated: the unit, component and integration tests listed below.

**Docs**

- `DECISIONS` (D29; D20 and D21 amended)
- `ORGANOGRAM_RENDERING`
- `HR_USER_GUIDE` (§4, new §5.6, §6, §7, §13)
- `AUTHORIZATION_MATRIX`
- `NEGATIVE_SCENARIOS`

## Migrations

None.

## Commands Executed

```
npm run typecheck                                       → clean
npm run lint                                            → 0 errors, 7 warnings (all pre-existing)
npx prettier (app components lib tests e2e docs)        → clean
npm test                                                → 110 files, 1404/1404 passed
npm run test:integration                                → 33 files, 461/461 passed
npm run test:e2e -- --grep-invert "Organogram visual regression"
                                                        → 130/130 passed (run twice)
npm run build                                           → Compiled successfully
```

## Test Results

All green.

## Failures Discovered

- **E2E drag test (in isolation):** the first drag test couldn't reach a card below the canvas's clipped area. The test now clicks Fit to View and scrolls the canvas into view first.
- **E2E drag test (full parallel run):** it pressed the mouse while the zoom was still animating. It now waits until the card positions settle. After the fix, two consecutive full runs passed.
- **Opening framing:** the opening view first ran before React Flow had measured the canvas, so it fell back to fit-everything and cards looked tiny. It now waits for the canvas size, which the screenshots confirm.

## Fixes Applied

As above. Also:

- The drop target is now the card with the largest overlap, not the first one listed.
- The sub-division palette's purple was 3.4:1 and has been lifted to ≥ 4.5:1.

## Regression Results

Every pre-existing test passes. Tests whose **specified behaviour changed on request**, each replaced by assertions of the new behaviour:

- **Card footer** (`position-node.test.tsx`): "N direct reports" became "N roles under".
- **Employee list** (`employees-view.test.tsx`): the old test asserted the chart-depth "1" in the Level column, which was the reported bug. It now asserts the job level and that "1" is absent.
- **Colour test** (`organogram-family-colors.test.ts`): the non-reference colour now gets the vivid fill instead of the 34% tint.
- **Delete tests** (`position-hierarchy.integration.test.ts`): renamed to "current holder". Their assertions were unchanged, because those fixtures already used a current holder. New tests cover the past-history case.

## Coverage Gaps

- The Radix popover can't open in jsdom (known). Drag-and-drop is covered by a real-mouse e2e test.
- The screenshot-comparison suite (`organogram-visual.spec.ts`, which CI excludes) was not re-baselined; it needs new snapshots.

## Accessibility Findings

- Every card fill, whether from a reference swatch, the sub-division palette, or any custom colour, keeps text ≥ 4.5:1 (unit-tested).
- Secondary text on filled cards uses the foreground colour.
- The custom colour control is a labelled, keyboard-reachable input.
- The axe scans in `accessibility.spec.ts` pass as part of the 130 e2e tests.

## Security Findings

- The new mutating action is gated on `positions:manage`, with strict zod validation; VIEWER denial and malformed input are tested.
- The subtree lookup is `positions:view` and company-scoped.

## Performance Findings

- `totalReportCount` does one DFS per safe node, which is fine at the 2,000-position cap.
- Compact spacing reduces the layout area.

## Known Limitations

- A drop onto a department picks the department's top position automatically (by level, then title). To choose a specific head, drop onto that person's card instead.
- The employee detail page's "Manager" line still shows head 1 only (carried over from D27).

## Decisions Added

- **D29**
- **D20:** amended
- **D21:** extended

## Gate Result

**PASS WITH NON-BLOCKING ITEMS.** The non-blocking items are the Known Limitations above, plus re-baselining the screenshot-comparison suite.

## Recommended Next Phase

Re-baseline `organogram-visual.spec.ts`, then do a UAT pass on staging data.
