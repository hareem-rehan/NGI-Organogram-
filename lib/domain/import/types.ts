/**
 * Shared types for the Phase 10 import pipeline
 * (docs/adr/0007-import-strategy.md). Each entity module
 * (department-import.ts, position-import.ts, employee-import.ts,
 * assignment-import.ts) implements a `validate*Rows` function returning
 * `ValidationOutcome<T>` for its own normalized row shape `T`.
 */

export type ImportEntityType = "DEPARTMENT" | "POSITION" | "EMPLOYEE" | "ASSIGNMENT";
export type ImportMode = "CREATE_ONLY" | "UPSERT";
export type IssueSeverity = "WARNING" | "ERROR";
export type RowAction = "CREATE" | "UPDATE" | "UNCHANGED" | "ERROR";

export interface RowIssue {
  rowNumber: number;
  field: string | null;
  severity: IssueSeverity;
  code: string;
  safeMessage: string;
}

export interface FieldDiff {
  field: string;
  currentValue: string | null;
  proposedValue: string | null;
}

/**
 * One row's fully-validated, normalized proposed change — the only thing
 * `import.service.ts`'s commit step reads. `normalized` is `null` only
 * when `action` is `"ERROR"` and the row could not be normalized at all
 * (e.g. an unresolvable required reference).
 */
export interface RowPlanEntry<T> {
  rowNumber: number;
  matchingCode: string;
  action: RowAction;
  diffs: FieldDiff[];
  normalized: T | null;
}

export interface ValidationOutcome<T> {
  totalRows: number;
  rows: RowPlanEntry<T>[];
  issues: RowIssue[];
  createCount: number;
  updateCount: number;
  unchangedCount: number;
  errorRowCount: number;
  warningRowCount: number;
}

/**
 * Counts the distinct "units" (rows, or file-level concerns) carrying at
 * least one issue of `severity`. A row (rowNumber > 0) with 3 errors
 * still counts once; a file-level issue (rowNumber === 0 — a denylisted
 * or unrecognized column, which is never attributable to one row) counts
 * once per distinct field+code, since it represents its own concern the
 * user must see, not something to fold into a "row" count of zero. This
 * MUST include file-level issues — a file whose only problem is a
 * denylisted column would otherwise silently compute `errorRowCount: 0`
 * and be treated as clean.
 */
export function countAffectedUnits(issues: readonly RowIssue[], severity: IssueSeverity): number {
  const keys = new Set(
    issues
      .filter((issue) => issue.severity === severity)
      .map((issue) =>
        issue.rowNumber > 0 ? `row:${issue.rowNumber}` : `file:${issue.field}:${issue.code}`
      )
  );
  return keys.size;
}

export function emptyOutcome<T>(): ValidationOutcome<T> {
  return {
    totalRows: 0,
    rows: [],
    issues: [],
    createCount: 0,
    updateCount: 0,
    unchangedCount: 0,
    errorRowCount: 0,
    warningRowCount: 0,
  };
}

/** Stable error codes referenced by docs/CSV_IMPORT_GUIDE.md and the downloadable error report. */
export const IMPORT_ERROR_CODES = {
  REQUIRED_FIELD: "REQUIRED_FIELD",
  INVALID_FORMAT: "INVALID_FORMAT",
  INVALID_STATUS: "INVALID_STATUS",
  DUPLICATE_IN_FILE: "DUPLICATE_IN_FILE",
  DUPLICATE_IN_DATABASE: "DUPLICATE_IN_DATABASE",
  UNKNOWN_REFERENCE: "UNKNOWN_REFERENCE",
  CROSS_COMPANY_REFERENCE: "CROSS_COMPANY_REFERENCE",
  SELF_REFERENCE: "SELF_REFERENCE",
  HIERARCHY_CYCLE: "HIERARCHY_CYCLE",
  SECOND_ROOT: "SECOND_ROOT",
  POSITION_OCCUPIED: "POSITION_OCCUPIED",
  EMPLOYEE_ALREADY_ASSIGNED: "EMPLOYEE_ALREADY_ASSIGNED",
  ASSIGNMENT_OVERLAP: "ASSIGNMENT_OVERLAP",
  INVALID_DATE_RANGE: "INVALID_DATE_RANGE",
  STALE_VALIDATION: "STALE_VALIDATION",
  UNSAFE_STATUS_CHANGE: "UNSAFE_STATUS_CHANGE",
  UNSUPPORTED_COLUMN: "UNSUPPORTED_COLUMN",
  UNKNOWN_OPERATION: "UNKNOWN_OPERATION",
  UNSUPPORTED_OPERATION: "UNSUPPORTED_OPERATION",
  CREATE_ONLY_CONFLICT: "CREATE_ONLY_CONFLICT",
  STABLE_CODE_CHANGE: "STABLE_CODE_CHANGE",
} as const;

/**
 * Field names that are always system-computed/derived or otherwise
 * dangerous to accept from ANY CSV, regardless of entity type — present
 * in the file at all is a blocking Stage-1 error, never a silent ignore
 * (docs/NEGATIVE_SCENARIOS.md "Organizational level imported manually" /
 * "Vacancy imported manually" / "Employee role imported" / etc.). Entity
 * modules that have their own additional dangerous fields (e.g. Employee
 * import must also reject `departmentCode`/`managerCode`/`jobGradeCode`,
 * which ARE legitimate columns on Position import) extend this list with
 * their own — see each module's own `*_DENYLISTED_COLUMNS` export.
 */
export const BASE_DENYLISTED_COLUMNS = [
  "organizationalLevel",
  "vacancy",
  "occupancyStatus",
  "role",
  "userRole",
  "ssoId",
  "authProvider",
  "password",
  "salary",
  "compensation",
] as const;

export function findDenylistedColumns(
  headers: readonly string[],
  denylist: readonly string[] = BASE_DENYLISTED_COLUMNS
): string[] {
  const set = new Set<string>(denylist);
  return headers.filter((h) => set.has(h));
}

/**
 * Checks a file's headers against one entity type's known columns.
 * `rowNumber: 0` marks a file-level issue (not attributable to one row).
 * A denylisted column (always system-computed or otherwise dangerous —
 * `organizationalLevel`, `role`, `salary`, etc.) is a blocking ERROR; any
 * other unrecognized column is a non-blocking WARNING and is otherwise
 * ignored during validation (Step 7: "do not accept unexpected columns
 * silently unless documented" — a warning is not silent).
 */
export function checkColumns(
  headers: readonly string[],
  allowedColumns: readonly string[],
  denylist: readonly string[] = BASE_DENYLISTED_COLUMNS
): RowIssue[] {
  const denylisted = findDenylistedColumns(headers, denylist);
  const issues: RowIssue[] = [];
  for (const column of denylisted) {
    issues.push({
      rowNumber: 0,
      field: column,
      severity: "ERROR",
      code: IMPORT_ERROR_CODES.UNSUPPORTED_COLUMN,
      safeMessage: `Column "${column}" cannot be imported — it is always system-calculated or otherwise not importable.`,
    });
  }
  const allowed = new Set(allowedColumns);
  for (const column of headers) {
    if (denylisted.includes(column) || allowed.has(column)) continue;
    issues.push({
      rowNumber: 0,
      field: column,
      severity: "WARNING",
      code: "UNRECOGNIZED_COLUMN",
      safeMessage: `Column "${column}" is not a recognized field for this import type and will be ignored.`,
    });
  }
  return issues;
}

/**
 * Resolves one optional field's proposed intent against its current
 * value (only meaningful for UPDATE — a CREATE row has no current value,
 * so "keep" degrades to null exactly like "clear" would).
 */
export type ResolvedField<T> = { kind: "value"; value: T } | { kind: "clear" } | { kind: "keep" };

export function resolveFieldForWrite<T>(
  resolved: ResolvedField<T>,
  currentValue: T | null
): T | null {
  switch (resolved.kind) {
    case "value":
      return resolved.value;
    case "clear":
      return null;
    case "keep":
      return currentValue;
  }
}
