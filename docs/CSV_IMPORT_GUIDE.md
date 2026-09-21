# CSV Import Guide — Dynamic Organogram Manager

Authoritative reference for Phase 10's bulk CSV import feature. If the app's actual behavior disagrees with this file, that's a bug (`CLAUDE.md` §1.13/1.16). See `docs/adr/0007-import-strategy.md` for the architectural decision this implements, and `docs/NEGATIVE_SCENARIOS.md`'s "CSV Import (Phase 10)" section for the full negative-scenario coverage.

## 1. Supported import types

Four import types, each its own CSV file — you cannot mix entity types in one file.

| Type                | Creates/updates                                                            | Matching key                       |
| ------------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| Department          | `Department`                                                               | company + `departmentCode`         |
| Position            | `Position`                                                                 | company + `positionCode`           |
| Employee            | `Employee`                                                                 | company + `employeeCode`           |
| Position Assignment | `PositionAssignment` (via `ASSIGN`/`TRANSFER`/`END_ASSIGNMENT` operations) | employee + position, per operation |

## 2. Permissions

Every step — template access, upload, validation, preview, execution, error-report download, job history — requires `imports:execute`. `ADMIN` and `HR_EDITOR` hold it; `VIEWER` does not (`docs/AUTHORIZATION_MATRIX.md`).

## 3. File limits

- Maximum file size: 10 MB.
- Maximum data rows: 5,000 (not counting the header row).
- Maximum columns: 30.
- Maximum single-cell length: 1,000 characters.
- Encoding: UTF-8, with or without a byte-order mark.
- Delimiter: comma only. A file using another delimiter (e.g. semicolon) parses as a single unrecognized column and is rejected as missing required headers.

## 4. Templates

Download a template from the Imports page for any import type — a header row plus one clearly fictional example row. No real data ever appears in a template.

### Department (`department-import-template.csv`)

| Column                 | Required | Notes                                                                                      |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `departmentCode`       | yes      | 2–30 chars, matching key                                                                   |
| `departmentName`       | yes      | 1–150 chars                                                                                |
| `description`          | no       | 0–500 chars; blank = no change (UPSERT) / empty (CREATE); `__CLEAR__` explicitly clears it |
| `parentDepartmentCode` | no       | blank = no change / top-level; `__NONE__` explicitly makes it top-level                    |
| `color`                | no       | hex, e.g. `#16a34a`; `__CLEAR__` clears it                                                 |
| `status`               | no       | `ACTIVE` or `INACTIVE`                                                                     |

### Position (`position-import-template.csv`)

| Column                       | Required                    | Notes                                                                                                                                                                        |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `positionCode`               | yes                         | 2–30 chars, matching key                                                                                                                                                     |
| `positionTitle`              | yes                         | 1–150 chars                                                                                                                                                                  |
| `description`                | no                          | 0–500 chars; `__CLEAR__` clears it                                                                                                                                           |
| `departmentCode`             | yes                         | must already exist — Position import never creates departments                                                                                                               |
| `jobGradeCode`               | no                          | must already exist; `__NONE__` clears it                                                                                                                                     |
| `primaryManagerPositionCode` | required for a new position | the manager's code (may appear later in the same file), or `__ROOT__` for the one company root; blank means "no change" and is only valid when updating an existing position |
| `status`                     | no                          | `ACTIVE` or `INACTIVE` only — see §7                                                                                                                                         |
| `location`                   | no                          | 0–100 chars; `__CLEAR__` clears it                                                                                                                                           |

### Employee (`employee-import-template.csv`)

| Column                        | Required | Notes                                                                      |
| ----------------------------- | -------- | -------------------------------------------------------------------------- |
| `employeeCode`                | yes      | 2–30 chars, matching key                                                   |
| `firstName` / `lastName`      | yes      | 1–100 chars each                                                           |
| `preferredName`               | no       | 0–100 chars; `__CLEAR__` clears it                                         |
| `workEmail`                   | no       | must be unique in the company; `__CLEAR__` clears it                       |
| `employmentStatus`            | no       | `ACTIVE`, `TRANSFERRED`, or `TERMINATED` — a bare status flip only, see §7 |
| `joiningDate` / `leavingDate` | no       | `YYYY-MM-DD`; `__CLEAR__` clears either                                    |

Never accepts a manager, department, organizational level, job grade, role, or any other field not listed above — see §8.

### Position Assignment (`assignment-import-template.csv`)

| Column                          | Required                | Notes                                              |
| ------------------------------- | ----------------------- | -------------------------------------------------- |
| `operation`                     | yes                     | `ASSIGN`, `TRANSFER`, or `END_ASSIGNMENT` — see §5 |
| `employeeCode` / `positionCode` | yes                     | both must already exist                            |
| `effectiveDate`                 | for `ASSIGN`/`TRANSFER` | `YYYY-MM-DD`; leave blank for `END_ASSIGNMENT`     |
| `endDate`                       | for `END_ASSIGNMENT`    | `YYYY-MM-DD`; leave blank for `ASSIGN`/`TRANSFER`  |

## 5. Assignment operations

- **`ASSIGN`** — creates a new open-ended primary assignment. The employee must not currently have an open assignment; the position must not currently have an open occupant.
- **`TRANSFER`** — ends the employee's current open assignment and starts a new one on the named position, both dated `effectiveDate`. The employee must currently have an open assignment (use `ASSIGN` for a first hire).
- **`END_ASSIGNMENT`** — ends the employee's currently open assignment on the named position as of `endDate`. The named position must match the employee's actual open assignment.
- **`TERMINATE_EMPLOYEE` is not supported.** It would combine an employment-status change with ending an assignment in one CSV operation — exactly the kind of compound mutation most likely to silently corrupt data at bulk scale. End the assignment via `END_ASSIGNMENT`, then change employment status through the app (or via an Employee import row) as two separate, auditable steps.

Rows for the same employee or position are applied in **effective-date order**, not file-row order, so an `ASSIGN` earlier in the timeline is always applied before a later `TRANSFER` for the same employee, regardless of which row appears first in the file.

## 6. CREATE_ONLY vs. UPSERT

- **CREATE_ONLY** — every row must be a genuinely new record; a row matching an existing code is rejected (`CREATE_ONLY_CONFLICT`), never silently skipped or silently applied as an update.
- **UPSERT** — a row matching an existing code updates it; a row with no match creates it.
- **Assignment import has no mode selector** — it uses the explicit `operation` column instead, since "create or update" doesn't map cleanly onto assignment operations.

## 7. What import can never do

- **Set `organizationalLevel` directly.** Always system-computed. A CSV column of this name is rejected outright (a blocking file-level error), never silently ignored.
- **Set occupancy/vacancy directly.** Derived from assignments, never stored.
- **Create a `PLANNED` position.** No existing service path can produce one — manual entry can't either. Import mirrors exactly what a manual HR user can do (create `ACTIVE`, optionally archive to `INACTIVE`).
- **Set an employee's manager, department, organizational level, or job grade.** Those are Position/Assignment concerns; `Employee` has no such field.
- **Import an application role, SSO identity, password, or any authentication field.** Employee and application-user identity are separate concepts in this app; import never touches the latter.
- **Import salary/compensation.** Not a field this app models anywhere.
- **Hard-delete anything.** Import only creates and updates. There is no deletion mode.
- **Silently erase data via a blank cell.** A blank optional-field cell always means "no change" during UPSERT (or "empty" on CREATE) — never an implicit clear. Use `__CLEAR__` to explicitly clear a field, `__NONE__` to explicitly remove an optional parent/reference, or `__ROOT__` to explicitly make a position the company root.

## 8. Validation stages

1. **File validation** — type, size, encoding, row count, column count, required/duplicate headers.
2. **Row schema validation** — required fields, formats, lengths, statuses, dates, sentinels.
3. **In-file validation** — duplicate codes within the file, self-references, and a **combined-state cycle check across the whole proposed graph** (file rows plus every existing record they touch) — not just one row's own parent/manager, since two individually-valid changes can still form a cycle together. Row order never matters: a manager or parent appearing later in the file resolves correctly.
4. **Database-reference validation** — does a referenced department/job-grade/manager/employee/position actually exist; is a CREATE_ONLY row's code already taken.
5. **Combined-state validation** — a second potential root position, an employee already holding an open assignment elsewhere, a position already occupied — checked across the whole file plus current database state, not row-by-row in isolation.
6. **Change-plan generation** — every row is classified `CREATE`, `UPDATE`, `UNCHANGED`, or `ERROR`. Nothing is written to the database during any of this — see §9.

## 9. Errors vs. warnings

- **Errors** block execution entirely. A file with even one error commits nothing (Critical Safety Principle 3) — there is no "commit only the valid rows" mode; correct the file and re-upload.
- **Warnings** (currently: an unrecognized column that will be ignored) do not block, but require explicit acknowledgement (a checkbox) before the "Confirm import" button is enabled.
- Every issue carries a stable `code` (`REQUIRED_FIELD`, `DUPLICATE_IN_FILE`, `HIERARCHY_CYCLE`, `SECOND_ROOT`, `ASSIGNMENT_OVERLAP`, etc. — see `lib/domain/import/types.ts`'s `IMPORT_ERROR_CODES`), a `field`, a `rowNumber` (`0` for a file-level issue not attributable to one row), and a pre-formatted safe message — never a raw database/ORM error.

## 10. Preview

Before confirming, review: total rows, create/update/unchanged/error/warning counts, and — for every `UPDATE` row — a field-level diff (current value → proposed value). A row with unresolved errors is clearly marked; execution stays disabled the entire time any error exists.

## 11. Execution, transactions, and rollback

Confirming a job moves it to `READY_TO_EXECUTE`. Executing it:

1. Re-parses and re-validates the original file **fresh, inside the same database transaction** as every write — never trusting the earlier preview as final authorization. If anything about the referenced data changed since validation (someone else created a conflicting record, for instance), the whole batch is aborted before any row is applied, and the job returns to `VALIDATION_FAILED` with fresh issues explaining what changed.
2. Applies every valid row in **dependency order** (a department/position whose parent/manager is also being created in this file is created after its parent, regardless of file row order; assignment operations apply in effective-date order). New (CREATE) department/position/employee rows are applied via a bulk, layered write path (Phase 13.1) that computes each level with the exact same domain functions `hierarchy.service.ts` itself uses — never a parallel, independently-fallible formula; UPDATE rows continue to go through the same `department.service.ts` / `hierarchy.service.ts` / `employee.service.ts` / `assignment.service.ts` functions manual entry uses.
3. Commits all-or-nothing. An unexpected failure partway through — a genuine transient error, not a validation gap — rolls back every row in the batch, not just the one that failed.

**Performance (Phase 13.1):** a 1,000-row import completes in roughly 1 second, and a 5,000-row import in roughly 3 seconds, in normal conditions — both comfortably inside the supported ~2,000-row target. This is a large improvement over an earlier release-hardening finding (DEF-009) in which large imports were unacceptably slow; see `docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md` for the full before/after measurements.

**Known limitation — cannot atomically "swap" the root position in one file.** A single import cannot both promote a new position to root AND demote the current root under it in the same file — the new root is necessarily created/moved before the old root's demotion is applied, which the database's one-root-per-company rule correctly rejects (see DEF-011 in `docs/DEFECT_REGISTER.md`). To reorganize the very top of the chart, either use the Positions page's "Reports To" control directly for the two positions involved, or import in two passes (first move the old root under a temporary interim manager, then import again to place the new root and finish the reassignment).

## 12. Idempotency

- Re-executing an already-`COMPLETED` job is a safe no-op — it returns the existing result without re-applying anything.
- A concurrent second execution request for the same job serializes behind the first (a row lock on the job itself) rather than racing it.
- Re-uploading the exact same file produces a new job with the same `UPSERT`/`CREATE_ONLY` semantics as any other upload — a genuinely identical re-upload of already-imported data resolves every row to `UNCHANGED`, not a duplicate.

## 13. Retention and privacy

- An uploaded file's raw bytes are kept only until the job reaches a final state (`COMPLETED`, `FAILED`, `VALIDATION_FAILED`, `CANCELLED`, or `EXPIRED`), then cleared. A job past its 7-day retention window is treated as `EXPIRED` on the next request that touches it.
- Only a SHA-256 checksum of the file is kept permanently (for duplicate-upload detection), never the file content itself, once a job is finalized.
- Import jobs are company-scoped exactly like every other record in this app — a job belongs to one company, and no action ever accepts a company id from anywhere but the authenticated session.
- The downloadable error report sanitizes every value against spreadsheet formula injection (a leading `=`, `+`, `-`, `@`, or tab is prefixed with a safe quote) before writing it to CSV.

## 14. Troubleshooting

| Symptom                                                            | Likely cause                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Missing required column(s)" on a file that looks fine             | Check the delimiter — only comma is supported; a semicolon-delimited file parses as one unrecognized column.                                                                     |
| A position/department "doesn't exist" but it's clearly in the file | Check row order isn't the issue (it shouldn't be — resolution considers the whole file) and that the code matches exactly (codes are case-insensitive but must otherwise match). |
| "This would create a second root position"                         | Only one position per company may have no manager. Check whether an existing root already exists, or whether two rows in the file both use `__ROOT__`/leave the manager blank.   |
| Confirm button stays disabled                                      | If `warningRows > 0`, the acknowledgement checkbox must be checked first.                                                                                                        |
| Execute button never appears                                       | The job must be confirmed (`READY_TO_EXECUTE`) first — validation alone doesn't unlock execution.                                                                                |
| A field I expected to update didn't change                         | A blank cell means "no change" in UPSERT mode — use `__CLEAR__` to explicitly clear it.                                                                                          |

## 15. Out of scope (Phase 10)

Scheduled/automatic recurring import, direct external-system sync, PDF/image export, drag-and-drop hierarchy editing, dotted-line reporting, historical snapshots, full audit-log UI, `TERMINATE_EMPLOYEE` via import (§5). See `docs/phase-reports/PHASE_10_CSV_IMPORT.md` for the complete list and the explicit stop instruction it was built against.
