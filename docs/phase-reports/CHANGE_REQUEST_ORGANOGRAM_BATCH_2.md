# Change Request Report — Organogram batch 2 (level names, department reorder, Levels Mapping columns)

Date: 2026-09-29 · Branch: `organogram-batch-2` · Decisions: D32, D33, D34

## Phase Objective

1. Drag departments to reorder them (left / right / in between) on the organogram.
2. Reconnect any card to another department or position, bringing its branch along; listings and the database follow. This already existed (D29) and is re-verified here.
3. In Add Position, the Level dropdown shows a department's own level names when it has them, otherwise the standard names.
4. Levels Mapping: add or remove departments **and sub-divisions** as columns (previously only departments with a ladder, e.g. Human Resources and IT).

## Scope

Stakeholder answers (2026-09-29): departments may be reordered anywhere; columns use **show / hide**; the lower tier is **sub-divisions**.

Schema change: one migration, `20260929120000_levels_mapping_columns`.

- `Department.showInLevelsMapping`, backfilled to true where the department has a ladder, so no column disappears.
- `JobFamily.showInLevelsMapping`.
- New table `job_family_level_titles`.

It is added to `EXPECTED_MIGRATIONS`. **Vercel does not run migrations:** apply with `prisma migrate deploy` before deploying.

## Acceptance Criteria

| #   | Criterion                                                                        | Evidence                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Department drag saves the left-to-right order; the layout keeps it               | `department.integration.test.ts` (reorderDepartments), `departments/actions.test.ts`, `organogram-leadership-graph.test.ts`, e2e `organogram-drag-drop.spec.ts` (department reorder) |
| 2   | Moving a card moves its branch; refuses self / subordinate                       | existing D29 suites (`move-position-to-department.integration.test.ts`, e2e drag-drop)                                                                                               |
| 3   | Level dropdown uses department names, then job-grade name, then standard         | `level-labels.test.ts`, `position-form-dialog.test.tsx`                                                                                                                              |
| 4   | Add / remove department and sub-division columns; names kept when hidden         | `levels-mapping-view.test.tsx`, `levels-mapping-columns.test.ts`, `levels-mapping-columns.integration.test.ts`                                                                       |
| 4   | Sub-division names preferred in Add Position                                     | `level-labels.test.ts` ("sub-division names (D34)")                                                                                                                                  |
| 4   | Only `career:manage` can change columns / names; companyId never from the client | `levels-mapping/actions.test.ts` (forbidden, unauthenticated, strict schema, malformed input)                                                                                        |
| 4   | Company isolation; cascade with the sub-division; no audit on a no-op            | `levels-mapping-columns.integration.test.ts`                                                                                                                                         |

## Negative scenarios covered

- A cross-company department or sub-division is refused. The row is unchanged.
- An unknown level code is refused.
- A duplicate name in the same cell is refused; the same name on the other ladder is allowed.
- Another company's name cannot be renamed or deleted.
- A malformed id, unknown target, non-boolean flag or client-supplied `companyId` is rejected before the service runs.
- A viewer gets no picker and no remove / add / edit controls.
- A failed column change shows the server's message and leaves the grid as it was.

## Spec changes to existing tests

- The Levels Mapping test "hides a department with no career ladders" became "hides a department whose columns are turned off". Visibility is now HR's choice (D34), not derived from ladders.
- The Organogram view test now mocks the departments actions module, which the view imports since D33.

## Known limitations

- The column choice is company-wide. It is not per-viewer.
- CSV import does not set level names.
