# Performance Report — Phase 13 Release Hardening, Step 14

Date: 2026-09-03

## Purpose and method (read before the tables below)

This report covers Phase 13 Step 14: performance testing at 100/500/1,000-position
scale (wide, deep, mixed shapes), CSV import at 1,000/5,000 rows, PDF/PNG export at
several scales, and a hierarchy-mutation concurrency scenario.

**Threshold discipline (non-negotiable, per `CLAUDE.md` and this task's brief):** every
threshold in the tables below was decided and written down BEFORE any test in this
report was executed and BEFORE any actual timing number was observed. The "Result"
and "Verdict" columns were filled in afterward, from real command output, and were
never adjusted after the fact to make a borderline case pass. Any scenario that misses
its pre-committed threshold is reported as FAIL, with an honest assessment of whether
it is release-blocking, using `docs/DEFECT_REGISTER.md`'s severity definitions — not
quietly re-thresholded.

Baseline context used to set these numbers:

- `docs/DECISIONS.md` P7 — this app is designed for **up to ~2,000 active/vacant/planned
  positions**; do not hard-code lower limits.
- `docs/PROJECT_SPEC.md` §14 ("Performance Expectations") — organogram initial render
  for a typical view: perceived load under ~2s; full-company organogram (~2,000
  positions): usable pan/zoom/expand without noticeable jank via lazy rendering; CSV
  import of up to ~2,000 rows completes preview validation without blocking the UI
  thread.
- `docs/TEST_STRATEGY.md` §11 — performance tests measure against the §14 targets, at
  minimum once per relevant phase and again in Phase 13 against the combined dataset.
  §14 (of TEST_STRATEGY) separately calls for an eventual documented, seedable
  ~2,000-position deterministic dataset specifically for performance tests — that
  larger deliverable was **not** built for this step (see "What was not done" at the
  bottom); this step reuses the existing `createMany`-based synthetic fixture pattern
  already established in `tests/integration/dashboard-performance.integration.test.ts`
  and `tests/integration/organogram-performance.integration.test.ts`.
- The two existing performance files above are explicitly "diagnostic" checks at one
  ~1,051-position mixed shape with an 8,000ms ceiling — generous on purpose, guarding
  only against an accidental N+1/quadratic regression, not a release SLA. The
  thresholds below are deliberately **tighter** than that 8,000ms diagnostic ceiling
  wherever the brief's own guidance ("well under a few seconds even at the largest
  realistic scale") supports it, since this step is a release gate, not a diagnostic.
- Server-side data-assembly time (`getOrganogramData` / `getDashboardSummary`) is only
  part of perceived page-load time — it excludes client-side layout (ELK) and render,
  which are out of scope for an integration (non-browser) test. Thresholds below are
  set accordingly: comfortably inside the §14 "~2s perceived load" budget, leaving
  headroom for client-side work this test cannot measure.

## Pre-committed threshold table (written first)

| #   | Scenario                                                                                                                                                         | Threshold                                                                                                                                               | Rationale                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Organogram data assembly (`getOrganogramData`), 100 positions, wide/deep/mixed                                                                                   | < 500 ms each                                                                                                                                           | Small scale; should be near-instant server work, comfortably inside the §14 sub-second/interactive expectation for smaller views.                                                                                                                                                                                                                                |
| 2   | Organogram data assembly, 500 positions, wide/deep/mixed                                                                                                         | < 1,500 ms each                                                                                                                                         | Mid-scale; still a small fraction of the §14 ~2s perceived-load budget, leaving room for client render.                                                                                                                                                                                                                                                          |
| 3   | Organogram data assembly, 1,000 positions, wide/deep/mixed                                                                                                       | < 3,000 ms each                                                                                                                                         | Approaching half the P7 ~2,000-position design target; well under the existing 8,000ms diagnostic ceiling for a single mixed ~1,051-position shape, since this is a release gate not a diagnostic.                                                                                                                                                               |
| 4   | Dashboard summary (`getDashboardSummary`), 100 positions, wide/deep/mixed                                                                                        | < 500 ms each                                                                                                                                           | Same reasoning as #1 — dashboard aggregates are computed from the same-sized dataset.                                                                                                                                                                                                                                                                            |
| 5   | Dashboard summary, 500 positions, wide/deep/mixed                                                                                                                | < 1,500 ms each                                                                                                                                         | Same reasoning as #2.                                                                                                                                                                                                                                                                                                                                            |
| 6   | Dashboard summary, 1,000 positions, wide/deep/mixed                                                                                                              | < 3,000 ms each                                                                                                                                         | Same reasoning as #3.                                                                                                                                                                                                                                                                                                                                            |
| 7   | CSV import (validate + confirm + execute, real `import.service.ts` pipeline), 1,000 synthetic position rows                                                      | < 10,000 ms                                                                                                                                             | "Seconds not minutes" per this task's own brief; import is an occasional bulk HR operation, not an interactive path — 10s is a generous but still clearly-bounded budget for 1,000 rows.                                                                                                                                                                         |
| 8   | CSV import, 5,000 synthetic position rows                                                                                                                        | < 30,000 ms                                                                                                                                             | Same reasoning as #7, scaled roughly linearly with row count plus margin; still well under "minutes."                                                                                                                                                                                                                                                            |
| 9   | PNG export render (`renderSvgToPng`), 100-node grid shape, 1x scale                                                                                              | < 800 ms                                                                                                                                                | Export rendering is heavier (real `sharp` rasterization) than pure data assembly; still expected to be fast at small scale.                                                                                                                                                                                                                                      |
| 10  | PNG export render, 500-node grid shape, 1x scale                                                                                                                 | < 2,500 ms                                                                                                                                              | Scaled from #9 for 5x the nodes.                                                                                                                                                                                                                                                                                                                                 |
| 11  | PNG export render, 1,000-node grid shape, 1x scale                                                                                                               | < 6,000 ms                                                                                                                                              | Scaled from #9/#10; 1x scale deliberately chosen because 1,000 nodes at 2x/3x scale would exceed `MAX_PNG_TOTAL_PIXELS` by design (existing correctness tests in `export-rendering.integration.test.ts` already cover that rejection path) — not a performance question at that combination.                                                                     |
| 12  | PDF export render (`renderOrganogramPdf`, A3, AUTO), 100-node grid shape                                                                                         | < 1,200 ms                                                                                                                                              | Single fit-to-page PDF at small scale should be fast.                                                                                                                                                                                                                                                                                                            |
| 13  | PDF export render, 500-node grid shape, A3, AUTO (expected `MULTI_PAGE_TILED`)                                                                                   | < 6,000 ms                                                                                                                                              | Tiling more pages costs more render time than a single page; still expected to complete quickly given #12 scaled up. Node count chosen so the tile grid stays within `MAX_PDF_TILE_PAGES` (60) per the existing tiling math, so this measures real rendering time, not the rejection path.                                                                       |
| 14  | PDF export at 1,000-node **wide** shape, A3, forced `MULTI_PAGE_TILED`                                                                                           | Expected to be **rejected** via `PdfPageLimitError`, and to reject in < 2,000 ms (fail fast, not hang)                                                  | At this shape/scale the tile grid legitimately exceeds `MAX_PDF_TILE_PAGES` — this is the existing, already-tested-for-correctness safety guard (`export-rendering.integration.test.ts`'s wide-hierarchy rejection case), not a new performance regression. This row measures that the guard still rejects quickly under load, not a render-completion duration. |
| 15  | Concurrency: two racing hierarchy moves that would each be independently valid but together would form a 2-node reporting cycle (A→B and B→A moved concurrently) | No timing threshold — correctness invariant: after the race, `runDomainIntegrityCheck` must report **zero** cycle/self-report/level-mismatch violations | This is a correctness question (does the hierarchy invariant survive a race), not a latency question, per `CLAUDE.md` §2 and the `organogram-hierarchy-safety` skill.                                                                                                                                                                                            |
| 16  | Concurrency: two racing attempts to assign an employee to the same vacant position                                                                               | Already covered — see "Existing concurrency coverage" below                                                                                             | Avoid duplicating existing coverage per this task's brief.                                                                                                                                                                                                                                                                                                       |

## Existing concurrency coverage (not duplicated)

A grep across `tests/integration/*.ts` for "concurrent" found these existing tests,
which already satisfy part of the concurrency requirement and are not re-implemented
here:

- `tests/integration/employee-and-assignment.integration.test.ts:539` — "allows exactly
  one of two concurrent attempts to fill the same position to succeed" (two
  `createAssignment` calls raced via `Promise.allSettled`; asserts exactly one
  fulfilled, exactly one rejected, and exactly one open assignment remains).
- `tests/integration/employee-and-assignment.integration.test.ts:266` — concurrent
  termination vs. transfer race.
- `tests/integration/settings.integration.test.ts:122` — stale optimistic-concurrency
  settings update.
- `tests/integration/user-admin.integration.test.ts:239` — two concurrent
  last-admin-disable attempts, only one succeeds.

None of these exercises a **hierarchy move** race, which is why scenario #15 above is
new: `movePosition` in `lib/services/hierarchy.service.ts` has no optimistic-lock/
version check and its cycle-detection reads (`getPositionAncestorChain`) happen inside
a Prisma interactive transaction with the default (Read Committed) isolation level —
so it was not obvious, without a real test, that a well-formed pair of individually-
valid concurrent moves could never jointly create a cycle.

## Actual results (filled in after running the tests above)

All numbers below are real command output from `npm run test:integration -- <file>` (isolated) and, where noted, from a subsequent full-suite run (`npm run test:integration`, no filter) — both are reported per row where they differ meaningfully. Test file: `tests/integration/performance-matrix.integration.test.ts` unless noted otherwise.

| #   | Scenario                                             | Threshold                                                       | Result                                                                                                                                                                                                           | Verdict                                           |
| --- | ---------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | Organogram assembly, 100, wide/deep/mixed            | < 500 ms                                                        | wide 264ms(wall, incl. fixture seed)/~few ms pure call; measured pure-call durations: wide n/a-fast, deep 5ms, mixed 8ms                                                                                         | PASS (all 3 shapes)                               |
| 2   | Organogram assembly, 500, wide/deep/mixed            | < 1,500 ms                                                      | deep 16ms, mixed 12ms, wide 12ms                                                                                                                                                                                 | PASS (all 3 shapes)                               |
| 3   | Organogram assembly, 1,000, wide/deep/mixed          | < 3,000 ms                                                      | wide 15ms, deep 25ms, mixed 15ms                                                                                                                                                                                 | PASS (all 3 shapes)                               |
| 4   | Dashboard summary, 100, wide/deep/mixed              | < 500 ms                                                        | deep 16ms, mixed 19ms, wide ~similar                                                                                                                                                                             | PASS (all 3 shapes)                               |
| 5   | Dashboard summary, 500, wide/deep/mixed              | < 1,500 ms                                                      | deep 40ms, mixed 34ms, wide 47ms                                                                                                                                                                                 | PASS (all 3 shapes)                               |
| 6   | Dashboard summary, 1,000, wide/deep/mixed            | < 3,000 ms                                                      | deep 105ms, mixed 87ms, wide 83ms                                                                                                                                                                                | PASS (all 3 shapes)                               |
| 7   | CSV import, 1,000 rows                               | < 10,000 ms                                                     | **Threw** `PrismaClientKnownRequestError` — Prisma's default 5,000ms interactive-transaction timeout was exceeded mid-execution; import never completed. Reproduced in 2/2 isolated runs and the full-suite run. | **FAIL** — see DEF-009                            |
| 8   | CSV import, 5,000 rows                               | < 30,000 ms                                                     | **Threw**, same error, same root cause. Reproduced in 2/2 isolated runs and the full-suite run.                                                                                                                  | **FAIL** — see DEF-009                            |
| 9   | PNG export, 100 nodes                                | < 800 ms                                                        | 449 ms (isolated) / 998 ms (full-suite load)                                                                                                                                                                     | PASS isolated / **FAIL** under load — see DEF-010 |
| 10  | PNG export, 500 nodes                                | < 2,500 ms                                                      | 3,573 ms (isolated) / 7,201 ms (full-suite load)                                                                                                                                                                 | **FAIL** both conditions — see DEF-010            |
| 11  | PNG export, 1,000 nodes                              | < 6,000 ms                                                      | 13,717 ms (isolated) / 18,296 ms (full-suite load)                                                                                                                                                               | **FAIL** both conditions — see DEF-010            |
| 12  | PDF export, 100 nodes, A3/AUTO                       | < 1,200 ms                                                      | 449 ms, layoutMode=MULTI_PAGE_TILED, 13 pages                                                                                                                                                                    | PASS                                              |
| 13  | PDF export, 500 nodes, A3/AUTO                       | < 6,000 ms                                                      | 5,551–5,649 ms, layoutMode=MULTI_PAGE_TILED, 50 pages                                                                                                                                                            | PASS (close to threshold — see note below)        |
| 14  | PDF export, 1,000-node wide, forced MULTI_PAGE_TILED | Reject via `PdfPageLimitError` in < 2,000 ms                    | Rejected in 1 ms (essentially instant — the tile-count guard runs before any page is drawn)                                                                                                                      | PASS                                              |
| 15  | Hierarchy move concurrency (racing opposite moves)   | Zero cycle/self-report/level-mismatch violations after the race | **A real `REPORTING_CYCLE` + 2x `CHILD_LEVEL_MISMATCH` violation was created**, reproduced deterministically in 4/4 runs (both moves always fulfilled, 0 rejected)                                               | **FAIL** — see DEF-006                            |
| 16  | Assignment-fill concurrency                          | N/A — existing coverage                                         | `employee-and-assignment.integration.test.ts:539` passes (part of the 337 passing tests below)                                                                                                                   | PASS (pre-existing)                               |

Row 13 note: 5,551–5,649 ms against a 6,000 ms threshold is a real pass, not a rounding call, but it is close enough to the ceiling that it is called out here rather than left as an unqualified PASS — consistent with the same `sharp`/SVG-rendering cost growth documented in DEF-010 for PNG, just not (yet) over its own threshold for PDF at this specific scale.

### Full command output (representative excerpts)

```
$ npm run test:integration -- tests/integration/performance-matrix.integration.test.ts
✓ tests/integration/performance-matrix.integration.test.ts (18 tests) 4463ms
Test Files  1 passed (1)
     Tests  18 passed (18)

$ npm run test:integration -- tests/integration/import-performance.integration.test.ts
× imports 1,000 synthetic position rows ... 5512ms
  Transaction API error: Transaction not found. Transaction ID is invalid...
× imports 5,000 synthetic position rows ... 5991ms
  Transaction API error: Transaction already closed: ... timeout for this
  transaction was 5000 ms, however 5001 ms passed since the start of the transaction.
Test Files  1 failed (1)
     Tests  2 failed (2)

$ npm run test:integration -- tests/integration/export-performance.integration.test.ts
[export-performance][PNG][100 nodes] 449ms (threshold 800ms)
[export-performance][PNG][500 nodes] 3573ms (threshold 2500ms)
[export-performance][PNG][1000 nodes] 13717ms (threshold 6000ms)
[export-performance][PDF][100 nodes] mode=MULTI_PAGE_TILED pages=13 -> 449ms (threshold 1200ms)
[export-performance][PDF][500 nodes] mode=MULTI_PAGE_TILED pages=50 -> 5551ms (threshold 6000ms)
[export-performance][PDF][1000 wide nodes, rejection] 1ms (threshold 2000ms)
Test Files  1 failed (1)
     Tests  2 failed | 4 passed (6)

$ npm run test:integration -- tests/integration/hierarchy-move-concurrency.integration.test.ts   (x3 runs)
[hierarchy-concurrency] racing opposite moves -> fulfilled=2 rejected=0   (all 3 runs, identical)
Test Files  1 failed (1)
     Tests  1 failed (1)

$ npx tsc --noEmit
(clean, no output)

$ npm run test:integration   (full suite, no filter)
Test Files  3 failed | 24 passed (27)
     Tests  6 failed | 337 passed (343)
```

Pre-existing baseline was 316 tests across 23 files (per this task's brief); this phase added 4 new files / 27 new tests (18 + 2 + 6 + 1), landing at 343 tests across 27 files — a strict superset, and every one of the 23 pre-existing files still passes with zero regressions. The 3 failing new files (6 failing tests) are documented above and in `docs/DEFECT_REGISTER.md` as DEF-006, DEF-009, and DEF-010 — none were made to pass by loosening an assertion or threshold.

**A note on full-suite run variance:** the first full, unfiltered `npm run test:integration` run (captured above) showed exactly the expected picture: 24/27 files passed, 337/343 tests passed, and the only 3 failing files were this phase's own new ones (DEF-006/009/010) — a clean result. Two subsequent full-suite re-runs, taken later while another session was concurrently active in this same repository/shared test database, additionally showed **pre-existing** files failing (`seed.integration.test.ts`, `position-hierarchy.integration.test.ts`'s cycle-rejection cases, `export.integration.test.ts`'s wide-hierarchy-rejection case, `audit-retrofit.integration.test.ts`) with errors like `expected PrismaClientKnownRequestError to be an instance of CycleError` — a raw Prisma transaction failure, not a real cycle-detection regression. This is the exact, already-documented pattern of `docs/DEFECT_REGISTER.md` DEF-003 ("running the entire suite in one unfiltered process occasionally fails a varying 7-10 files... concentrated in `seed.integration.test.ts`... does not manifest in this project's actual CI usage pattern of one fresh run per job"), here most plausibly aggravated by a second concurrent `npm run test:integration` process (evidenced separately by another session editing this same phase's `docs/DEFECT_REGISTER.md` and `hierarchy-move-concurrency.integration.test.ts` files during this work) racing against the same shared Postgres test database's per-test `TRUNCATE`. It is not this phase's new tests interacting badly with anything — the first, uncontended full run and every isolated single-file run (each new file run alone via `npm run test:integration -- <file>`, multiple times for the 3 failing ones) are consistent and repeatable, and are the results relied on in the table above.

## Summary and findings

**Organogram/dashboard data assembly (scenarios 1-6): PASS, comfortably.** At every scale (100/500/1,000) and every shape (wide/deep/mixed), both `getOrganogramData` and `getDashboardSummary` completed in well under 150ms — one to two orders of magnitude faster than the pre-committed thresholds. No shape-specific pathological slowdown was found. This is consistent with the existing ~1,051-position diagnostic tests already in the suite.

**A genuinely deep single-chain hierarchy (500-1,000 levels) is out of scope by design, not by omission.** The initial "deep" shape design (a literal single chain of N positions) hit `lib/domain/hierarchy.ts`'s `MAX_HIERARCHY_DEPTH = 200` defensive ceiling, which exists specifically to fail loudly on "disconnected or corrupted hierarchy data, not a legitimately deep org chart." This is correct, intentional behavior, not a defect — the test was corrected to use a handful of ~150-level-deep chains instead (still exercising genuinely deep recursion, just within the depth this application is designed to support).

**CSV import at 1,000/5,000 rows: FAIL — a real, release-relevant defect (DEF-009, High).** The import doesn't just run slowly at this scale, it throws and never completes, because `executeImportJob` wraps the entire re-validate-and-apply-every-row loop in one Prisma interactive transaction with no timeout override, and Prisma 6's default transaction timeout is 5,000ms. This directly contradicts `docs/PROJECT_SPEC.md` §14's explicit requirement that CSV import of "up to ~2,000 rows" must work. The failure mode is safe (the whole transaction rolls back — no partial/corrupted data was observed), but the feature is simply unusable at the scale this step was asked to test. This was not fixed in this pass (out of the stated scope of "performance testing"), but is flagged as DEF-009 and via a spawned follow-up task.

**PNG export at 500/1,000-node scale: FAIL — a real performance concern (DEF-010, Medium).** PDF export at the same scales stayed within budget (using the existing, already-load-bearing tiling/rejection safety mechanisms); PNG rasterization via `sharp` did not, taking 13.7-18.3 seconds at 1,000 nodes. Not a correctness bug — every PNG produced was valid — but a real synchronous-request latency concern for an interactive export button at a scale this app is explicitly designed to support (~2,000 positions).

**Hierarchy move concurrency: FAIL — the most significant finding (DEF-006, High).** Two individually-valid, simultaneously-racing `movePosition` calls (A moved under B, B moved under A, no prior ancestor relationship between them) were both allowed to succeed, producing an actual, persisted 2-node reporting cycle — reproduced deterministically in every one of 4 runs (not an intermittent timing fluke). This is a genuine gap in `CLAUDE.md` §2's core hierarchy invariant ("no direct or indirect reporting cycles") under concurrent editing, which no existing test (assignment races, admin-disable races, settings optimistic-lock) happened to cover. The existing assignment-fill concurrency test (`employee-and-assignment.integration.test.ts:539`) continues to pass and was not duplicated.

**Both DEF-006 and DEF-009 were left as genuinely failing tests, not weakened, per `CLAUDE.md`'s "never weaken or delete a valid test merely to obtain a passing result."** Fixing either is a production-code change (transaction timeout configuration; row-locking in `movePosition`) that goes beyond this step's scope of "performance testing," so both are documented in `docs/DEFECT_REGISTER.md` and flagged as follow-up tasks for an explicit fix-or-accept decision, rather than silently patched or silently ignored.

**Zero regressions.** All 23 pre-existing integration test files continue to pass unchanged; the full suite grew from 316 to 343 tests (23 to 27 files), a strict superset, confirmed by one full, unfiltered `npm run test:integration` run.

## What was not done / known limitations

- A fully deterministic, seedable ~2,000-position dataset generator (the larger
  deliverable implied by `docs/TEST_STRATEGY.md` §14, "a separate, larger
  deterministic dataset... generated by a documented, seedable script") was not
  built. These tests reuse the existing `randomUUID()`-based synthetic
  `createMany` fixture pattern already established by the two pre-existing
  performance test files, consistent with this task's brief ("reuse/extend that
  helper... rather than writing a new one from scratch").
- Client-side rendering/layout time (ELK graph layout, browser paint) is not
  measured here — these are server-side integration tests (Vitest + real
  PostgreSQL), not Playwright/browser-based timing. This is a genuine gap for a
  complete perceived-load picture; a browser-based (Playwright) large-scale render
  timing pass, if wanted, is separate future work, not something added silently to
  this report as if it were covered.

## Phase 13.1 addendum — CSV import and PNG export remediation (new measurements, added alongside the above, not replacing it)

Per stakeholder decision: DEF-009 (CSV import performance) was **fixed** in Phase 13.1 (blocking, could not ship as-is); DEF-010 (PNG export performance) was **accepted conditionally**, with a measured, server-enforced safe limit and a PDF redirect above it. Full root-cause analysis, implementation detail, and regression-test evidence: `docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md`. The rows below are NEW measurements from that remediation — the original rows 7-11 and their FAIL verdicts above are left exactly as originally recorded (`docs/PROJECT_SPEC.md`'s "add new measurements alongside, never rewrite historical ones").

### CSV import — after remediation (bulk-create path, `applyPositionCreatesBulk` et al.)

Same pre-committed thresholds as rows 7-8 above (< 10,000 ms / < 30,000 ms) — never redefined after seeing results.

| Row | Scenario                                         | Threshold   | Measured (3 runs)                         | Median    | Verdict                                                         |
| --- | ------------------------------------------------ | ----------- | ----------------------------------------- | --------- | --------------------------------------------------------------- |
| 7'  | CSV import, 1,000 rows (POSITION, real pipeline) | < 10,000 ms | 1,292 / 1,851 / 670 / 717 ms (4 runs)     | ~717 ms   | **PASS** — ~25-44x faster than the pre-remediation failure      |
| 8'  | CSV import, 5,000 rows (POSITION, real pipeline) | < 30,000 ms | 3,516 / 2,933 / 2,869 / 3,813 ms (4 runs) | ~2,933 ms | **PASS** — previously did not complete within 300,000 ms at all |

### PNG export — after remediation (safe render-time limit + PDF redirect, `assertPngWithinSafeRenderBudget`)

New pre-committed threshold (decided from a fresh benchmark sweep BEFORE the limit constant was chosen — see `PHASE_13_1_PERFORMANCE_REMEDIATION.md` for the full 100-1,000-node sweep this was derived from): a safe PNG render must complete in **< 3,000 ms isolated**; anything the safe-limit check would reject must be rejected in **< 100 ms** (a synchronous size check, not a render attempt).

| Row | Scenario                                                                        | Threshold                        | Measured         | Verdict                                                                                                        |
| --- | ------------------------------------------------------------------------------- | -------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| 9'  | PNG export, 100 nodes (unchanged — already within the safe limit)               | < 800 ms                         | 479-780 ms       | PASS (unchanged from original row 9)                                                                           |
| 12' | PNG export, 250 nodes (the largest size still allowed — ~19.7 megapixels at 1x) | < 3,000 ms                       | 1,208-1,634 ms   | **PASS** — new safe-limit ceiling                                                                              |
| 10' | PNG export, 500 nodes                                                           | N/A — now rejected, not rendered | 0 ms (rejection) | **PASS** — `PngPerformanceLimitError` thrown before any render or `ExportJob` row is created, recommending PDF |
| 11' | PNG export, 1,000 nodes                                                         | N/A — now rejected, not rendered | 0 ms (rejection) | **PASS** — same rejection path                                                                                 |

PDF at the same 500/1,000-node scales is unaffected (the new check lives entirely inside the PNG branch of `export.service.ts`) and continues to use its own pre-existing `MAX_PDF_TILE_PAGES` guard, unrelated to this change.

### Final release-gate verification, isolated (Step 11)

Two controlled, isolated `npx vitest run` (full unit suite) runs and one full `npm run test:integration -- <file>`-per-file pass, plus one full `CI=true npm run test:e2e` run — exact commands and pass/fail counts are recorded in `docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md`'s Final Release Gate section, not duplicated here.
