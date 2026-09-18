import { dateRangesOverlap, type DateRange } from "@/lib/domain/assignment";
import { normalizeCode } from "@/lib/domain/normalize";

import type { ParsedCsvFile } from "./csv";
import { interpretFieldValue } from "./csv";
import {
  checkColumns,
  countAffectedUnits,
  IMPORT_ERROR_CODES,
  type RowIssue,
  type RowPlanEntry,
  type ValidationOutcome,
} from "./types";

export const ASSIGNMENT_REQUIRED_COLUMNS = [
  "operation",
  "employeeCode",
  "positionCode",
  "effectiveDate",
] as const;
export const ASSIGNMENT_ALLOWED_COLUMNS = [
  "operation",
  "employeeCode",
  "positionCode",
  "effectiveDate",
  "endDate",
] as const;

/**
 * TERMINATE_EMPLOYEE is deliberately excluded from Phase 10 — it combines
 * two side effects (an employmentStatus flip AND ending the employee's
 * active assignment) in one CSV operation, exactly the kind of compound
 * mutation most likely to silently corrupt data at bulk-import scale if
 * the two effects ever disagree with what the operator intended. No
 * approval for it exists on file (the Phase 10 prompt itself makes it
 * conditional on explicit approval), so it stays out — see
 * docs/DECISIONS.md's Phase 10 assumption. Any row using it is a clear,
 * documented UNSUPPORTED_OPERATION error, not a silent no-op.
 */
const SUPPORTED_OPERATIONS = ["ASSIGN", "TRANSFER", "END_ASSIGNMENT"] as const;
type AssignmentOperation = (typeof SUPPORTED_OPERATIONS)[number];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ExistingEmployeeLookup {
  code: string;
  employmentStatus: "ACTIVE" | "TRANSFERRED" | "TERMINATED";
}
export interface ExistingPositionLookup {
  code: string;
  status: "PLANNED" | "ACTIVE" | "INACTIVE";
}
export interface ExistingAssignmentSnapshot {
  employeeCode: string;
  positionCode: string;
  startDate: string;
  endDate: string | null;
}

export interface NormalizedAssignmentRow {
  operation: AssignmentOperation;
  employeeCode: string;
  positionCode: string;
  effectiveDate: string | null;
  endDate: string | null;
}

function issue(
  rowNumber: number,
  field: string | null,
  severity: "WARNING" | "ERROR",
  code: string,
  safeMessage: string
): RowIssue {
  return { rowNumber, field, severity, code, safeMessage };
}

function requiredFieldIssue(rowNumber: number, field: string): RowIssue {
  return issue(
    rowNumber,
    field,
    "ERROR",
    IMPORT_ERROR_CODES.REQUIRED_FIELD,
    `${field} is required.`
  );
}

function parseStrictDate(raw: string): string | null {
  if (!DATE_PATTERN.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  const [year, month, day] = raw.split("-").map(Number);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return raw;
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

interface RowDraft {
  rowNumber: number;
  hasError: boolean;
  operation: AssignmentOperation | null;
  employeeCode: string;
  positionCode: string;
  effectiveDate: string | null;
  endDate: string | null;
  /**
   * For a TRANSFER row only: the position code the employee is being
   * moved OFF of, resolved by `simulateEmployeeTimeline` from either the
   * employee's existing open DB assignment or an earlier file row for
   * the same employee — never a CSV column, since TRANSFER doesn't name
   * its own source position. Needed so the position-keyed simulation
   * knows that position becomes vacant, which a TRANSFER row would
   * otherwise never signal at all.
   */
  fromPositionCode: string | null;
}

/**
 * Validates a Position Assignment CSV. Every row is one operation
 * (ASSIGN/TRANSFER/END_ASSIGNMENT) against an employee+position pair
 * that must already exist — this import type never creates employees or
 * positions, and never touches hierarchy (docs/CSV_IMPORT_GUIDE.md).
 *
 * Combined-state validation simulates each employee's and each
 * position's assignment timeline (existing DB state plus every file row
 * that touches them, processed in effective-date order) to catch overlaps
 * that only exist once the whole file — not one row in isolation — is
 * considered, mirroring the same principle Position/Department import
 * apply to hierarchy cycles.
 */
export function validateAssignmentRows(
  parsed: ParsedCsvFile,
  employees: readonly ExistingEmployeeLookup[],
  positions: readonly ExistingPositionLookup[],
  assignments: readonly ExistingAssignmentSnapshot[]
): ValidationOutcome<NormalizedAssignmentRow> {
  const issues: RowIssue[] = [...checkColumns(parsed.headers, ASSIGNMENT_ALLOWED_COLUMNS)];
  const employeeByCode = new Map(employees.map((e) => [e.code, e]));
  const positionByCode = new Map(positions.map((p) => [p.code, p]));
  const drafts: RowDraft[] = [];

  for (const row of parsed.rows) {
    const rowIssues: RowIssue[] = [];
    const operationRaw = (row.values.operation ?? "").trim().toUpperCase();
    const employeeCodeRaw = row.values.employeeCode ?? "";
    const positionCodeRaw = row.values.positionCode ?? "";

    if (operationRaw === "") rowIssues.push(requiredFieldIssue(row.rowNumber, "operation"));
    if (employeeCodeRaw.trim() === "")
      rowIssues.push(requiredFieldIssue(row.rowNumber, "employeeCode"));
    if (positionCodeRaw.trim() === "")
      rowIssues.push(requiredFieldIssue(row.rowNumber, "positionCode"));

    let operation: AssignmentOperation | null = null;
    if (operationRaw === "TERMINATE_EMPLOYEE") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "operation",
          "ERROR",
          IMPORT_ERROR_CODES.UNSUPPORTED_OPERATION,
          "TERMINATE_EMPLOYEE is not supported via import — end the assignment and change employment status through the app instead."
        )
      );
    } else if (
      operationRaw !== "" &&
      !(SUPPORTED_OPERATIONS as readonly string[]).includes(operationRaw)
    ) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "operation",
          "ERROR",
          IMPORT_ERROR_CODES.UNKNOWN_OPERATION,
          `operation must be one of: ${SUPPORTED_OPERATIONS.join(", ")}.`
        )
      );
    } else if (operationRaw !== "") {
      operation = operationRaw as AssignmentOperation;
    }

    const employeeCode = normalizeCode(employeeCodeRaw);
    if (employeeCodeRaw.trim().length > 0 && !employeeByCode.has(employeeCode)) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "employeeCode",
          "ERROR",
          IMPORT_ERROR_CODES.UNKNOWN_REFERENCE,
          `employeeCode "${employeeCode}" does not exist in this company.`
        )
      );
    }
    const positionCode = normalizeCode(positionCodeRaw);
    if (positionCodeRaw.trim().length > 0 && !positionByCode.has(positionCode)) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "positionCode",
          "ERROR",
          IMPORT_ERROR_CODES.UNKNOWN_REFERENCE,
          `positionCode "${positionCode}" does not exist in this company.`
        )
      );
    }

    const effectiveIntent = interpretFieldValue(row.values.effectiveDate ?? "");
    const endIntent = interpretFieldValue(row.values.endDate ?? "");
    let effectiveDate: string | null = null;
    let endDate: string | null = null;

    if (operation === "ASSIGN" || operation === "TRANSFER") {
      if (effectiveIntent.kind !== "value") {
        rowIssues.push(requiredFieldIssue(row.rowNumber, "effectiveDate"));
      } else {
        const parsedDate = parseStrictDate(effectiveIntent.value);
        if (!parsedDate) {
          rowIssues.push(
            issue(
              row.rowNumber,
              "effectiveDate",
              "ERROR",
              IMPORT_ERROR_CODES.INVALID_FORMAT,
              "effectiveDate must be a valid date in YYYY-MM-DD format."
            )
          );
        }
        effectiveDate = parsedDate;
      }
      if (endIntent.kind === "value") {
        rowIssues.push(
          issue(
            row.rowNumber,
            "endDate",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_FORMAT,
            `endDate is not used for ${operation} — leave it blank.`
          )
        );
      }
    } else if (operation === "END_ASSIGNMENT") {
      if (endIntent.kind !== "value") {
        rowIssues.push(requiredFieldIssue(row.rowNumber, "endDate"));
      } else {
        const parsedDate = parseStrictDate(endIntent.value);
        if (!parsedDate) {
          rowIssues.push(
            issue(
              row.rowNumber,
              "endDate",
              "ERROR",
              IMPORT_ERROR_CODES.INVALID_FORMAT,
              "endDate must be a valid date in YYYY-MM-DD format."
            )
          );
        }
        endDate = parsedDate;
      }
      if (effectiveIntent.kind === "value") {
        rowIssues.push(
          issue(
            row.rowNumber,
            "effectiveDate",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_FORMAT,
            "effectiveDate is not used for END_ASSIGNMENT — use endDate instead."
          )
        );
      }
    }

    if (operation === "ASSIGN" || operation === "TRANSFER") {
      const employee = employeeByCode.get(employeeCode);
      if (employee && employee.employmentStatus !== "ACTIVE") {
        rowIssues.push(
          issue(
            row.rowNumber,
            "employeeCode",
            "ERROR",
            IMPORT_ERROR_CODES.UNSAFE_STATUS_CHANGE,
            `employeeCode "${employeeCode}" is not ACTIVE and cannot receive a new assignment.`
          )
        );
      }
      const position = positionByCode.get(positionCode);
      if (position && position.status === "INACTIVE") {
        rowIssues.push(
          issue(
            row.rowNumber,
            "positionCode",
            "ERROR",
            IMPORT_ERROR_CODES.UNSAFE_STATUS_CHANGE,
            `positionCode "${positionCode}" is INACTIVE and cannot accept a new assignment.`
          )
        );
      }
    }

    issues.push(...rowIssues);
    drafts.push({
      rowNumber: row.rowNumber,
      hasError: rowIssues.some((i) => i.severity === "ERROR"),
      operation,
      employeeCode,
      positionCode,
      effectiveDate,
      endDate,
      fromPositionCode: null,
    });
  }

  // Combined-state validation, in two passes. Pass 1 (by employeeCode)
  // also resolves, for every TRANSFER row, which position it vacates
  // (`fromPositionCode`) — never a CSV column, since TRANSFER only names
  // its destination. Pass 2 (by positionCode) needs that to know a
  // TRANSFER's source position becomes vacant, something the row itself
  // never signals under its own positionCode alone.
  const existingOpenByEmployee = new Map<string, { positionCode: string; range: DateRange }>();
  for (const a of assignments) {
    if (a.endDate === null) {
      existingOpenByEmployee.set(a.employeeCode, {
        positionCode: a.positionCode,
        range: { startDate: toDate(a.startDate), endDate: null },
      });
    }
  }
  simulateEmployeeTimeline(drafts, issues, existingOpenByEmployee);

  const existingOpenByPosition = new Map<string, DateRange>();
  for (const a of assignments) {
    if (a.endDate === null) {
      existingOpenByPosition.set(a.positionCode, { startDate: toDate(a.startDate), endDate: null });
    }
  }
  simulatePositionTimeline(drafts, issues, existingOpenByPosition);

  const rows: RowPlanEntry<NormalizedAssignmentRow>[] = drafts.map((draft) => {
    const matchingCode = `${draft.operation ?? "UNKNOWN"}:${draft.employeeCode}:${draft.positionCode}:${draft.effectiveDate ?? draft.endDate ?? ""}`;
    if (draft.hasError || !draft.operation) {
      return {
        rowNumber: draft.rowNumber,
        matchingCode,
        action: "ERROR",
        diffs: [],
        normalized: null,
      };
    }
    return {
      rowNumber: draft.rowNumber,
      matchingCode,
      action: draft.operation === "ASSIGN" ? "CREATE" : "UPDATE",
      diffs: [],
      normalized: {
        operation: draft.operation,
        employeeCode: draft.employeeCode,
        positionCode: draft.positionCode,
        effectiveDate: draft.effectiveDate,
        endDate: draft.endDate,
      },
    };
  });

  const createCount = rows.filter((r) => r.action === "CREATE").length;
  const updateCount = rows.filter((r) => r.action === "UPDATE").length;
  const unchangedCount = rows.filter((r) => r.action === "UNCHANGED").length;
  return {
    totalRows: parsed.rows.length,
    rows,
    issues,
    createCount,
    updateCount,
    unchangedCount,
    errorRowCount: countAffectedUnits(issues, "ERROR"),
    warningRowCount: countAffectedUnits(issues, "WARNING"),
  };
}

function sortByEffectiveOrder(drafts: readonly RowDraft[]): RowDraft[] {
  return [...drafts].sort((a, b) => {
    const dateA = a.effectiveDate ?? a.endDate ?? "";
    const dateB = b.effectiveDate ?? b.endDate ?? "";
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    return a.rowNumber - b.rowNumber;
  });
}

/**
 * Walks each employee's timeline (existing open DB assignment, if any,
 * plus every valid file row referencing them, in effective-date order),
 * flagging EMPLOYEE_ALREADY_ASSIGNED the instant an ASSIGN/TRANSFER would
 * overlap a still-open assignment. For every valid TRANSFER, also records
 * `fromPositionCode` — the position it moves the employee OFF of — so
 * `simulatePositionTimeline` (which only ever sees each row's own
 * `positionCode`, i.e. the destination) knows that source position
 * becomes vacant, which the row itself never states directly.
 */
function simulateEmployeeTimeline(
  drafts: RowDraft[],
  issues: RowIssue[],
  existingOpenByEmployee: ReadonlyMap<string, { positionCode: string; range: DateRange }>
): void {
  const byEmployee = new Map<string, RowDraft[]>();
  for (const draft of drafts) {
    if (draft.hasError || !draft.operation) continue;
    if (!byEmployee.has(draft.employeeCode)) byEmployee.set(draft.employeeCode, []);
    byEmployee.get(draft.employeeCode)!.push(draft);
  }

  for (const [employeeCode, employeeDrafts] of byEmployee) {
    const sorted = sortByEffectiveOrder(employeeDrafts);
    let open = existingOpenByEmployee.get(employeeCode) ?? null;

    for (const draft of sorted) {
      if (draft.operation === "ASSIGN") {
        if (!draft.effectiveDate) continue;
        const candidate: DateRange = { startDate: toDate(draft.effectiveDate), endDate: null };
        if (open && dateRangesOverlap(open.range, candidate)) {
          issues.push(
            issue(
              draft.rowNumber,
              "employeeCode",
              "ERROR",
              IMPORT_ERROR_CODES.EMPLOYEE_ALREADY_ASSIGNED,
              `employeeCode "${employeeCode}" already has an open assignment at this point in the timeline.`
            )
          );
          draft.hasError = true;
          continue;
        }
        open = { positionCode: draft.positionCode, range: candidate };
      } else if (draft.operation === "TRANSFER") {
        // TRANSFER's whole point is to end the CURRENTLY open assignment
        // and replace it — that existing open range is what's being
        // transferred FROM, never itself a conflict. There is nothing to
        // overlap-check here beyond requiring that an open assignment
        // exists at all.
        if (!draft.effectiveDate) continue;
        if (!open) {
          issues.push(
            issue(
              draft.rowNumber,
              "employeeCode",
              "ERROR",
              IMPORT_ERROR_CODES.UNKNOWN_REFERENCE,
              `Cannot TRANSFER "${employeeCode}" — no current open assignment to transfer from. Use ASSIGN instead.`
            )
          );
          draft.hasError = true;
          continue;
        }
        draft.fromPositionCode = open.positionCode;
        // A same-day handoff (new assignment starts the exact day the old
        // one ends) is valid — this replaces `open` outright rather than
        // overlap-checking against it.
        open = {
          positionCode: draft.positionCode,
          range: { startDate: toDate(draft.effectiveDate), endDate: null },
        };
      } else if (draft.operation === "END_ASSIGNMENT") {
        if (!draft.endDate) continue;
        if (!open) {
          issues.push(
            issue(
              draft.rowNumber,
              "employeeCode",
              "ERROR",
              IMPORT_ERROR_CODES.UNKNOWN_REFERENCE,
              `Cannot END_ASSIGNMENT for "${employeeCode}" — there is no open assignment to end.`
            )
          );
          draft.hasError = true;
          continue;
        }
        if (open.positionCode !== draft.positionCode) {
          issues.push(
            issue(
              draft.rowNumber,
              "positionCode",
              "ERROR",
              IMPORT_ERROR_CODES.UNKNOWN_REFERENCE,
              `employeeCode "${employeeCode}"'s open assignment is on "${open.positionCode}", not "${draft.positionCode}".`
            )
          );
          draft.hasError = true;
          continue;
        }
        if (toDate(draft.endDate) < open.range.startDate) {
          issues.push(
            issue(
              draft.rowNumber,
              "endDate",
              "ERROR",
              IMPORT_ERROR_CODES.INVALID_DATE_RANGE,
              "endDate cannot be earlier than the assignment's own startDate."
            )
          );
          draft.hasError = true;
          continue;
        }
        open = null;
      }
    }
  }
}

/**
 * Walks each position's timeline the same way, but a TRANSFER row
 * participates in TWO positions' timelines: it vacates
 * `draft.fromPositionCode` (resolved by `simulateEmployeeTimeline`,
 * always run first) at its effective date, and occupies `draft.positionCode`
 * from that same date — never a plain "open" event on one key alone.
 */
function simulatePositionTimeline(
  drafts: RowDraft[],
  issues: RowIssue[],
  existingOpenByPosition: ReadonlyMap<string, DateRange>
): void {
  const eventsByPosition = new Map<string, { draft: RowDraft; kind: "open" | "close" }[]>();
  const addEvent = (positionCode: string, draft: RowDraft, kind: "open" | "close") => {
    if (!eventsByPosition.has(positionCode)) eventsByPosition.set(positionCode, []);
    eventsByPosition.get(positionCode)!.push({ draft, kind });
  };

  for (const draft of drafts) {
    if (draft.hasError || !draft.operation) continue;
    if (draft.operation === "ASSIGN") {
      addEvent(draft.positionCode, draft, "open");
    } else if (draft.operation === "TRANSFER") {
      if (draft.fromPositionCode) addEvent(draft.fromPositionCode, draft, "close");
      addEvent(draft.positionCode, draft, "open");
    } else if (draft.operation === "END_ASSIGNMENT") {
      addEvent(draft.positionCode, draft, "close");
    }
  }

  for (const [positionCode, events] of eventsByPosition) {
    const sorted = [...events].sort((a, b) => {
      const dateA = a.draft.effectiveDate ?? a.draft.endDate ?? "";
      const dateB = b.draft.effectiveDate ?? b.draft.endDate ?? "";
      if (dateA !== dateB) return dateA < dateB ? -1 : 1;
      return a.draft.rowNumber - b.draft.rowNumber;
    });

    let open: DateRange | null = existingOpenByPosition.get(positionCode) ?? null;

    for (const { draft, kind } of sorted) {
      if (draft.hasError) continue;
      if (kind === "open") {
        const date = draft.effectiveDate;
        if (!date) continue;
        const candidate: DateRange = { startDate: toDate(date), endDate: null };
        if (open && dateRangesOverlap(open, candidate)) {
          issues.push(
            issue(
              draft.rowNumber,
              "positionCode",
              "ERROR",
              IMPORT_ERROR_CODES.POSITION_OCCUPIED,
              `positionCode "${positionCode}" is already occupied at this point in the timeline.`
            )
          );
          draft.hasError = true;
          continue;
        }
        open = candidate;
      } else {
        // A TRANSFER's "close" event on its source position and an
        // END_ASSIGNMENT both just end whatever is currently open there —
        // the employee-timeline pass already confirmed there IS an open
        // assignment to close before recording fromPositionCode, so this
        // never needs its own not-found check.
        const date = draft.effectiveDate ?? draft.endDate;
        open = open && date ? { startDate: open.startDate, endDate: toDate(date) } : null;
      }
    }
  }
}
