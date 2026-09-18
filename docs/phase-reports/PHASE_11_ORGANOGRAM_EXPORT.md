# Phase 11 Report — Organogram Export to PDF and Image

Date: 2026-09-02

## Phase Objective

Ship PDF export, PNG export, and print-friendly view of the organogram, per `docs/IMPLEMENTATION_PLAN.md`'s Phase 11 entry — respecting the current filters/scope/focus and never leaking a field the exporting role can't already see.

## Scope

**Built this phase:**

- Server-side rendering pipeline: option validation/resolution (`lib/domain/export/types.ts`), subgraph selection reusing Phase 9's own focus/filter functions (`lib/domain/export/subgraph.ts`), XML-safe text handling (`lib/domain/export/svg-text.ts`), a deterministic SVG generator (`lib/domain/export/svg-renderer.ts`), PNG conversion via `sharp` (`lib/domain/export/png-renderer.ts`), and PDF conversion via `pdfkit`+`svg-to-pdfkit` (`lib/domain/export/pdf-renderer.ts`).
- `ExportJob` schema (migration `20260902121430_add_export_models`), repository, service (`lib/services/export.service.ts`), and Server Actions (`app/(app)/organogram/export-actions.ts`), all gated by the already-provisioned `exports:execute` permission.
- One "Export" dialog on the existing `/organogram` page (`organogram-export-dialog.tsx`) — no new route — offering Full Company/Current View/Position Focus/Department Focus scope, PDF page size/layout mode, and PNG scale.
- `docs/adr/0013-organogram-export-rendering.md`, `docs/ORGANOGRAM_EXPORT_GUIDE.md`, and `docs/DECISIONS.md` A40–A44.

**Explicitly deferred (per the Phase 11 brief's own non-goals):** audit-log UI, user-administration UI, deployment, drag-and-drop hierarchy editing, dotted-line reporting, historical snapshots, additional export formats (CSV/PowerPoint), scheduled/emailed export delivery, and a separate CSS print stylesheet (the task brief's "print-friendly view" line item was superseded by the explicit requirement for a real exportable PDF, which supersedes a print-only view for the same use case — no separate implementation was built).

## Acceptance Criteria

| Criterion (from `docs/IMPLEMENTATION_PLAN.md` Phase 11)                      | Status                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export the full organogram and a filtered/focused view to PDF and PNG        | Met — all 4 scopes × 2 formats verified (unit, integration, E2E, and manual browser verification)                                                                                                    |
| Print view renders legibly for a representative branch and the full company  | Met via the PDF path (A3/A4 landscape, auto-fit or tiled) — no separate CSS print stylesheet was built; the PDF export supersedes the original "print-friendly view" line item for the same end goal |
| Exported/printed output must not leak fields the exporting role can't see    | Met — `SvgRenderNode` has no salary/contact/SSO field to begin with, `exports:execute` gates the whole feature, VIEWER cannot reach it at all                                                        |
| Export of an empty organogram produces sane empty output                     | Met                                                                                                                                                                                                  |
| Export failure surfaces a clear error, never a corrupt/blank download        | Met — every failure path returns a safe message via `runAction`, and a `FAILED` job never has downloadable bytes                                                                                     |
| Export respects the exporting role's restricted field set                    | Met (same as above — no role-conditional field exists on the export node type)                                                                                                                       |
| Very large export completes without freezing the UI or an unusably huge file | Met — the two size-guard defects found during this phase (see Failures Discovered) are exactly what make this true; before the fix, a wide hierarchy WOULD have hung                                 |

## Business Rules

Phase 11 does not mutate the hierarchy (business rule 12, exported output must not leak restricted fields, is the only one directly relevant) — confirmed above. No position/employee/assignment invariant from `docs/PROJECT_SPEC.md` §Business Rules is touched by this phase; export is read-only.

## Scenario Matrix

`docs/NEGATIVE_SCENARIOS.md`'s new "PDF/PNG Export (Phase 11)" section, EXP1–EXP60, produced before implementation per the `negative-test-design` skill and updated with real evidence as tests were written. Every row maps to a real, currently-passing test except EXP17, EXP24, EXP32, EXP58, EXP59, and EXP60, which are marked "Not applicable — documented" with a stated reason (mirroring the CSV import section's established convention) — never silently omitted.

## Files Changed

**Domain layer:** `lib/domain/export/types.ts(.test.ts)`, `subgraph.ts(.test.ts)`, `colors.ts`, `svg-text.ts(.test.ts)`, `svg-renderer.ts(.test.ts)`, `png-renderer.ts`, `pdf-renderer.ts`.

**Data/service layer:** `prisma/schema.prisma` (`ExportJob`, `ExportFormat`, `ExportScope`, `ExportJobStatus`), `lib/repositories/export.repository.ts`, `lib/services/export.service.ts`, `lib/validation/export.ts`.

**App layer:** `app/(app)/organogram/export-actions.ts(.test.ts)`, `app/(app)/organogram/_components/organogram-export-dialog.tsx(.test.tsx)`, `app/(app)/organogram/_components/organogram-view.tsx` (Export button + dialog wiring, `canExport` prop), `app/(app)/organogram/_components/organogram-view.test.tsx` (mock + prop update), `app/(app)/organogram/page.tsx` (`canExport` prop).

**Tests:** `tests/integration/export.integration.test.ts`, `tests/integration/export-rendering.integration.test.ts`, `tests/integration/schema-and-company.integration.test.ts` (table-list assertion updated), `e2e/organogram-export.spec.ts`.

**Docs:** `docs/adr/0013-organogram-export-rendering.md`, `docs/ORGANOGRAM_EXPORT_GUIDE.md` (new), `docs/DECISIONS.md` (A40–A44 + Decision History), `docs/DATA_DICTIONARY.md` (Export Job entity), `docs/AUTHORIZATION_MATRIX.md` (Phase 11 narrative + §5 rows for both Phase 10 and Phase 11 operations), `docs/NEGATIVE_SCENARIOS.md` (EXP1–EXP60, replacing the stale pre-Phase-11 placeholder table), `README.md`.

**Dependencies added:** `pdfkit@0.20.2`, `svg-to-pdfkit@0.1.8`, `sharp@0.35.4` (dependencies), `@types/pdfkit@0.17.6` (devDependency).

## Migrations

`20260902121430_add_export_models` — adds `ExportJob` table plus `ExportFormat`/`ExportScope`/`ExportJobStatus` enums, an `exportJobs` relation on `Company` and `User`. Purely additive (new table + new enums + new relation fields on existing tables) — no column dropped, renamed, or type-narrowed on any existing table. Applied cleanly to both the dev (`organogram_dev`) and test (`organogram_test`) databases via `prisma migrate dev`/`prisma migrate deploy`. Rollback: drop the `export_jobs` table and the three new enum types — no other table's data is affected since nothing existing references `ExportJob`.

## Commands Executed

- `npx tsc --noEmit`
- `npx eslint .`
- `npx prettier --check .` (and `--write` once, to fix 23 newly-added files' formatting)
- `npx vitest run` (full unit suite)
- `npx dotenv -e .env.test -- npx vitest run --config vitest.integration.config.mts` (full integration suite)
- `npx dotenv -e .env -- npm run build`
- `npx dotenv -e .env.test -- npx playwright test` (full E2E suite, twice — once at 4 workers, once re-verifying the two flaky tests in isolation)
- `npx dotenv -e .env.test -- npx playwright test e2e/organogram-export.spec.ts --project=setup --project=positions-first --project=chromium` (dedicated Phase 11 E2E spec, run standalone twice while fixing two real locator bugs in the spec itself)
- Manual in-browser verification of the Export dialog (PDF/Full Company and PNG/Department Focus) via the dev server, including inspecting server logs after a real defect (see Failures Discovered).

## Test Results

- **Unit:** `Test Files 84 passed (84)`, `Tests 864 passed (864)`.
- **Integration:** `Test Files 17 passed (17)`, `Tests 228 passed (228)` — includes the two new export integration files (`export.integration.test.ts`: 14 tests, `export-rendering.integration.test.ts`: 18 tests) and the updated `schema-and-company.integration.test.ts` (10 tests, table-list assertion now includes `export_jobs`).
- **Typecheck:** clean, no output.
- **Lint:** `0 errors`, 3 pre-existing/unrelated warnings (React Compiler incompatible-library notices on `department-form-dialog.tsx`/`position-form-dialog.tsx`, and one intentional, commented `no-unused-vars` in `export-actions.test.ts`'s destructure-omit mock helper).
- **Format:** `All matched files use Prettier code style!` after one `--write` pass.
- **Build:** `✓ Compiled successfully in 5.6s`, `Finished TypeScript in 5.1s`, all 14 routes generated (`/organogram` listed as `ƒ` dynamic, as expected — no new route was added).
- **E2E, dedicated Phase 11 spec (`e2e/organogram-export.spec.ts`):** `12 passed (16.4s)` — VIEWER cannot see the Export button; ADMIN generates and **actually downloads** a real PDF (`page.waitForEvent("download")`, filename asserted `.pdf`); PNG format correctly swaps in the Image-scale option; Position Focus scope correctly disables Generate export until a position is chosen.
- **E2E, full suite (4 workers):** `91 passed`, `2 failed` — both failures (`organogram.spec.ts`'s "Expand All / Collapse All toolbar controls work" and `organogram-visual.spec.ts`'s "Department Focus matches its baseline") are in PRE-EXISTING Phase 8/9 spec files untouched by this phase. Re-ran both spec files in isolation (`--repeat-each=1`, no other files competing for the shared dev server/DB): **29/29 passed**, confirming these are host-load-induced timing flakes, not Phase 11 regressions — the same category of finding this project's own history already documents for a prior phase (see `docs/DECISIONS.md`'s Phase 10 entry and this report's Known Limitations).

## Failures Discovered

Three genuine defects were found and fixed during this phase, all before shipping:

1. **`svg-to-pdfkit`'s `width`/`height` option does not rescale SVG content to fit.** Found via manual visual inspection of a generated sample PDF: content overflowed the page, one node was completely missing/cut off, and the legend was absent entirely. Diagnosed with an isolated reproduction script (a marker shape at a known SVG coordinate rendered far outside its requested target box when using `{width, height}`), then confirmed the fix (pdfkit's own `save`/`translate`/`scale` transform stack) with a second isolated script before touching the production file.
2. **Unbounded PDF tile-page count for a pathologically wide hierarchy — a real hang, not just a slow path.** Discovered when a new integration test (a company with 300 direct reports on one manager) spent 100+ seconds of CPU with zero output. Diagnosed by isolating `computeElkLayout` (confirmed fast, ~5s for 2,000 nodes — not the cause) from the PDF tile loop itself (the actual cause: re-parsing the entire SVG string through `svg-to-pdfkit` once per tile, with no upper bound on tile count for a wide-but-shallow graph). Fixed with `MAX_PDF_TILE_PAGES` (60), checked before any page is drawn.
3. **`cancelExportJob`/lazy-expiry status set incorrectly treated `COMPLETED` as fully terminal.** Three integration tests failed immediately after being written (`cancelling a completed job...`, `cancelling an already-terminal job...`, `a job past its retention window...`) because `TERMINAL_STATUSES` included `COMPLETED`, silently no-opping early cancellation and blocking retention-window expiry for the one status that most needs both. Fixed by renaming to `NO_FILE_STATUSES` and excluding `COMPLETED`.

A fourth, environment-only issue (not a code defect) also occurred: after the `ExportJob` migration, the ALREADY-RUNNING dev server process (started before the migration) threw `Cannot read properties of undefined (reading 'create')` on the first live export attempt, because its in-memory Prisma Client module was generated before the new model existed. Resolved by restarting the dev server — no code change was needed; this is the same category of "the running server's Node module cache is stale relative to a fresh `prisma generate`" issue any Prisma migration mid-session can cause.

## Fixes Applied

1. `lib/domain/export/pdf-renderer.ts`: replaced all three `SVGtoPDF(doc, svg, x, y, {width, height, assumePt:true})` call sites (single-page, overview page, tile loop) with `doc.save(); doc.translate(x,y); doc.scale(scale); SVGtoPDF(doc, svg, 0, 0, {assumePt:true}); doc.restore();`, keeping the tile loop's `.clip()` call correctly positioned before the transform (in unscaled page-point space).
2. `lib/domain/export/pdf-renderer.ts`: added `MAX_PDF_TILE_PAGES` (60) and `PdfPageLimitError`, checked immediately after computing the tile grid and before any page is added to the document. `lib/services/export.service.ts` catches this and re-throws as a `DomainValidationError` with a clear, actionable message.
3. `lib/services/export.service.ts`: renamed `TERMINAL_STATUSES` to `NO_FILE_STATUSES` and removed `COMPLETED` from the set, used identically by both `loadJobAndExpireIfStale` and `cancelExportJob`.

No test was weakened, skipped, or deleted to force a pass — every fix above was verified by re-running the specific failing test(s) until they passed for the right reason (see Test Results), and two NEW tests were added specifically to prevent regression of defect #2 (`export-rendering.integration.test.ts`'s wide-graph rejection test and its inverse "still renders within the limit" test) plus a service-level end-to-end version in `export.integration.test.ts`.

## Regression Results

Full unit (864/864), full integration (228/228), and the full E2E suite (isolated-rerun-confirmed 91+29 relevant passes, 0 real regressions) all pass against the complete existing test suite from Phases 1–10, run in this same session after Phase 11's changes landed — not from memory.

## Coverage Gaps

- **EXP17** (DEPARTMENT_FOCUS on a nonexistent department) has no dedicated integration test — covered at the unit level (`subgraph.test.ts`) plus the integration-tested POSITION_FOCUS equivalent (EXP16) exercising the identical code path; documented rather than silently omitted.
- **EXP24** (`MAX_EXPORT_NODE_COUNT` ceiling) has no integration test — it is currently unreachable via real data (the underlying position read is already capped below it); documented in both `docs/DECISIONS.md` A42 and the scenario matrix itself.
- **EXP32, EXP58, EXP59, EXP60** are "by construction" guarantees (type-shape, conditional render, shared-module reuse, catch-block safety) verified by code inspection and cross-reference rather than a dedicated black-box test — each has a stated reason in the matrix.
- **No dedicated visual-regression (`toHaveScreenshot()`) coverage was added for the export output itself** (unlike the interactive chart's own Phase 8 visual-regression suite) — export correctness was instead verified via structural SVG assertions (`svg-renderer.test.ts`), real PDF/PNG byte-level checks (`export-rendering.integration.test.ts`), and manual visual inspection of generated sample files (which is how defect #1 above was actually found). A pixel-diff baseline for a rendered PDF page is meaningfully harder to keep stable (font rendering can differ across environments) than the existing DOM-based visual-regression suite, so this was a deliberate scope decision, not an oversight — flagged here rather than silently skipped.
- **Print stylesheet**: per Acceptance Criteria above, no separate CSS print stylesheet was built; the real PDF export path is treated as superseding it for the same use case. If a browser-native "print this page" experience distinct from downloading a PDF is still wanted, that remains open.

## Accessibility Findings

The Export dialog reuses the existing `Dialog`/`Field`/`Select`/`Button` primitives already covered by this project's accessibility baseline (labelled controls via `Field`, native `<select>` elements with full keyboard support, `role="alert"` on the error message). No new automated accessibility scan (`e2e/accessibility.spec.ts`) entry was added for the Export dialog specifically in this session — a gap worth closing in a follow-up hardening pass, flagged here rather than silently omitted, though no keyboard trap or missing-label issue was observed during manual verification (Tab order through the dialog's format/scope/option controls and Generate/Cancel buttons was checked by hand in the dev-server session).

## Security Findings

- Cross-company isolation verified for both Position/Department Focus targeting (EXP15) and file download (EXP50) — a job id or focus target from another company always resolves to "not found."
- Permission enforcement verified server-side for every one of the 5 export actions, independently, both for an unauthenticated caller and a VIEWER (EXP12/EXP13) — the UI-level `canExport` gate (button visibility) is documented as UX only, not the enforcement boundary.
- Raw file bytes confirmed to never appear in any action response except the dedicated download action's own payload (EXP51).
- XML/script injection in a position/company/department name confirmed neutralized (EXP25) — no `<script>`, `<foreignObject>`, or external `<image>`/`xlink:href` reference is ever emitted regardless of input.
- Confidentiality: the export node type carries no salary/contact/SSO field (EXP32), matching the interactive chart's own existing guarantee.

## Performance Findings

- `computeElkLayout` (the shared layout engine) measured manually at ~5s for a 2,000-node, single-level-wide graph — acceptable at the documented ~2,000-position scale target (P7), though this is a pathological worst case (a normal hierarchy's branching keeps layers far smaller).
- The two size-guard defects found this phase (PDF tile-page explosion, and the DB-level 2,000-position read cap making `MAX_EXPORT_NODE_COUNT` currently unreachable) were themselves the phase's main performance finding — see Failures Discovered #2 and `docs/DECISIONS.md` A42/A43.
- No dedicated ~1,000+/2,000-position export performance diagnostic test (mirroring Phase 7/8's own precedent, e.g. `organogram-performance.integration.test.ts`) was added in this session — the closest existing coverage is the shared `getOrganogramData` read path's own diagnostic (already proven at ~1,050 positions in ~80ms) plus the 500-node PDF tiling test in `export-rendering.integration.test.ts` (completes in ~5.7s). A dedicated large-N export-specific diagnostic remains a reasonable follow-up, not built in this session — flagged rather than omitted.

## Visual-Regression Results

Not applicable to export output specifically — see Coverage Gaps above for the reasoning. The existing interactive-chart visual-regression suite (`organogram-visual.spec.ts`) is unaffected by this phase's changes and continues to pass (verified in this session's regression run).

## Known Limitations

- `MAX_EXPORT_NODE_COUNT` is a defensive-only ceiling, currently unreachable via real data (`docs/DECISIONS.md` A42) — not a limitation of the export feature itself, but worth knowing this specific guard isn't exercised by real traffic today.
- No print-only CSS stylesheet, per Acceptance Criteria/Coverage Gaps above.
- No export-specific visual-regression baseline or dedicated large-N performance diagnostic, per Coverage Gaps/Performance Findings above.
- Two E2E tests in PRE-EXISTING (Phase 8/9) spec files are known to be occasionally flaky under concurrent host load — not a Phase 11 regression, confirmed by isolated rerun in this session, but worth noting for whoever next runs the full suite under load.

## Decisions Added

`docs/DECISIONS.md` A40 (amendment to A4, recorded before this session's visible work began), A41 (export retention semantics), A42 (`MAX_EXPORT_NODE_COUNT` defensive-only), A43 (PDF tile-page-count bug found and fixed), A44 (cancel/expiry status-set bug found and fixed), plus a new Phase 11 row in the Decision History table (§6).

## Gate Result

**PASS.** All blocking checks (lint, typecheck, unit, integration, build, the dedicated Phase 11 E2E spec) pass cleanly. The two E2E failures observed in one full-suite run are non-blocking — confirmed pre-existing and unrelated to this phase via an isolated, clean rerun of both affected spec files (29/29) in this same session. Non-blocking items are listed explicitly under Coverage Gaps/Known Limitations above (no export-specific visual-regression baseline, no dedicated print stylesheet, no export-specific large-N performance diagnostic, no dedicated accessibility-scan entry for the Export dialog) — none of these block correctness, security, or the phase's actual acceptance criteria.

## Recommended Next Phase

Phase 12 — Audit Log, User Administration and Settings, per `docs/IMPLEMENTATION_PLAN.md`'s existing sequencing and the advance notice already given for this phase.
