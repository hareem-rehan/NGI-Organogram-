# Project Specification — Dynamic Organogram Manager

Source: [Dynamic_Organogram_Solution_Proposal.docx](source/Dynamic_Organogram_Solution_Proposal.docx), reconciled against `docs/DECISIONS.md`. Where this spec states a rule as fact, it is a **Confirmed Decision**. Where it notes "pending," see `docs/DECISIONS.md` §2 for the interim default in effect.

## 1. Product Objective

Give non-technical HR users independent, self-service control over the company's organizational structure — Departments, Positions, Employees, Vacancies, primary reporting relationships, organizational levels and job grades — without needing a developer or designer for routine changes. The organogram is **generated automatically** from position and primary-reporting data; HR never manually places or drags chart nodes.

## 2. User Types

| Role              | Summary                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPER_ADMIN`     | Full system configuration, user/role management, controlled administrative operations, complete access.                                                    |
| `HR_ADMIN`        | Manages departments, positions, employees, vacancies, primary reporting relationships; imports data; exports the organogram; views relevant audit history. |
| `HR_VIEWER`       | Views detailed organizational information; search and filter; no structural changes.                                                                       |
| `EMPLOYEE_VIEWER` | Views only approved, non-confidential organizational information; no editing; no confidential HR fields.                                                   |

Full permission matrix: §11.

## 3. Business Scope

**In scope (MVP):** organizational structure management and visualization for a single company, built as an internal web application with database-backed structured records — not a drawing tool.

**Out of scope (MVP):** anything listed in §6 below and in `docs/DECISIONS.md` §5 ("Deferred Decisions").

## 4. MVP Features

- Authentication (§8)
- Role-based access control (§11)
- Dashboard / Company Overview: root position, top-level departments, department heads, total/filled/vacant position counts, high-level summary
- Department management (CRUD)
- Position management (CRUD), including status: Filled / Vacant / Planned / Inactive
- Employee management (CRUD), separate from Position
- Vacant position management (vacancies are positions without an active employee, always visible unless filtered out)
- Primary reporting hierarchy management (assign/change a position's Reports-To position)
- Automatic organizational-level calculation (root = 1, child = parent + 1)
- Full interactive organogram: horizontal department grouping, vertical level layering, expand/collapse per node/branch/whole tree, zoom, pan, fit-to-screen, full-screen, minimap
- Focus View: department, manager, employee, or one reporting chain
- Search (by employee name, position title, employee code, position code)
- Filters (department, organizational level, location, job grade, vacancy status)
- CSV import with validation and preview-before-commit
- PDF export and PNG export of the (filtered) organogram
- Print-friendly view
- Audit history (user, action, timestamp, old value, new value)
- User management (Super Admin)
- Automated testing (unit, integration, component, E2E — see `docs/TEST_STRATEGY.md`)
- Deployment documentation

## 5. Explicit Exclusions (Deferred)

See `docs/DECISIONS.md` §5 for the authoritative list and rationale:

- Drag-and-drop hierarchy editing
- Secondary/dotted-line or matrix reporting
- HRMS integration / SSO beyond a pluggable auth provider
- Future-state organization planning, version comparison, historical/point-in-time views
- Advanced workforce analytics, custom leadership dashboards
- Multi-step approval workflow for structural changes
- Automatic external-system synchronization

## 6. Functional Requirements

### 6.1 Departments

- FR-D1: HR Admin can create, edit, and deactivate a department (name, code, color, optional parent division, head — a Position reference).
- FR-D2: Department code is unique (case-insensitive).
- FR-D3: A department cannot be deleted while active positions reference it; it can be deactivated.
- FR-D4: Department color drives the organogram's department-based color coding.

### 6.2 Positions

- FR-P1: HR Admin can create, edit, and change the status of a position (title, code, department, reports-to position, job grade, location, status).
- FR-P2: Position code is unique (case-insensitive).
- FR-P3: Every active position has exactly one primary Reports-To position, except the root position (which has none).
- FR-P4: The system rejects self-reporting and any direct or indirect reporting cycle.
- FR-P5: The system rejects moving a position beneath its own descendant.
- FR-P6: Organizational level is calculated automatically (root = 1, child = parent + 1) and is never directly editable.
- FR-P7: Moving a position (changing its Reports-To) recalculates the level of that position and every descendant, atomically, with full rollback on any failure.
- FR-P8: A position without an active employee assignment displays as Vacant.
- FR-P9: A position's status may be Filled, Vacant, Planned, or Inactive; only HR Admin/Super Admin can change status.
- FR-P10: Job grade is a value HR selects from a maintained list; it is never derived from organizational level.

### 6.3 Employees

- FR-E1: HR Admin can create, edit, and deactivate/terminate an employee record (employee code, name, contact fields, employment status), independent of any position.
- FR-E2: Employee code is unique (case-insensitive).
- FR-E3: Assigning an employee to a position links the two without altering the position's identity, code, or place in the hierarchy.
- FR-E4: Removing/transferring/deactivating an employee never deletes the position; the position reverts to Vacant.
- FR-E5 (pending P2): By default, an active employee may be linked to at most one active position at a time.

### 6.4 Organogram Generation & Views

- FR-O1: The organogram is generated entirely from Position + primary-reporting data; there is no manual node-positioning UI.
- FR-O2: Company Overview shows root position, top-level departments, department heads, and total/filled/vacant counts.
- FR-O3: Full Organogram shows the complete hierarchy with departments arranged horizontally and levels vertically, expandable/collapsible branches, zoom/pan/fit-to-screen/full-screen, department-based coloring, and position/employee info on each card.
- FR-O4: Focus View lets a user scope the view to one department, one manager's team, one employee's reporting chain, or a selected branch.
- FR-O5: Search resolves by employee name, position title, employee code, or position code and highlights/centers the result in the organogram. **Note (`docs/DECISIONS.md` A29):** employee code is deliberately excluded from search scope in the shipped implementation (already excluded from the organogram's field contract as of Phase 8) — search actually covers position code, title, occupant display name, and department name/code.
- FR-O6: Filters combine by department, organizational level, location, job grade, and vacancy status.

### 6.5 Import / Export

- FR-I1: CSV import parses the file, validates every row, and shows row-level errors in a preview before any data is committed.
- FR-I2: A CSV commit that contains any unresolved blocking error commits nothing (all-or-nothing per import batch, unless the user explicitly excludes failing rows from the batch).
- FR-I3: Export produces PDF and PNG of the current (filtered) organogram view, and a print-friendly stylesheet. **Amended by `docs/DECISIONS.md` A52 (Phase 13):** no separate `@media print` stylesheet was built; Phase 11's server-rendered PDF export is treated as satisfying the print-friendly-output need (generate a PDF, print it via the OS/PDF-viewer print dialog). See A52 for why this was a retroactive documentation fix, not a new decision.

### 6.6 Audit

- FR-A1: Every structural mutation (department, position, employee, reporting-relationship change, import commit) writes an audit entry: user, action, timestamp, old value, new value.
- FR-A2: Audit history is viewable by HR Admin and Super Admin; not editable or deletable by anyone.

## 7. Business Rules

Restated from `docs/DECISIONS.md` §1 (Confirmed) for direct reference during implementation:

1. Position and Employee are separate entities.
2. A position remains in the hierarchy when its employee leaves, is transferred, or is deactivated.
3. A position without an employee is Vacant.
4. Every active position has one primary Reports-To position, except root.
5. Root position has no parent and Organizational Level 1.
6. Child level = parent level + 1.
7. Department headings and visual group headings do not count as organizational levels.
8. Organizational Level is automatic; Job Grade is HR-maintained; they are independent.
9. The system prevents: self-reporting, direct cycles, indirect cycles, moving a position beneath its descendant, duplicate position codes, duplicate employee codes, invalid employee-position assignments, unauthorized structural changes.
10. Moving a position updates its parent, recalculates its level and every descendant's level, executes atomically in a DB transaction, and rolls back fully on any failure.
11. Removing an employee never deletes the position.
12. Permissions and business rules are enforced server-side, not only via UI controls.

## 8. Validation Rules

| Field/Action                                   | Rule                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Position code, Employee code, Department code  | Required, non-empty after trim, unique case-insensitively, max length enforced (see `docs/DATA_DICTIONARY.md`)                                                                       |
| Position title, Employee name, Department name | Required, non-empty after trim, max length enforced                                                                                                                                  |
| Reports-To position                            | Must reference an existing, active position; must not create a cycle; must not equal the position itself                                                                             |
| Root position                                  | At most one position may have a null Reports-To (the root); attempting to create a second root is rejected                                                                           |
| Position status transitions                    | Must follow the allowed transition set (see `docs/NEGATIVE_SCENARIOS.md`); invalid transitions rejected server-side                                                                  |
| Employee↔Position assignment                   | Rejected if the employee is already actively assigned elsewhere (pending P2 default) or the position is Inactive                                                                     |
| CSV import row                                 | Rejected (with a reported reason) on missing required field, unresolvable Reports-To code, duplicate code within the file or against existing data, and malformed status/enum values |
| Authenticated mutation                         | Rejected with 403 if the acting role lacks permission, independent of what the UI allowed the user to attempt                                                                        |

## 9. User Journeys

1. **HR Admin adds a new position under an existing manager.** Create position → select department → select Reports-To position → system validates and computes level → position appears Vacant in the organogram immediately.
2. **HR Admin assigns an employee to a vacant position.** Open position → assign existing or newly created employee → position now shows Filled with employee details; audit entry recorded.
3. **HR Admin moves a team under a new manager.** Select the team's top position → change its Reports-To → system validates against cycles/self-reporting/descendant rule → recalculates levels for the position and all descendants inside one transaction → organogram reflects the new branch atomically.
4. **HR Admin removes an employee.** Deactivate/transfer the employee → position automatically reverts to Vacant → position remains in the hierarchy unchanged.
5. **HR Admin imports a CSV of positions/employees.** Upload file → system validates every row and shows a preview with per-row errors → HR Admin reviews and confirms → valid rows commit atomically; errors are surfaced, not silently dropped.
6. **HR Viewer explores the org.** Opens Full Organogram → searches for an employee → view centers/expands to that node → switches to Focus View to see just that employee's reporting chain.
7. **Employee Viewer looks up who they report to.** Opens the approved public view → sees position titles, names, and departments; does not see confidential fields (pending P1 default).
8. **HR Admin exports for a leadership meeting.** Filters organogram to one department → exports to PDF → uses print-friendly view for a physical handout.

## 10. Role–Permission Matrix

| Capability                                           | SUPER_ADMIN | HR_ADMIN | HR_VIEWER |          EMPLOYEE_VIEWER          |
| ---------------------------------------------------- | :---------: | :------: | :-------: | :-------------------------------: |
| View Company Overview / Full Organogram / Focus View |     ✅      |    ✅    |    ✅     | ✅ (non-confidential fields only) |
| Search & filter                                      |     ✅      |    ✅    |    ✅     |        ✅ (limited fields)        |
| Create/edit/deactivate Department                    |     ✅      |    ✅    |    ❌     |                ❌                 |
| Create/edit Position, change status                  |     ✅      |    ✅    |    ❌     |                ❌                 |
| Change primary Reports-To / move hierarchy branch    |     ✅      |    ✅    |    ❌     |                ❌                 |
| Create/edit/deactivate Employee                      |     ✅      |    ✅    |    ❌     |                ❌                 |
| Assign/unassign Employee↔Position                    |     ✅      |    ✅    |    ❌     |                ❌                 |
| Import CSV                                           |     ✅      |    ✅    |    ❌     |                ❌                 |
| Export PDF/PNG / print view                          |     ✅      |    ✅    |    ✅     |                ❌                 |
| View audit history                                   |     ✅      |    ✅    |    ❌     |                ❌                 |
| Manage users & roles                                 |     ✅      |    ❌    |    ❌     |                ❌                 |
| System configuration                                 |     ✅      |    ❌    |    ❌     |                ❌                 |
| View confidential fields (pending P1)                |     ✅      |    ✅    |    ✅     |                ❌                 |

This matrix must be enforced server-side (business rule 12 / FR §7.12) — never rely on hiding a control in the UI.

## 11. Non-Functional Requirements

- **Availability:** internal business-hours application; no explicit HA/multi-region requirement stated. Design for graceful restart, not zero-downtime clustering, in MVP.
- **Data integrity:** hierarchy-affecting writes are transactional (business rule 10); no partial writes ever persist.
- **Scalability:** support up to ~2,000 positions without the Full Organogram view degrading (pending P7 default) — lazy rendering / virtualization required.
- **Auditability:** every structural mutation is attributable to a user and timestamp, permanently retained.
- **Maintainability:** HR-facing changes require zero developer involvement once the MVP ships.

## 12. Accessibility Expectations

- All interactive controls (forms, filters, search, organogram controls) must be keyboard-operable and screen-reader labeled.
- Color is never the sole means of conveying department or status — pair with text/icon (e.g., "Vacant" label, not just a color).
- Meet WCAG 2.1 AA contrast for text and meaningful UI components, including on organogram node cards.
- Provide a non-graphical fallback (e.g., filterable/sortable table) for organogram data for users who cannot use the canvas view.

## 13. Security Expectations

- All authorization checks happen server-side (business rule 12); client-side role checks are a UX convenience only.
- Passwords/credentials are never logged, never stored in plaintext, never hard-coded (CLAUDE.md §1.11).
- CSRF protection and secure session handling via the chosen auth library (see `docs/ARCHITECTURE.md`).
- CSV import is validated and size-limited server-side to prevent malicious payloads and resource exhaustion.
- Confidential-field visibility (pending P1) is enforced in the data-fetching layer, not by filtering fields client-side after an unrestricted API response.

## 14. Performance Expectations

- Organogram initial render for a typical department/branch view: perceived load under ~2 seconds on a standard office connection.
- Full-company organogram (up to ~2,000 positions): usable pan/zoom/expand interaction without noticeable jank, via lazy rendering of collapsed branches.
- Search/filter results return interactively (sub-second for typical result sets against the expected data scale).
- CSV import of a full company dataset (up to ~2,000 rows) completes preview validation without blocking the UI thread (client-perceived responsiveness maintained during validation).

## 15. MVP Acceptance Criteria

The MVP is acceptable when:

1. All Functional Requirements in §6 are implemented and covered by passing automated tests (positive and negative — see `docs/TEST_STRATEGY.md`).
2. All Business Rules in §7 hold under the negative-scenario matrix in `docs/NEGATIVE_SCENARIOS.md`.
3. The Role–Permission Matrix (§10) is enforced server-side and verified by permission tests for every role/action combination.
4. The organogram is generated automatically from data for at least the three MVP views (Company Overview, Full Organogram, Focus View) — no manual node placement exists anywhere in the product.
5. CSV import round-trips a realistic dataset (valid and intentionally-invalid rows) with correct preview, validation, and atomic commit behavior.
6. PDF/PNG export and print view produce a usable, correctly filtered output.
7. Audit history is complete and immutable for all structural mutations performed during testing.
8. Accessibility (§12) and security (§13) expectations are verified, not just asserted.
9. Every "Pending HR Decision" (`docs/DECISIONS.md` §2) is implemented behind its documented safe default, not silently finalized.
10. `phase-quality-gate` returns PASS or PASS WITH NON-BLOCKING ITEMS for every phase, with no unresolved blocking item at MVP sign-off.
