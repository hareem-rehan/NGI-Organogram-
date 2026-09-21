# Release Checklist — Dynamic Organogram Manager (Phase 13)

Evidence-backed checklist for release-candidate readiness. Each item links to the artifact that proves it, not just an assertion. Checked = verified with real command output this phase; unchecked = outstanding, with the reason stated.

- [x] **Format / lint / typecheck clean.** `npm run format:check && npm run lint && npm run typecheck` — all clean (0 errors; 3 pre-existing, unrelated React Compiler/unused-var warnings unchanged from baseline).
- [x] **Unit/component suite passing.** `npx vitest run` → 92 files / 988 tests passing (baseline was 91/947; Phase 13 added 41 new tests, zero existing tests altered or weakened).
- [x] **Integration suite passing (per-file/CI invocation).** `npm run test:integration -- <file>` and the CI workflow's own fresh-database invocation both pass cleanly and repeatably; the full unfiltered local suite has known transient flakiness under repeated manual re-runs in one long process (DEF-003, accepted, does not manifest in CI's actual usage pattern).
- [x] **E2E suite passing.** `CI=true npm run test:e2e` → 114-116 passing depending on run, with the same host-load-dependent flake class already tracked (DEF-001, accepted); every implicated file passes 100% in isolation.
- [x] **Production build succeeds.** `npm run build` → 16 routes generated, `ƒ Proxy (Middleware)` confirmed active.
- [x] **Domain-integrity check passes.** `npm run check:integrity` → `PASS — no integrity violations found`, both against the test database and a freshly-migrated empty database (CI's invocation).
- [x] **RBAC / company-isolation matrix passes.** 26 integration tests + 3 E2E tests, all 3 real roles × 9 module groups × 2 companies with colliding codes — zero defects found.
- [x] **Security headers verified.** CSP (nonce-based), X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS (production-gated) all confirmed present via live `fetch()`; Cache-Control has a documented, accepted Next.js-framework residual behavior (see `docs/SECURITY_REVIEW.md`).
- [x] **Dependency audit reviewed.** 5 findings, all dev-tooling-only, explicitly accepted (DEF-004).
- [x] **Secret scan clean.** Zero real secrets in git-tracked files; only documented non-functional placeholder credentials.
- [x] **Database migration rehearsed.** All 5 migrations applied cleanly from scratch against a disposable database; idempotent redeploy confirmed; hand-authored constraints/triggers verified present and functioning post-migration.
- [x] **Backup/restore rehearsed.** Full drop-and-restore disaster simulation against a disposable database; row counts, constraints, triggers, and app-level (Prisma) queryability all confirmed intact post-restore.
- [x] **Accessibility reviewed.** 20 automated axe-core route/state checks (all `(app)`/`(auth)` routes) plus a manual keyboard/focus spot-check; one real finding fixed (DEF-005), one real finding documented not fixed (DEF-007). No claim of full WCAG 2.2 AA compliance — see `docs/ACCESSIBILITY_REPORT.md`'s Known Limitations.
- [x] **Performance tested at 100/500/1,000-position scale.** All 18 organogram/dashboard-assembly scenarios pass comfortably under their pre-committed thresholds (decided before results were seen).
- [x] **CSV import performant at required scale.** **READY (Phase 13.1)** — 1,000-row import now completes in ~717ms median (was 31.8s); 5,000-row import in ~2,933ms median (previously did not complete within 5 minutes at all). DEF-009 fully resolved via a bulk-create path for CSV CREATE rows — see `docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md`.
- [x] **PNG export performant at scale.** **READY, accepted conditionally (Phase 13.1)** — a measured, server-enforced safe limit (~250 positions / 20 megapixels at 1x scale) now rejects oversized PNG requests instantly, before any render is attempted, and recommends PDF. PDF export at the same scale remains within budget and is a working alternative. DEF-010 resolved as "accepted conditionally," per the stakeholder decision — see `docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md`.
- [x] **Hierarchy-mutation concurrency safe.** DEF-006 (a real, deterministic reporting-cycle race) found and fixed this phase via row-level locking; 5/5 post-fix runs clean.
- [x] **Cross-browser/responsive reviewed — Chromium only, honestly disclosed.** This environment has no Firefox/WebKit/real-mobile-device testing capability (`playwright install --with-deps chromium` only, matching CI). Not claimed as tested; documented as a known gap, not silently skipped.
- [x] **Regression suite organized and runnable via one documented command.** `npm run quality` (format/lint/typecheck/unit-with-coverage/build) plus `npm run test:integration` and `npm run test:e2e` cover the full release-relevant surface; no new consolidated "regression" script was added beyond these three existing, already-documented entry points (judged sufficient — a fourth wrapper script would be pure duplication).
- [x] **Negative-scenario catalog reviewed.** `docs/NEGATIVE_SCENARIOS.md`'s 100+ existing items reviewed; RBAC-related entries (A19) updated to point at new automated coverage. New release-hardening-specific scenarios are represented by the new test files themselves (RBAC matrix, domain-integrity checks, concurrency, performance) rather than restated as a separate prose list.
- [x] **CI updated into a release-candidate gate.** Domain-integrity smoke check, dependency audit (informational), outdated-dependency report (informational), and secret scan added as required/visible steps; documented what CI does and cannot cover.
- [x] **UAT artifacts prepared.** Idempotent seed script (`prisma/seed-uat.ts`, `npm run db:seed:uat`), CSV import examples (`docs/uat-fixtures/`), `docs/UAT_PLAN.md` with 4 role-based scenario sets.
- [x] **HR user guide and support runbook written.** `docs/HR_USER_GUIDE.md`, `docs/SUPPORT_RUNBOOK.md`.
- [x] **MVP scope traceability reviewed.** `docs/MVP_SCOPE_AND_TRACEABILITY.md` — 21 capabilities catalogued, 19 Implemented, 1 Partial (print-friendly view, resolved via documentation amendment — DEF-002), 1 Not Yet Due (deployment docs, correctly deferred to Phase 14). All 7 MVP Exclusions independently confirmed absent.

## Release-Blocking Items Remaining

**None as of Phase 13.1.** Both items previously listed here are resolved:

1. ~~DEF-009 (High) — CSV import performance.~~ **Fixed** — stakeholder decision was to block and fix, not accept a caveat; see `docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md`.
2. ~~DEF-010 (Medium) — PNG export performance at 500+/1,000-node scale.~~ **Accepted conditionally, as designed** — a measured safe limit now enforces the accepted condition (PNG under the limit, PDF redirect above it); see the same report.

Every item on this checklist is now either fully resolved or explicitly, deliberately accepted with documented rationale — none is a silent gap. See the Phase 13.1 remediation report for the final, clean release-gate reverification evidence (two controlled full unit runs, one clean full integration run, and E2E results with an honestly-documented host-contention caveat).
