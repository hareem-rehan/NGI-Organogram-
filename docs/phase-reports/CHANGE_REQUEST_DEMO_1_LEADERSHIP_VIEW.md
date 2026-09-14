# Change Request — Demo 1 stakeholder feedback (Leadership view)

**Date:** 2026-09-14
**Type:** Refinement of shipped functionality, not a new phase. No feature was rebuilt; the existing architecture, navigation, export pipeline and working features were preserved.
**Decisions:** `docs/DECISIONS.md` §2b, D1–D8.

## What was asked

1. Make the **department** the first grouping level below the Founder/CEO, preserving expand/collapse and drill-down.
2. Show only employees at **L7 and above** as named cards — based on the position's level, not on hard-coded job titles — without deleting anyone.
3. Simplify the card to **name, level, role title**; drop employee codes, internal ids, the repeated department name and other descriptive text.
4. Remove **vacant positions** from the organogram (not from the database), and review the dashboard's vacancy cards.

## What shipped

### The projection (items 1, 2, 4)

`lib/domain/organogram-leadership.ts` (already present) decides visibility and display parentage. New this change:

- **`lib/domain/organogram-leadership-graph.ts`** turns that into an ordinary `OrganogramNode[]`/`OrganogramEdge[]` pair. This is the design decision that kept the change small: the canvas, Outline View, collapse/expand, search, focus modes, filters and the SVG export all keep consuming the same two shapes and need no knowledge of a department tier. Only the two places that _draw a card_ read `kind`.
- **`getOrganogramChartData`** (new, in `lib/services/organogram.service.ts`) = `getOrganogramData` + the projection. `getOrganogramData`'s contract is **unchanged** — it still returns every safe position, which is what its integration tests and every non-chart caller rely on. The interactive chart and the export both read the new function, so an exported file can never show a different organogram from the screen it came from.

Invariants honoured explicitly:

- A department heading is **not** an organizational level (`CLAUDE.md` §2). It carries `organizationalLevel: 0` — outside the real 1-based scale by construction — and its tier lives in a separate display-only `displayDepth` field.
- The threshold reads the **stored job grade**, never the title. `lib/domain/job-grade-mapping.ts`'s title inference is used only by the offline backfill script, never at render time.
- Nothing writes. A hidden position is untouched in the database and still appears on `/positions`, in the dashboard counts and in the audit log.

### The card (item 3)

`position-node.tsx` now renders occupant → role title → grade code, and `NODE_HEIGHT` dropped 152 → 108. `lib/domain/export/svg-renderer.ts` draws its own copy of the card and was changed **in lockstep**; both now also have a distinct department-heading variant (filled, uppercase, role count, no occupancy dot, not selectable).

The card's **accessible name deliberately keeps the department and organizational level.** A screen-reader user cannot see that a card sits underneath its department heading. Removing visual clutter was the request; removing context from assistive technology was not.

The Outline View row was changed to match: occupant → title → grade, in place of the repeated `Department · Level N`.

### The dashboard (item 4)

The "Vacant Positions" summary card and the "Vacancy overview" section were removed. **Not** removed: the per-department Vacant column, the `vacancyRate` metric the dashboard service still computes, or `/positions?status=ACTIVE&occupancy=vacant`.

### Data

The chart reads stored grades, so grades had to exist:

- `prisma/seed.ts` now seeds the real **L2–L18** scale instead of an invented three-rung L4/L5/L6 ladder, and each seeded position was remapped onto it. On the old ladder nothing but the CEO cleared L7, so the seeded chart rendered essentially empty.
- **`scripts/backfill-job-grades.ts`** (new) ensures the scale exists for a company and fills in missing grades by inferring from the title. **Dry run by default**; `--apply` to write. It never overwrites a grade a human already set, and lists the titles it could not map rather than guessing.

## Verification

| Gate             | Result                                                  |
| ---------------- | ------------------------------------------------------- |
| `tsc --noEmit`   | clean                                                   |
| `eslint .`       | 0 errors (3 pre-existing warnings, all untouched files) |
| Unit (Vitest)    | **1102 passed / 97 files**                              |
| Integration      | **352 passed / 28 files**                               |
| E2E (Playwright) | **128 passed** at `--workers=1`                         |

New coverage: 15 tests for the graph projection, 6 for the department card and displayed-vs-real report counts, 4 for the department card in the SVG export, 2 in the Outline View, plus 2 new E2E tests (below-threshold and vacant positions absent from the chart but present on `/positions`; a department card that expands but never opens the details panel).

### Tests that were deliberately reversed

Per `CLAUDE.md` §14, each of these is a test whose **premise** the stakeholder changed. None was skipped, loosened or deleted silently — each was rewritten to assert the new truth, with a dated comment saying what changed and why, and each still asserts that the underlying data is intact:

- `dashboard-view.test.tsx` — "links the vacant-positions card" → asserts the card and overview section are **gone and stay gone**.
- `dashboard.spec.ts` — the same, plus: the vacancy-filtered Positions view still works when navigated to directly.
- `organogram-search-and-focus.spec.ts` — "a vacant position is fully searchable" → a vacant position is absent from the chart's search **and still listed on `/positions`**. "Filter by occupancy — occupied" → the chart is already occupied-only, so `Vacant` is now the filter that matches nothing.
- `organogram-outline-view.test.tsx` — row queries now anchor on the occupant, matching the person-first card order.

### Other test-fixture changes

The E2E specs built hierarchies the chart now correctly declines to draw (ungraded and vacant). `e2e/support/chart-fixtures.ts` (new) seeds grades and occupants directly — the same approach `seed-session.ts` already takes for Company/User/Session rows. The position and assignment **UIs** remain covered end-to-end by `positions.spec.ts` and `employees.spec.ts`; these specs are about the chart. `tests/integration/fixtures.ts` gained `makeLeadershipJobGrade` and a bulk `makeOccupiedLeadershipPositions` so the export scale tests still push 300–400 real nodes through the renderer.

Visual-regression baselines were regenerated (`--update-snapshots=all`) and re-verified green; the new `organogram-visual-view` baseline shows the department tier and the compact cards.

## Known flakiness (pre-existing, not introduced here)

Playwright drives `next dev`, so a test can be waiting on a Turbopack route compile or a cold server-action round-trip rather than on the app. Under parallel workers this blows the 30-second default — the DEF-001 contention already recorded for this project.

What was actually measured on this machine:

| Run                                                                            | Result                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--workers=1`, idle machine                                                    | **128 passed**, 7.7 min                                                                                                                                           |
| `--workers=2`, CI-like, before                                                 | 10 failed / 77 passed, 13.7 min                                                                                                                                   |
| `--workers=2`, CI-like, after the route warm-up                                | 5 failed / 92 passed, 9.6 min                                                                                                                                     |
| `--workers=2`, CI-like, while a full Vitest run was competing for the same CPU | 9 failed / 67 passed, 16.1 min — and the failures had spread to `departments.spec.ts`, `employees.spec.ts` and `users.spec.ts`, none of which this change touches |

That last row is the diagnostic one: on a loaded machine the failures land in specs unrelated to this work, and the failing step is always a navigation or a dialog round-trip, never an assertion about the chart. Every affected spec passes in isolation.

Two mitigations were added:

- `e2e/auth.setup.ts` now **warms** `/organogram`, `/positions`, `/employees` and `/dashboard` once, in the setup project — the only point in the run where a route can be compiled without workers racing for it. This halved the CI-like failure count and cut 4 minutes off the run.
- `playwright.config.ts` raises the per-test timeout to 60s **in CI only**. This is headroom for the compile; a genuinely broken assertion still fails, just later.

Being straight about the second one: it could not be shown to help under clean conditions, because the machine was never quiet enough during that run to isolate it. It is a reasoned mitigation, not a measured fix.

## Not done, and why

The dashboard's per-department **Vacant column** was left in place. The request named the summary _cards_; a data table column is a different thing, and removing data the stakeholder did not ask to lose is not a call to make unilaterally. It is a one-line change if they want it.
