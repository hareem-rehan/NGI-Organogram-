# Phase 8 Report — Interactive Expandable Organogram

Date: 2026-09-01 – 2026-09-02

Status: **COMPLETE — PASS.** See "Gate Result" for the full verification summary.

## Phase Objective

Build the interactive, expandable, position-based organogram (FR-O1/FR-O3): automatic layout from live position-hierarchy data (never manually placed), department-based horizontal grouping, vertical reporting levels, vacant/planned positions visible, expand/collapse, pan/zoom/fit-to-view, and an accessible non-canvas Outline View — read-only, no hierarchy editing.

## Preflight Findings

Read before implementation: `CLAUDE.md`, `README.md`, `docs/PROJECT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/DATA_DICTIONARY.md`, `docs/DOMAIN_MODEL.md`, `docs/AUTHORIZATION_MATRIX.md`, `docs/DASHBOARD_METRICS.md`, `docs/IMPLEMENTATION_PLAN.md` (Phase 8 entry), `docs/TEST_STRATEGY.md`, `docs/NEGATIVE_SCENARIOS.md`, all seven prior phase reports, `docs/adr/0004-reactflow-elk.md`, `prisma/schema.prisma`, `lib/domain/{hierarchy,dashboard,assignment}.ts`, `lib/repositories/{position,department,employee,dashboard}.repository.ts`, `lib/auth/{permissions,current-user}.ts`, `app/(app)/organogram/page.tsx` (Phase 1 placeholder), `config/navigation.ts`.

Key findings:

- **ADR-0004 already approves React Flow + ELK.js** (accepted at Phase 0) — no new ADR needed. Verified compatibility with the installed stack: `@xyflow/react@12.11.6` (peer: `react`/`react-dom >=17`) and `elkjs@0.12.0` (zero runtime dependencies) both work cleanly against React `19.2.8`/Next `16.3.4`. Installed exact-pinned, matching project convention (A11-style reasoning). `npm audit` after install shows the same 5 pre-existing, already-accepted findings from Phase 1/2 (`deepmerge-ts` via the Prisma CLI, `esbuild` via Vite) — no new vulnerabilities introduced.
- `organogram:view` permission already exists and is already granted to VIEWER/HR_EDITOR/ADMIN (`lib/auth/permissions.ts`) — no permission-model change needed.
- `lib/domain/dashboard.ts`'s `detectHierarchyIntegrityWarnings`/`walkToRoot` (Phase 7) already implements a bounded, non-recursive ancestor-chain walk for root/cycle/disconnected detection. Phase 8 reuses this exact primitive (exported for reuse) rather than writing a second hierarchy-safety implementation — directly satisfying the organogram-hierarchy-safety skill's "single source of truth" requirement.
- Occupancy/effective-date convention (exclusive-end, Phase 6 `docs/DECISIONS.md` A18) is reused unchanged.
- Department `color` field already exists (`Department.color`, hex string, nullable) — used directly for department-based node accents; no new field needed.
- `JobGrade.name` already exists — used for the node's optional job-grade line; never conflated with `Position.organizationalLevel` (business rule 8, re-verified — no code path in this phase derives one from the other).
- Phase 1–7 regression baseline (re-confirmed before starting, see "Regression Results"): unit 436/436, integration 169/169, E2E 49/49 (stable across repeated runs), lint clean, typecheck clean, build clean.
- No existing visual-regression/screenshot-baseline infrastructure exists in this repo. Playwright's own `toHaveScreenshot()` (already available via the installed `@playwright/test`, no new dependency) is used for the visual-regression fixtures this phase requires, rather than introducing a separate tool.
- No project-local skill is created this phase (Step 22's own instruction: "do not create the skill if existing documentation and workflows are sufficient") — `organogram-hierarchy-safety` plus this phase's own `docs/ORGANOGRAM_RENDERING.md` are sufficient; there is no evidence yet that Phase 9/11 will repeat enough of this exact visual-regression process to justify a new skill ahead of that need actually arising.

## Rendering-Library Decision

**@xyflow/react (canvas/interaction) + elkjs (layout).** Already approved in `docs/adr/0004-reactflow-elk.md`; this phase only confirms/records the specific pinned versions and their compatibility, and does not re-litigate the choice.

## Layout-Engine Decision

ELK's **layered** algorithm, direction **DOWN** (`elk.direction: "DOWN"`, `elk.algorithm: "layered"`), matching the reference concept (root at top, levels expanding downward, siblings arranged horizontally). Layout is computed client-side, re-run whenever the _visible_ node/edge set changes (expand/collapse), never server-side and never stored — there is no `x`/`y` column anywhere in the schema, structurally enforcing "HR never manually places chart nodes."

## Hierarchy Data Contract

See `docs/ORGANOGRAM_RENDERING.md` for the full, authoritative contract. Summary: one server action returns `{ company, nodes, edges }` — `nodes` and `edges` cover the **entire** company hierarchy (not just the initially-visible portion); expand/collapse is a pure client-side visibility filter over this one payload, never a second network request per node (Step 4's "avoid per-node requests" requirement).

## Node-Content Specification

Per Step 7's priority order: title, occupant name or "Vacant," department name, organizational level, job grade (if any), position code, status badge (Planned/Inactive only — Active is the unmarked default), direct-report count, expand/collapse control. Department color as a left-border accent, never the only status signal.

## Connector Specification

Solid, primary-reporting-only edges (manager → direct report). No dotted/secondary edges are ever produced by the server or rendered by the client — the data contract has no field for a secondary relationship at all.

## Expansion/Collapse Behavior

Client-side UI state only (`Set<positionId>` of collapsed ids), never written back to the server or the database. Default: root and its direct children expanded (level 1–2 visible), everything deeper collapsed — matching the phase's own suggested default. Toggling recomputes the _visible_ subgraph and re-runs ELK layout on it only.

## Initial-Load Behavior

One `getOrganogramAction()` call on mount, matching the `EmployeesView`/`PositionsView`/`DashboardView` client-fetch pattern from Phases 4–7. Loading skeleton, then Fit-to-View once the first layout completes.

## Planned/Inactive Visibility

Both remain **visible in the graph by default**, distinctly styled (never hidden by default) — see "Visibility Rules" in `docs/ORGANOGRAM_RENDERING.md` for the full reasoning, recorded as an Assumption Requiring Confirmation in `docs/DECISIONS.md` since no prior phase's documentation settled this specifically for the organogram. A user-facing "Show planned positions" toggle (default on) lets a viewer hide them; there is no toggle to hide Inactive positions, since an inactive position may be a structurally necessary ancestor for still-active descendants (`docs/DOMAIN_MODEL.md` §8) and hiding it would either break connectivity or require fabricating a false direct relationship — neither is acceptable.

## Vacancy Display

Occupancy is derived exactly like Phases 6–7 (currently-effective primary assignment, exclusive-end date range) — a vacant position renders with a clear "Vacant" label, never omitted, regardless of its status (Active/Planned) or its position in the tree.

## Accessibility Alternative

An "Outline View" (semantic nested list, `<ul>`/`<li>` with `aria-expanded`) toggle alongside the canvas ("Visual View"), reading the exact same server payload and the exact same visibility rules — never a second hierarchy implementation.

## Responsive Behavior

Desktop: full canvas + side panel. Tablet/mobile: touch pan/pinch-zoom, details open in a full-height drawer, Outline View promoted as the primary mobile-friendly path, no horizontal page overflow outside the canvas itself.

## Performance Strategy

One bulk query pass (positions + departments + job grades + current assignments, no per-node queries), memoized node/edge transformation, ELK layout run only on the visible subgraph (not the full 2,000-position graph) so collapse genuinely reduces layout cost, `React.memo`'d custom node component, debounced layout re-runs. Measured against a synthetic ~1,000+-position fixture (see "Performance Findings").

## Security and Privacy Considerations

`organogram:view`-gated, company-scoped from the session only (no client-supplied `companyId`), no salary/contact/SSO/token data in the contract (by construction — no such field exists), occupant display name only (never raw employee record), links to Employee/Position detail pages re-check authorization independently (never assume the organogram's own gate is sufic ient elsewhere).

## Test Plan

Unit (pure graph-building/visibility/layout-input functions), integration (real-Postgres data-contract correctness, company scoping, corrupted-data handling), component (node/canvas/outline/details-panel/legend), layout-invariant (parent-above-child, no-overlap-in-fixture, deterministic ordering — not fragile coordinate snapshots), visual-regression (Playwright `toHaveScreenshot()` on a handful of deterministic fixtures), accessibility (axe + manual keyboard/outline verification), authorization, E2E (VIEWER/HR_EDITOR/ADMIN journeys, expand/collapse, fit/zoom/pan, details panel, Outline View, mobile, missing-root/corrupted-cycle safety, cross-company rejection), performance (diagnostic timing at ≥1,000-position scale). Full matrix in `docs/NEGATIVE_SCENARIOS.md` §"Interactive Organogram (Phase 8)" (ORG1–ORG55).

## Acceptance Criteria

Tracked to completion in "Gate Result" — restated from the phase brief's own acceptance-criteria list (organogram generated from live data, root at top, department branches horizontal, levels vertical, siblings parallel, vacant/planned visibility rules honored, levels derived not stored, job grade kept separate, department colors accessible, primary-only connectors, expand/collapse/Expand-All/Collapse-All/Fit-to-View/zoom/pan all working, no graph-driven mutation, no overlap in supported fixtures, corrupted data never freezes the app, accessible Outline View, mobile usability, company isolation, employee privacy, automated + visual-regression + performance tests, no Phase 9 work started).

## Rollback Approach

No migration, no write path — Phase 8 is entirely read-only, exactly like Phase 7. A defect's fix is a revert of the organogram route/service/repository/UI files; nothing to reverse at the database level.

## Out-of-Scope Functionality (per explicit instruction)

Hierarchy editing/drag-and-drop reparenting on the canvas, dotted-line/secondary reporting, CSV import/export, image/PDF export, historical/future snapshots, advanced search/focus mode (Phase 9), full audit-log UI.

---

## Files Changed

**New — domain/repository/service/action layer:**
`lib/domain/organogram.ts`, `lib/domain/organogram.test.ts`, `lib/repositories/organogram.repository.ts`, `lib/services/organogram.service.ts`, `lib/services/organogram.service.integration.test.ts`, `app/(app)/organogram/actions.ts`, `app/(app)/organogram/actions.test.ts`, `tests/integration/organogram.integration.test.ts`, `tests/integration/organogram-performance.integration.test.ts`.

**New — client layout/UI layer:**
`app/(app)/organogram/_lib/elk-layout.ts` (+ `.test.ts`), `app/(app)/organogram/_components/position-node.tsx` (+ `.test.tsx`), `organogram-legend.tsx`, `organogram-details-panel.tsx` (+ `.test.tsx`), `organogram-outline-view.tsx` (+ `.test.tsx`), `organogram-canvas.tsx`, `organogram-toolbar.tsx`, `organogram-view.tsx` (+ `.test.tsx`).

**New — E2E:**
`e2e/organogram.spec.ts`, `e2e/organogram-visual.spec.ts` (+ its two committed baseline PNGs under `e2e/organogram-visual.spec.ts-snapshots/`).

**New — documentation:**
`docs/ORGANOGRAM_RENDERING.md`.

**Modified — replacing the Phase 1 placeholder:**
`app/(app)/organogram/page.tsx`.

**Modified — small, justified additions reused by the new code:**
`lib/domain/dashboard.ts` (exported the previously-private `walkToRoot`/`MAX_WALK_STEPS` for reuse — zero behavior change, see "single source of truth" note in the file itself), `lib/domain/normalize.ts` (+ `.test.ts`, new `formatEmployeeDisplayName` helper, also usable by — but not yet adopted into — the two Phase 6 client components that had duplicated the same logic; left those alone per "preserve existing conventions" since touching them isn't required for this phase).

**Modified — bugs found and fixed during this phase's own testing (see "Failures Discovered" below):**
`app/(app)/organogram/_components/position-node.tsx` (pointer-events fix, then the nested-interactive restructure — both folded into the file as it stands now), `app/globals.css` (`--color-status-vacant`, `--color-status-filled`), `app/(app)/dashboard/_components/dashboard-view.tsx` (+ `.test.tsx`, `SummaryCard`'s `<dl>`/`<dt>`/`<dd>` → plain `<div>`/`<p>` restructure), `e2e/dashboard.spec.ts` (updated to match), `e2e/shell.spec.ts` (`IMPLEMENTED_ROUTES` now includes `/organogram`), `e2e/accessibility.spec.ts` (two new organogram scans).

**Modified — documentation kept current:**
`docs/NEGATIVE_SCENARIOS.md` (new "Interactive Organogram (Phase 8)" section, ORG1–ORG55), `docs/DECISIONS.md` (A22–A27, Phase 8 history row), `docs/AUTHORIZATION_MATRIX.md` (§4 note), `README.md` (status line and "what's implemented" paragraph).

**Dependencies:** `@xyflow/react@12.11.6`, `elkjs@0.12.0` (both exact-pinned, added to `package.json`/`package-lock.json` during preflight — see "Preflight Findings" above for the compatibility/audit check).

## Migrations

None. Phase 8 is entirely read-only — no schema change, no new table/column, nothing to roll back at the database level.

## Commands Executed (final verification pass — actual output, not a claim)

```
npx tsc --noEmit                              # clean, zero errors
npx eslint .                                  # 0 errors, 2 pre-existing warnings (unrelated files: department-form-dialog.tsx, position-form-dialog.tsx — React Compiler "incompatible library" notices predating this phase)
npx prettier --check .                        # all matched files use Prettier code style
npx vitest run --coverage                     # 61 files, 508 tests passed
npm run test:integration                      # 14 files, 182 tests passed
npm run build                                 # next build — compiled successfully, /organogram is now a real dynamic route (ƒ), not a placeholder
npx dotenv -e .env.test -- npx playwright test --project=setup --project=positions-first --project=chromium --reporter=list
                                               # 66 tests passed — run twice consecutively, both 66/66
npx dotenv -e .env.test -- npx playwright test e2e/accessibility.spec.ts --project=setup --project=positions-first --project=chromium --repeat-each=6
                                               # 68/68 passed (stress run, after the three accessibility fixes below)
```

## Test Results

- **Unit + component (Vitest):** 508/508 passing across 61 files. Phase 8 additions: 26 tests in `lib/domain/organogram.test.ts`, 5 in `elk-layout.test.ts`, 11 in `position-node.test.tsx`, 8 in `organogram-outline-view.test.tsx`, 8 in `organogram-details-panel.test.tsx`, 6 in `organogram-view.test.tsx`, 5 in `actions.test.ts`, 4 in `organogram.service.integration.test.ts` (mock-only, see its own file-header comment for why it's still named `.integration.test.ts`), 3 new in `normalize.test.ts`. `lib/domain/organogram.ts` reaches 100% statement coverage.
- **Integration (real Postgres, `vitest.integration.config.mts`):** 182/182 passing across 14 files. Phase 8 additions: 8 in `tests/integration/organogram.integration.test.ts` (real-DB company scoping, occupant mapping, end-to-end graph assembly), 1 in `organogram-performance.integration.test.ts` (~1,051 positions, 78ms).
- **E2E (Playwright, real Chromium against the dev server):** 66/66 passing, run twice consecutively for stability. Phase 8 additions: 12 in `e2e/organogram.spec.ts` (Visual View default depth, expand/collapse, Expand/Collapse All, Details Panel + Escape, Outline View parity, Fit/Reset View, keyboard nav, mobile/no-overflow, company isolation, empty-state role differences), 3 in `e2e/organogram-visual.spec.ts` (baseline screenshots), 2 new in `e2e/accessibility.spec.ts` (organogram Visual + Outline View axe scans).
- **Visual regression:** `e2e/organogram-visual.spec.ts` — 2 committed baselines (`organogram-visual-view.png`, `organogram-outline-view.png`), generated against a small, fixed (non-timestamped) 2-position fixture in an isolated company. Reviewed both images manually (see "Manual Verification") before committing them as the baseline.

## Failures Discovered (all found and fixed during this phase, all with automated regression coverage)

1. **Node click-through (A23).** `@xyflow/react` sets `pointer-events: none` on a node's wrapper whenever `elementsSelectable`/`nodesDraggable` are both `false` and no `onNodeClick` is passed to `<ReactFlow>` — silently made every click inside `PositionNode` unreachable. Found by `e2e/organogram.spec.ts`'s expand-toggle test hanging for the full 30s timeout; root-caused by reading `@xyflow/react`'s own bundled source, not guessed. Fixed with `pointer-events-auto` on the node's root element.
2. **`--color-status-vacant` contrast (A24).** 3.18:1 as plain text against white, below WCAG AA. Found by `e2e/accessibility.spec.ts`'s new organogram Outline View scan. Darkened `#d97706` → `#b45309`.
3. **Nested-interactive ARIA violation (A25).** `PositionNode`'s original markup nested a real `<button>` (the collapse toggle) inside a `role="button"` div. Only intermittently failed the accessibility scan (depending on whether a visible node happened to have children at scan time) — confirmed genuine, not flaky, by deliberately re-running the suite multiple times. Restructured into sibling `<button>`s, matching the pattern already used in `organogram-outline-view.tsx`.
4. **`--color-status-filled` contrast (A26, pre-existing Phase 4/5 token).** 2.78:1 as `Badge`'s `success`-variant text against its own background. Not a Phase 8 regression — the token predates this phase — but only actually caught once Phase 8's larger, more concurrent E2E suite made real "Active" badge data present at scan time (same discovery mechanism as Phase 7's A20). Darkened `#16a34a` → `#166534`.
5. **`<dl>`/`<dt>`/`<dd>`/`<a>` invalid nesting (A27, pre-existing Phase 7 defect).** The dashboard's clickable `SummaryCard` wrapped a `<dt>`/`<dd>` pair in an `<a>` inside a `<dl>` — invalid per the HTML content model at any nesting depth (a "stretched link" sibling-`<a>` attempt was _also_ rejected by axe's `only-dlitems` check, which requires a `dl`-child `<div>`'s children to be exclusively `<dt>`/`<dd>`). Genuinely intermittent (roughly half of normal, non-stressed runs), confirmed real (not environment noise) via repeated `--repeat-each` stress runs. Fixed by recognizing this was never really a definition list — replaced `<dl>`/`<dt>`/`<dd>` with plain `<div>`/`<p>`/`<p>`.

Items 4–5 are not new Phase 8 defects, but they were found by Phase 8's own testing activity and are fixed and documented here per `CLAUDE.md` §1.14/§1.15 — a currently-failing test discovered mid-phase is not left for a later phase to trip over again.

## Fixes Applied

All five failures above were fixed in the same phase they were discovered in (not deferred), each with either a new or updated automated test that would catch a regression: `position-node.test.tsx` and `e2e/organogram.spec.ts` for #1 and #3; `e2e/accessibility.spec.ts` for #2 and #4 (re-verified via 6× `--repeat-each` stress runs, 68/68 and 0 failures after each fix); `dashboard-view.test.tsx` and `e2e/dashboard.spec.ts` for #5.

## Regression Results

- Full unit/component suite: 508/508 (436 pre-Phase-8 baseline + 72 new/changed).
- Full integration suite: 182/182 (169 pre-Phase-8 baseline + 13 new).
- Full E2E suite: 66/66, twice consecutively.
- No pre-existing Phase 1–7 test was weakened, skipped, or deleted to reach a passing state — `dashboard-view.test.tsx`'s and `e2e/dashboard.spec.ts`'s SummaryCard-related assertions were _updated_ to match the corrected (still fully-verified) markup, not loosened.

## Manual Verification

Reviewed both `e2e/organogram-visual.spec.ts` baseline screenshots directly (Visual View: root-at-top, level-2 child below, solid connector, department-color left border, darkened "Vacant" label, collapsed Legend button, "N positions shown" panel; Outline View: nested nested list with the same data, toolbar without Fit/Reset in outline mode) before accepting them as the committed baseline. Drove the app through `e2e/organogram.spec.ts`'s and `e2e/organogram-visual.spec.ts`'s real-browser scenarios repeatedly during debugging (not just once at the end) — this is how the pointer-events and nested-interactive defects were actually found, not by reading the code and assuming it worked.

## Coverage Gaps

- `app/(app)/organogram/_lib/elk-layout.ts` lines 63–64 (the `?? []`/`?? 0` defensive fallbacks for when ELK's own result omits a child's computed x/y) and `lib/domain/organogram.ts`'s two iterative-traversal bound-exceeded branches (`computeVisiblePositionIds`/`countHiddenDescendants`'s `iterations++ > maxIterations` guards) are unreached — ELK always returns coordinates for every requested node in every fixture exercised here, and no fixture is large enough to hit either bound. Both are defensive-only safety nets against a pathological/corrupted input, not a code path any legitimate call reaches; left uncovered rather than contrived into a forced-failure test.
- `lib/repositories/*.ts` and `lib/services/*.ts` show 0% under the unit-config coverage report — expected and matches the Phase 7-established pattern: these files are guarded by `import "server-only"`, which the unit config deliberately leaves throwing (`lib/env.server-boundary.test.ts` proves the guard itself works there); real coverage for this layer comes from the separate `npm run test:integration` run against Postgres, not from the unit coverage report.
- No E2E coverage of a Planned-status position's visual rendering, since the current Positions UI has no control to create one (status is set at creation as ACTIVE only, with archive/reactivate toggling ACTIVE↔INACTIVE) — covered instead at the domain/unit level (`lib/domain/organogram.test.ts`) and the real-DB integration level would require a direct Prisma write, which was judged unnecessary given the domain-level coverage already exercises the exact same `buildOrganogramGraph`/visibility logic the server actually runs.

## Accessibility Findings

Two real defects found and fixed in Phase 8's own new code (nested-interactive, `--color-status-vacant` contrast — see "Failures Discovered" #2–3), plus two pre-existing defects surfaced by this phase's larger, more concurrent test suite and fixed in the same pass (`--color-status-filled` contrast, `<dl>` invalid nesting — #4–5). Final state: 18/18 `e2e/accessibility.spec.ts` tests passing on a normal run, and 68/68 passing under an artificially stressed 6× `--repeat-each` run (chosen specifically to force reproduction of timing-dependent violations rather than trust a single green pass). Outline View provides a fully keyboard/screen-reader-accessible alternative to the canvas, verified by its own dedicated axe scan.

## Security Findings

No confidential field is present on the `OrganogramNode`/`OrganogramData` contract by construction (verified by reading the type definitions, not just by intent — see `docs/ORGANOGRAM_RENDERING.md` §2). Company scoping, permission gating (`organogram:view`), and the generic-error-message-on-failure guarantee are all covered by `actions.test.ts` and `tests/integration/organogram.integration.test.ts`'s company-isolation tests. No new attack surface introduced — the route is entirely read-only, with no mutation server action anywhere in this phase's code.

## Performance Findings

`tests/integration/organogram-performance.integration.test.ts`: 1,051 positions (35 levels deep × 30 branches wide), 500 employees, 500 assignments → `getOrganogramData` completed in ~65–78ms across repeated runs in this environment, against an 8-second diagnostic ceiling. One bulk 4-query fetch (`Promise.all`), no per-node queries. Not claimed as a production SLA — a diagnostic guard against an accidental N+1/quadratic regression, matching Phase 7's own stated precedent for this kind of test.

## Visual-Regression Results

2 baselines committed (`e2e/organogram-visual.spec.ts-snapshots/organogram-visual-view-chromium-darwin.png`, `organogram-outline-view-chromium-darwin.png`), both passing on the run immediately following their generation and on a subsequent full-suite run. See `docs/ORGANOGRAM_RENDERING.md` §14 for how to intentionally regenerate them after a future visual change.

## Known Limitations

- Planned-position creation has no UI path yet (see "Coverage Gaps") — this is a pre-existing Positions-UI gap from an earlier phase, not something Phase 8 was asked to close, but it does mean Planned-position _visual rendering_ specifically can only be demonstrated via domain-level tests and manual/direct-DB verification, not a full E2E click-through.
- No image/PDF export, hierarchy editing, dotted-line reporting, CSV import/export, historical snapshots, advanced search/focus mode, or audit-log UI — all explicitly out of scope per the phase brief (see "Out-of-Scope Functionality" above).
- Layout-failure fallback (ELK throwing) is implemented and documented (`docs/ORGANOGRAM_RENDERING.md` §8) but not exercised by an automated test — forcing ELK itself to throw would require either a corrupted/pathological ELK input engineered specifically to break the library, or mocking `computeElkLayout`, neither of which was judged worth the added test-suite complexity for a defensive-only path with no other code depending on it.

## Decisions Added

A22 (Planned/Inactive default-visibility), A23–A27 (five found-and-fixed bugs, three genuinely new to this phase and two pre-existing defects this phase's testing activity surfaced), plus a Phase 8 entry in the Decision History — all in `docs/DECISIONS.md`.

## Gate Result

**PASS.** Every acceptance criterion in this report's "Acceptance Criteria" section is met with verification evidence above: live-data-generated chart (root top, department-horizontal via ELK layered-DOWN, levels vertical, siblings parallel), vacant/planned/inactive visibility rules honored and tested, levels/job-grade kept separate and read-only, department colors paired with text (never color-only), primary-only connectors, expand/collapse/Expand-All/Collapse-All/Fit-to-View/Reset-View all E2E-verified, zero mutation capability anywhere in this phase's code, no node overlap in any tested fixture, corrupted data isolated with a visible warning and never a freeze, accessible Outline View, mobile usability verified at 375px, company isolation verified at the integration and E2E layers, employee privacy verified by contract inspection and by a dedicated component test, automated tests across unit/integration/component/E2E/visual-regression/performance layers all passing, and Phase 9 not started (no search/focus-mode/deep-linking/export/drag-and-drop/dotted-line/CSV/historical/audit-log code exists anywhere in this diff).

No blocking items. Non-blocking items are listed under "Known Limitations" above, none of which affect the phase's own acceptance criteria.

## Recommended Next Phase

Phase 9 per `docs/IMPLEMENTATION_PLAN.md` — advanced organogram search / filter-driven focus view, explicitly named as the next phase in this phase's own "do not begin" instruction and therefore the logical continuation, not started here.
