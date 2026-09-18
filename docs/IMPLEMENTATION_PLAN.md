# Implementation Plan — Dynamic Organogram Manager

Ordered, bounded phases. A phase is not started until the prior phase has passed its quality gate (`.claude/skills/phase-quality-gate/`). Every phase must produce a scenario matrix (`.claude/skills/negative-test-design/`) before production code, and a phase report (`docs/phase-reports/`) after.

Legend for "Business rules affected": references `docs/PROJECT_SPEC.md` §7 rule numbers.

---

## Phase 0: Architecture, Planning and Skills

**Objective:** Establish the documented product/technical baseline before any code exists.

**Dependencies:** None.

**Features:** All documents under `docs/`, `CLAUDE.md`, ADRs, project-local skills. No application code.

**Explicit non-goals:** No boilerplate, no dependencies installed, no application features.

**Business rules affected:** None directly — this phase documents them.

**Positive/negative scenarios:** N/A — documentation phase. (Per §14 of the task brief, non-applicable categories are marked with a reason, not silently omitted.)

**Required automated tests:** None.

**Acceptance criteria:** All documents in `docs/PROJECT_SPEC.md` §"Documents" list exist with all required sections; skills or fallback workflows exist; no unresolved requirement was silently confirmed; internal links resolve.

**Required verification commands:** None (no code to run yet). Manual document review only.

**Completion gate:** This document set exists and passes the Phase 0 verification checklist recorded in the Phase 0 report.

**Expected deliverables:** `CLAUDE.md`, all `docs/*.md` listed in the task brief, `docs/adr/*`, `.claude/skills/*`, `docs/phase-reports/README.md`, `docs/phase-reports/phase-0.md`.

---

## Phase 1: Project Boilerplate and Foundation

**Objective:** Stand up the Next.js/TypeScript project skeleton with the chosen stack wired together but no domain features yet.

**Dependencies:** Phase 0 complete.

**Features:** Next.js App Router project scaffold, TypeScript config, Tailwind + shadcn/ui setup, ESLint/Prettier config, base folder structure per `docs/ARCHITECTURE.md` §3, `.env.example`, health-check route, CI pipeline skeleton (lint/typecheck/build/test stages), base layout/navigation shell (no role-aware content yet).

**Explicit non-goals:** No database schema, no auth, no domain screens beyond placeholder routes that exist but do nothing yet (and are clearly marked as scaffolding in the phase report — not "placeholder functionality" left in a shipped state, since this phase's whole output _is_ scaffolding).

**Business rules affected:** None.

**Positive scenarios:** App builds and runs locally; lint/typecheck pass on a clean scaffold; CI pipeline runs successfully on an empty diff.

**Negative scenarios:** Build fails loudly (not silently) on a typecheck error introduced deliberately in a throwaway test; lint fails loudly on a deliberate violation. (Auth/DB/permission categories: not applicable yet — no such surfaces exist in this phase.)

**Required automated tests:** A trivial smoke test (renders the base layout) to prove the test runner itself is correctly wired — not domain tests, since there's no domain yet.

**Acceptance criteria:** `npm run lint`, typecheck, and `npm run build` succeed; CI pipeline executes all configured stages; folder structure matches `docs/ARCHITECTURE.md` §3.

**Required verification commands:** lint, typecheck, `next build`, smoke test run.

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** Working scaffold, `docs/phase-reports/phase-1.md`, `docs/DECISIONS.md` updated with any tooling-version assumptions made.

---

## Phase 2: Database and Domain Services

**Objective:** Implement the Prisma schema for all entities in `docs/DATA_DICTIONARY.md` and the domain service layer for Department/Position/Employee CRUD plus `hierarchy.service` (move, level recalculation, cycle detection) — without UI yet.

**Dependencies:** Phase 1.

**Features:** Prisma schema + initial migration, repository layer, `department.service`, `position.service`, `employee.service`, `hierarchy.service`, `audit.service`, typed domain errors, seed script with synthetic (non-real) fixture data.

**Explicit non-goals:** No UI, no auth/RBAC enforcement yet (services exist but are not yet wired behind authenticated routes), no import/export, no organogram rendering.

**Business rules affected:** 1–11 (all core hierarchy/entity rules except server-side permission enforcement, which is Phase 3).

**Positive scenarios:** create department/position/employee; assign employee to vacant position; move a position to a new valid parent and see descendant levels update; deactivate an employee and see the position revert to Vacant.

**Negative scenarios:** duplicate position/employee/department code (incl. case-insensitive); self-reporting; direct cycle; indirect cycle; move beneath own descendant; missing/invalid Reports-To reference; second root position; whitespace-only required fields; excessive field length; simulated mid-transaction failure (assert full rollback, per ADR-0005); assign an employee already actively assigned elsewhere (pending P2 default). Unauthorized/forbidden-role categories: not applicable yet (no auth surface exists until Phase 3) — explicitly deferred to Phase 3's matrix, not silently skipped.

**Required automated tests:** Unit tests for service-level validation logic; integration tests against a real Postgres test DB for every hierarchy invariant and transaction/rollback scenario above.

**Acceptance criteria:** Every business rule 1–11 has a passing positive and negative test; a deliberately-failed multi-step hierarchy move leaves the database byte-for-byte unchanged (assert via full-table comparison in the integration test).

**Required verification commands:** lint, typecheck, unit tests, integration tests (against ephemeral Postgres), migration apply/rollback dry run.

**Completion gate:** phase-quality-gate PASS, including migration validation.

**Expected deliverables:** Prisma schema/migrations, service layer, seed script, `docs/phase-reports/phase-2.md`, `docs/DATA_DICTIONARY.md` updated if implementation revealed any field-level gap.

---

## Phase 3: Authentication and RBAC

**Objective:** Wire Auth.js (credentials provider) and implement server-side authorization policies for the four roles.

**Dependencies:** Phase 2 (User entity, services to authorize against).

**Features:** Login/logout flow, session handling, `server/policies` implementing the Role–Permission Matrix (`docs/PROJECT_SPEC.md` §10), admin-provisioned account creation, password hashing, route/action-level guards applied to every Phase 2 service entry point.

**Explicit non-goals:** No SSO provider implementation (pending P8 default — credentials only for MVP), no self-signup, no password-reset self-service beyond admin-driven reset.

**Business rules affected:** Rule 12 (server-side enforcement) — this phase is where it becomes real and testable.

**Positive scenarios:** login with valid credentials for each role; each role can perform every capability the matrix grants it; session persists correctly; logout invalidates session.

**Negative scenarios:** invalid credentials; disabled account login attempt; expired/tampered session; each role attempting every capability the matrix denies it (full matrix cross-product — see `docs/NEGATIVE_SCENARIOS.md` §Authorization); privilege escalation attempt (e.g. a crafted request claiming a different role); direct API/service call bypassing the UI to attempt an unauthorized mutation (must still be rejected server-side).

**Required automated tests:** Unit tests per policy function; integration tests hitting server actions/route handlers directly (not just through UI) for every matrix cell; a specific regression test proving no capability is enforced client-side only.

**Acceptance criteria:** 100% of the Role–Permission Matrix cells have a passing test proving both the allow and deny paths; no service method from Phase 2 is reachable without an authorization check.

**Required verification commands:** lint, typecheck, unit + integration + permission test suites, build.

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** Auth wiring, policies, full permission test suite, `docs/phase-reports/phase-3.md`.

---

## Phase 4: Department Management

**Objective:** Ship the HR-facing Department management UI on top of Phase 2/3.

**Dependencies:** Phase 3.

**Features:** Department list/create/edit/deactivate screens (FR-D1–D4), department color picker, parent-division selection, head-of-department assignment.

**Explicit non-goals:** No organogram rendering yet (that's Phase 8); no CSV import yet.

**Business rules affected:** Department portions of rules 9 (duplicate codes), 12.

**Positive scenarios:** create/edit/deactivate a department as HR Admin/Super Admin.

**Negative scenarios:** duplicate code (incl. case-insensitive); whitespace-only/oversized name; invalid color format; deactivating/deleting a department still referenced by active positions; HR Viewer/Employee Viewer attempting to mutate (403); double-submission of the create form (no duplicate row from a double click).

**Required automated tests:** Component tests for the form; integration tests for the service+API path; E2E test for the create-department journey.

**Acceptance criteria:** FR-D1–D4 fully implemented and tested; UI enforces nothing that the server doesn't also enforce.

**Required verification commands:** lint, typecheck, unit/integration/component tests, relevant E2E test, build.

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** Department management feature, `docs/phase-reports/phase-4.md`.

---

## Phase 5: Position and Hierarchy Management

**Objective:** Ship Position CRUD and the primary-reporting/move UI — the most invariant-sensitive phase.

**Dependencies:** Phase 4 (positions belong to departments).

**Features:** Position list/create/edit screens, status management (Filled/Vacant/Planned/Inactive display, HR-driven status changes per FR-P9), Reports-To selection with cycle/self-report prevention surfaced clearly in the UI, "move position" flow with descendant-recalculation feedback.

**Explicit non-goals:** No drag-and-drop (deferred per `docs/DECISIONS.md` §5); no organogram canvas yet (Phase 8) — this phase's UI can use a list/tree view, not the visual chart.

**Business rules affected:** 4–10, 12.

**Positive scenarios:** create a position under a valid parent; change a position's Reports-To to a new valid parent and see levels recalculate for it and all descendants; change status among valid transitions.

**Negative scenarios:** every hierarchy-safety scenario from Phase 2's matrix, now exercised through the UI/API boundary; invalid status transition (see `docs/NEGATIVE_SCENARIOS.md`); concurrent moves of overlapping branches by two users (last-write-wins vs. conflict — resolved per `docs/NEGATIVE_SCENARIOS.md` §Concurrency); stale-update (editing a position that changed since the form was loaded); HR Viewer/Employee Viewer attempting mutation.

**Required automated tests:** Component tests for the position form and move flow; integration tests re-verifying hierarchy invariants at the API boundary (not just the service unit level); E2E test for "move a branch and confirm descendant levels update."

**Acceptance criteria:** Every hierarchy invariant in `CLAUDE.md` §2 is verified through the full stack, not just the service layer; concurrency behavior for overlapping moves is defined and tested, not left to chance.

**Required verification commands:** lint, typecheck, unit/integration/component tests, relevant E2E tests, build.

**Completion gate:** phase-quality-gate PASS — this phase requires the `organogram-hierarchy-safety` skill to be explicitly run before sign-off.

**Expected deliverables:** Position/hierarchy management feature, `docs/phase-reports/phase-5.md`.

---

## Phase 6: Employee Management

**Objective:** Ship Employee CRUD and employee↔position assignment.

**Dependencies:** Phase 5 (positions must exist to assign employees to).

**Features:** Employee list/create/edit/deactivate screens (FR-E1–E5), assign/unassign employee to/from a position, employment-status management.

**Explicit non-goals:** No employee photos/contact-detail display on chart cards (deferred, pending P4). Multi-position assignment stays out unless P2 has been confirmed otherwise by this point — check `docs/DECISIONS.md` before starting.

**Business rules affected:** 1, 2, 3, 9 (duplicate employee code, invalid assignment), 11, 12.

**Positive scenarios:** create employee; assign to vacant position (position becomes Filled); deactivate/transfer employee (position reverts to Vacant, employee record itself is not deleted).

**Negative scenarios:** duplicate employee code; assigning an already-actively-assigned employee to a second position (pending P2 default — rejected); assigning to an `INACTIVE` position; whitespace-only/oversized name; invalid email format when provided; double-submission; HR Viewer/Employee Viewer attempting mutation; deleting an employee record that has audit history (must be prevented — deactivate only).

**Required automated tests:** Component, integration, and E2E coverage mirroring Phase 4/5's pattern for this domain.

**Acceptance criteria:** FR-E1–E5 implemented and tested; confirms P2's interim default is enforced, not silently ignored.

**Required verification commands:** lint, typecheck, unit/integration/component tests, relevant E2E tests, build.

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** Employee management feature, `docs/phase-reports/phase-6.md`.

---

## Phase 7: Dashboard and Company Overview

**Objective:** Ship the Company Overview view (FR-O2).

**Dependencies:** Phase 6 (needs departments, positions, employees populated to summarize).

**Features:** Root position display, top-level department summary with heads, total/filled/vacant position counts, high-level org summary widgets.

**Explicit non-goals:** No expand/collapse tree, no full canvas (that's Phase 8) — this is a summary dashboard, not the interactive organogram.

**Business rules affected:** 3, 5 (correct root display), 12 (role-based field visibility on the summary).

**Positive scenarios:** dashboard reflects current counts accurately after create/deactivate/assign operations from prior phases.

**Negative scenarios:** empty-state (no positions yet — dashboard renders a sane empty state, not an error); very large counts (dashboard remains responsive at ~2,000-position scale, pending P7); Employee Viewer sees only non-confidential summary fields (pending P1).

**Required automated tests:** Component tests for summary widgets; integration test verifying counts match underlying data including edge cases (zero positions, all vacant, etc.); E2E smoke test for the dashboard journey.

**Acceptance criteria:** Dashboard numbers are always derived live from current data (never a stale cached count that can drift), and correctly reflect P1's field-visibility default per role.

**Required verification commands:** lint, typecheck, unit/integration/component tests, E2E smoke test, build.

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** Company Overview feature, `docs/phase-reports/phase-7.md`.

---

## Phase 8: Interactive Organogram

**Objective:** Ship the Full Organogram view — the product's centerpiece (FR-O1, FR-O3).

**Dependencies:** Phase 7 (reuses the same data-summarization patterns); Phase 5's hierarchy data is the direct input.

**Features:** React Flow canvas + ELK.js layout per `docs/ARCHITECTURE.md` §9, department-based coloring, expand/collapse per node/branch/whole tree, zoom/pan/fit-to-screen/full-screen, minimap, position detail panel on card selection, non-graphical fallback table view (accessibility requirement, `docs/PROJECT_SPEC.md` §12).

**Explicit non-goals:** No drag-and-drop editing from the canvas (deferred); no CSV export yet (Phase 11).

**Business rules affected:** 5, 6, 7 (level/grouping correctness reflected visually), 12 (field visibility per role on cards).

**Positive scenarios:** organogram renders correctly for a known small fixture hierarchy; expand/collapse updates the visible subgraph and re-lays-out correctly; zoom/pan/fit-to-screen/full-screen work; department colors match department records.

**Negative scenarios:** empty organogram (no positions yet); very large organogram (~2,000 positions, pending P7 — verify usable pan/zoom/expand without unacceptable jank); a position with a missing/orphaned department reference (should not crash the render); accessibility failure (keyboard navigation through nodes, screen-reader labels, non-color-only status indication — `docs/PROJECT_SPEC.md` §12); Employee Viewer sees the correct restricted field set on cards.

**Required automated tests:** Component tests for `OrgNode`/canvas wrapper logic; integration test for `organogram.service.getGraph` scope/field-visibility correctness; E2E tests for the render/expand/collapse/zoom/search-highlight journeys; an accessibility audit pass (automated a11y checker + manual keyboard-nav verification, since full visual accessibility can't be 100% automated).

**Acceptance criteria:** FR-O1/FR-O3 fully met; large-dataset performance target from `docs/PROJECT_SPEC.md` §14 verified with a representative fixture; accessibility fallback table view exists and is functionally equivalent for data access.

**Required verification commands:** lint, typecheck, unit/integration/component tests, relevant E2E tests, accessibility audit, build.

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** Full Organogram feature, `docs/phase-reports/phase-8.md`.

---

## Phase 9: Search, Filters and Focus View

**Objective:** Ship search (FR-O5), filters (FR-O6), and Focus View (FR-O4).

**Dependencies:** Phase 8 (search/filter operate on the same organogram data/rendering).

**Features:** Search by employee name/position title/employee code/position code with result highlighting/centering; filters by department/level/location/job grade/vacancy status; Focus View scoped to department, manager, employee, or reporting chain.

**Explicit non-goals:** No saved-filter presets or advanced query builder beyond the specified filter set.

**Business rules affected:** 12 (filtered/focused results still respect field visibility per role).

**Positive scenarios:** search finds and centers the correct node by each supported field; each filter (individually and combined) narrows results correctly; Focus View correctly scopes to each of its four modes.

**Negative scenarios:** search with no matches (clear empty state, not a silent no-op); search/filter with special characters or excessively long input; filters that combine to zero results; Focus View on a position with no descendants/no manager (edge of the tree); large-result-set filter performance at ~2,000-position scale.

**Required automated tests:** Component tests for search/filter UI; integration tests for query correctness; E2E tests for each Focus View mode and at least one combined-filter journey.

**Acceptance criteria:** FR-O4–O6 fully met and tested, including edge-of-tree and no-result cases.

**Required verification commands:** lint, typecheck, unit/integration/component tests, relevant E2E tests, build.

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** Search/Filter/Focus View feature, `docs/phase-reports/phase-9.md`.

---

## Phase 10: CSV Import

**Objective:** Ship the two-phase import pipeline (ADR-0007, FR-I1/FR-I2).

**Dependencies:** Phase 6 (imports create/update Departments, Positions, Employees via the same services).

**Features:** File upload, `import.service.parse()` preview UI (valid/invalid rows, per-row reasons, row-exclusion controls), `import.service.commit()` with transactional apply, import result summary, audit entries for the import batch.

**Explicit non-goals:** No scheduled/automatic recurring import, no direct external-system sync (deferred).

**Business rules affected:** 9 (duplicate/invalid detection), 10 (atomic commit), 12.

**Positive scenarios:** valid CSV imports cleanly and reflects immediately in Departments/Positions/Employees and the organogram; a file with some invalid rows previews correctly and commits only the accepted subset when the user excludes the invalid ones.

**Negative scenarios:** malformed CSV (bad encoding, wrong delimiter, missing header); oversized CSV (row-count/file-size limit, per `docs/PROJECT_SPEC.md` §14); duplicate codes within the file; duplicate codes against existing DB data; shuffled parent rows (child row before parent row in file order — must still resolve correctly, per ADR-0007); rows forming a cycle across the batch; partial invalid import where the user attempts to commit anyway (blocked per FR-I2 unless invalid rows are explicitly excluded); double-submission of commit (no double-apply); a simulated failure mid-commit (assert full rollback of the entire batch, per ADR-0005); HR Viewer/Employee Viewer attempting import.

**Required automated tests:** Unit tests for row-level and cross-row validation logic; integration tests for commit atomicity/rollback and for the shuffled-parent-rows and cycle-across-batch cases specifically; component tests for the preview UI; E2E test for the full upload→preview→commit journey including an intentionally-invalid file.

**Acceptance criteria:** FR-I1/FR-I2 fully met; every negative scenario above has a passing test; no import path bypasses the standard per-entity service validation.

**Required verification commands:** lint, typecheck, unit/integration/component tests, relevant E2E tests, build.

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** CSV import feature, `docs/phase-reports/phase-10.md`.

---

## Phase 11: Export and Print

**Objective:** Ship PDF export, PNG export, and print-friendly view.

**Dependencies:** Phase 8/9 (exports the currently rendered/filtered/focused organogram).

**Features:** PDF export, PNG export, print stylesheet, respecting current filters/scope and the exporting user's field-visibility.

**Explicit non-goals:** No headless-browser rendering (Puppeteer/Playwright) — server-side rendering is done via a pure SVG generator + `sharp`/`pdfkit` (assumption A4, amended in Phase 11 — see A40; the original "client-side only" MVP framing was superseded by Phase 11's own explicit requirement for private server storage and server-checked download authorization); no scheduled/emailed export delivery; no CSV data export or PowerPoint export (this phase is PDF/PNG of the organogram only).

**Business rules affected:** 12 (exported/printed output must not leak fields the exporting role can't see).

**Positive scenarios:** export the full organogram and a filtered/focused view to PDF and PNG; print view renders legibly for a representative branch and for the full company view.

**Negative scenarios:** export of an empty organogram (no positions yet — sane empty output, not a broken file); export failure (e.g. browser export API error) surfaces a clear error rather than a corrupt/blank download; export respects Employee Viewer's restricted field set (no confidential-field leakage in the exported artifact); very large export (~2,000 positions) completes without freezing the UI or producing an unusably huge file.

**Required automated tests:** Component/integration tests for export payload construction and field-visibility filtering; E2E test asserting a download is triggered with expected content characteristics (e.g. correct filename/mime type, and — where feasible — that a restricted-role export excludes confidential fields at the data-payload level even if the final rendered image can't be asserted pixel-by-pixel in CI).

**Acceptance criteria:** FR-I3 fully met; confidential-field leakage negative scenario explicitly verified, not assumed.

**Required verification commands:** lint, typecheck, unit/integration/component tests, relevant E2E tests, build.

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** Export/print feature, `docs/phase-reports/phase-11.md`.

---

## Phase 12: Audit and Administration

**Objective:** Ship the audit history view and user management (Super Admin).

**Dependencies:** Phase 3 (User/RBAC), and audit entries have been accumulating since Phase 2 — this phase makes them visible/manageable.

**Features:** Audit history list/filter/detail view (HR_ADMIN/SUPER_ADMIN only), user management screens (create/disable users, assign roles — SUPER_ADMIN only).

**Explicit non-goals:** No audit-entry editing/deletion (append-only, per ADR-0008) — not even for Super Admin.

**Business rules affected:** 12, plus the audit-immutability guarantee from ADR-0008.

**Positive scenarios:** Super Admin creates a new HR Admin user; Super Admin disables a user; HR Admin views audit history for a specific position and sees the full old/new value trail from prior phases' operations.

**Negative scenarios:** HR Admin/HR Viewer/Employee Viewer attempting to reach user management (403); any role attempting to modify or delete an audit entry via direct API call (must be rejected — no such endpoint should exist, and if attempted via a malformed request, it must fail safely); creating a user with a duplicate email; disabling the last remaining Super Admin account (should be prevented or at minimum strongly warned, to avoid full lockout — define exact behavior in the phase's scenario matrix); audit list at large volume (pagination/performance).

**Required automated tests:** Integration/permission tests for user management RBAC; integration test proving no audit-mutation endpoint exists/succeeds; component/E2E tests for both screens.

**Acceptance criteria:** Audit history is fully readable and correctly attributed for all prior phases' test data; user management fully respects the Role–Permission Matrix; audit immutability is verified, not assumed.

**Required verification commands:** lint, typecheck, unit/integration/component tests, relevant E2E tests, build.

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** Audit/User management feature, `docs/phase-reports/phase-12.md`.

---

## Phase 13: Release Hardening

**Objective:** Cross-cutting hardening pass across the whole MVP before deployment: security review, performance verification, accessibility verification, regression suite stabilization.

**Dependencies:** Phases 1–12 complete.

**Features:** No new user-facing features. Security review (OWASP-relevant checks per the system's standing rules), performance verification against `docs/PROJECT_SPEC.md` §14 targets at representative scale, accessibility verification against §12 across all views, full regression run, dependency audit.

**Explicit non-goals:** No new functionality; do not use this phase to sneak in deferred features.

**Business rules affected:** Cross-cutting verification of all rules 1–12 together, end-to-end.

**Positive scenarios:** full regression suite passes end-to-end; representative ~2,000-position dataset performs within targets; accessibility audit passes across Overview/Full Organogram/Focus View/admin screens.

**Negative scenarios:** re-run the full negative-scenario catalog (`docs/NEGATIVE_SCENARIOS.md`) as a single consolidated pass to catch any cross-phase interaction bugs (e.g. an import-created position behaving differently from a manually-created one under the hierarchy-safety rules).

**Required automated tests:** Full existing suite (unit/integration/component/E2E) plus any gap-filling tests identified by this phase's review.

**Acceptance criteria:** No known blocking defect remains open; every item in `docs/DECISIONS.md` §2 (Pending HR Decisions) is either confirmed by the user/HR or still correctly implemented behind its documented safe default (never silently upgraded to "final" without confirmation); security and accessibility findings are resolved or explicitly accepted/deferred with rationale recorded.

**Required verification commands:** full lint/typecheck/test/build pipeline, dependency audit, performance test run, accessibility audit.

**Completion gate:** phase-quality-gate PASS with zero blocking findings.

**Expected deliverables:** Hardening fixes, `docs/phase-reports/phase-13.md`, `docs/DECISIONS.md` updated with final confirmation status of every pending item.

---

## Phase 14: Deployment and Handover

**Objective:** Produce deployment documentation and hand the system over to operate independently of the development session.

**Dependencies:** Phase 13 complete.

**Features:** Deployment runbook, environment-variable reference, production migration procedure, backup/restore notes, admin-account bootstrap procedure, HR-facing quick-start guide.

**Explicit non-goals:** No new application functionality.

**Business rules affected:** None directly — operational documentation.

**Positive scenarios:** a fresh environment can be stood up by following the runbook alone (no undocumented tribal knowledge required); first Super Admin account can be bootstrapped safely.

**Negative scenarios:** documented recovery procedure for a failed migration; documented procedure if the only Super Admin account is lost.

**Required automated tests:** N/A for documentation itself; a final full-suite run to confirm the exact commit being handed over is green.

**Acceptance criteria:** Deployment documentation is complete enough for someone outside this project to deploy and operate the system; final test/build run is green and recorded in the phase report.

**Required verification commands:** full lint/typecheck/test/build pipeline (final confirmation run).

**Completion gate:** phase-quality-gate PASS.

**Expected deliverables:** Deployment docs, `docs/phase-reports/phase-14.md`, MVP handover summary.
