import { findCycleInGraph } from "@/lib/domain/hierarchy";
import { normalizeCode } from "@/lib/domain/normalize";

import type { ParsedCsvFile } from "./csv";
import { interpretFieldValue, isFormulaInjectionRisk } from "./csv";
import {
  checkColumns,
  countAffectedUnits,
  IMPORT_ERROR_CODES,
  resolveFieldForWrite,
  type ImportMode,
  type ResolvedField,
  type RowIssue,
  type RowPlanEntry,
  type ValidationOutcome,
} from "./types";

export const POSITION_REQUIRED_COLUMNS = [
  "positionCode",
  "positionTitle",
  "departmentCode",
] as const;
export const POSITION_ALLOWED_COLUMNS = [
  "positionCode",
  "positionTitle",
  "description",
  "departmentCode",
  "jobGradeCode",
  "primaryManagerPositionCode",
  "status",
  "location",
] as const;

/**
 * PLANNED is deliberately excluded: no existing service path
 * (`lib/services/hierarchy.service.ts`) can create a PLANNED position —
 * `createPosition` always defaults to ACTIVE, and there is no manual UI
 * path to PLANNED either. Import intentionally mirrors exactly what a
 * manual HR user can already do (create as ACTIVE, optionally archive to
 * INACTIVE) rather than inventing a new service capability just for CSV
 * import — see docs/DECISIONS.md's Phase 10 assumption.
 */
const POSITION_STATUSES = ["ACTIVE", "INACTIVE"] as const;
const CODE_MIN = 2;
const CODE_MAX = 30;
const TITLE_MAX = 150;
const DESCRIPTION_MAX = 500;
const LOCATION_MAX = 100;

export interface ExistingPositionSnapshot {
  id: string;
  code: string;
  title: string;
  description: string | null;
  location: string | null;
  departmentCode: string;
  jobGradeCode: string | null;
  /** Normalized code of the manager position, or null for the root. */
  reportsToCode: string | null;
  status: "ACTIVE" | "INACTIVE";
}

export interface ExistingDepartmentCodeLookup {
  code: string;
}
export interface ExistingJobGradeCodeLookup {
  code: string;
}

export interface NormalizedPositionRow {
  code: string;
  existingId: string | null;
  title: string;
  description: ResolvedField<string>;
  location: ResolvedField<string>;
  departmentCode: string;
  jobGradeCode: ResolvedField<string>;
  /** "value" = report to this code; a resolved null means root. */
  reportsToCode: ResolvedField<string>;
  status: "ACTIVE" | "INACTIVE" | null;
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

interface RowDraft {
  rowNumber: number;
  code: string;
  hasError: boolean;
  normalized: NormalizedPositionRow | null;
}

export function validatePositionRows(
  parsed: ParsedCsvFile,
  mode: ImportMode,
  existing: readonly ExistingPositionSnapshot[],
  existingDepartments: readonly ExistingDepartmentCodeLookup[],
  existingJobGrades: readonly ExistingJobGradeCodeLookup[]
): ValidationOutcome<NormalizedPositionRow> {
  const issues: RowIssue[] = [...checkColumns(parsed.headers, POSITION_ALLOWED_COLUMNS)];
  const existingByCode = new Map(existing.map((p) => [p.code, p]));
  const departmentCodes = new Set(existingDepartments.map((d) => d.code));
  const jobGradeCodes = new Set(existingJobGrades.map((g) => g.code));
  const drafts: RowDraft[] = [];
  const codeOccurrences = new Map<string, number[]>();

  for (const row of parsed.rows) {
    const rowIssues: RowIssue[] = [];
    const codeRaw = row.values.positionCode ?? "";
    const titleRaw = row.values.positionTitle ?? "";
    const departmentCodeRaw = row.values.departmentCode ?? "";

    if (codeRaw.trim() === "") rowIssues.push(requiredFieldIssue(row.rowNumber, "positionCode"));
    if (titleRaw.trim() === "") rowIssues.push(requiredFieldIssue(row.rowNumber, "positionTitle"));
    if (departmentCodeRaw.trim() === "")
      rowIssues.push(requiredFieldIssue(row.rowNumber, "departmentCode"));

    for (const [field, raw] of Object.entries({
      positionTitle: titleRaw,
      description: row.values.description ?? "",
      location: row.values.location ?? "",
      departmentCode: departmentCodeRaw,
      jobGradeCode: row.values.jobGradeCode ?? "",
      primaryManagerPositionCode: row.values.primaryManagerPositionCode ?? "",
    })) {
      if (raw.trim() !== "" && isFormulaInjectionRisk(raw.trim())) {
        rowIssues.push(
          issue(
            row.rowNumber,
            field,
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_FORMAT,
            `${field} cannot begin with =, +, -, or @ (formula-injection risk).`
          )
        );
      }
    }

    const trimmedCode = codeRaw.trim();
    if (
      trimmedCode.length > 0 &&
      (trimmedCode.length < CODE_MIN || trimmedCode.length > CODE_MAX)
    ) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "positionCode",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          `positionCode must be ${CODE_MIN}-${CODE_MAX} characters.`
        )
      );
    }
    if (titleRaw.trim().length > TITLE_MAX) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "positionTitle",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          `positionTitle must be ${TITLE_MAX} characters or fewer.`
        )
      );
    }

    const departmentCode = normalizeCode(departmentCodeRaw);
    if (departmentCodeRaw.trim().length > 0 && !departmentCodes.has(departmentCode)) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "departmentCode",
          "ERROR",
          IMPORT_ERROR_CODES.UNKNOWN_REFERENCE,
          `departmentCode "${departmentCode}" does not exist in this company.`
        )
      );
    }

    const descriptionIntentRaw = interpretFieldValue(row.values.description ?? "");
    let descriptionIntent: ResolvedField<string> = { kind: "keep" };
    if (descriptionIntentRaw.kind === "clear") descriptionIntent = { kind: "clear" };
    else if (descriptionIntentRaw.kind === "value") {
      if (descriptionIntentRaw.value.length > DESCRIPTION_MAX) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "description",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_FORMAT,
            `description must be ${DESCRIPTION_MAX} characters or fewer.`
          )
        );
      }
      descriptionIntent = { kind: "value", value: descriptionIntentRaw.value };
    } else if (descriptionIntentRaw.kind === "none" || descriptionIntentRaw.kind === "root") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "description",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "description does not support that sentinel."
        )
      );
    }

    const locationIntentRaw = interpretFieldValue(row.values.location ?? "");
    let locationIntent: ResolvedField<string> = { kind: "keep" };
    if (locationIntentRaw.kind === "clear") locationIntent = { kind: "clear" };
    else if (locationIntentRaw.kind === "value") {
      if (locationIntentRaw.value.length > LOCATION_MAX) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "location",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_FORMAT,
            `location must be ${LOCATION_MAX} characters or fewer.`
          )
        );
      }
      locationIntent = { kind: "value", value: locationIntentRaw.value };
    } else if (locationIntentRaw.kind === "none" || locationIntentRaw.kind === "root") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "location",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "location does not support that sentinel."
        )
      );
    }

    const jobGradeIntentRaw = interpretFieldValue(row.values.jobGradeCode ?? "");
    let jobGradeIntent: ResolvedField<string> = { kind: "keep" };
    if (jobGradeIntentRaw.kind === "clear" || jobGradeIntentRaw.kind === "none") {
      jobGradeIntent = { kind: "clear" };
    } else if (jobGradeIntentRaw.kind === "value") {
      const normalizedGrade = normalizeCode(jobGradeIntentRaw.value);
      if (!jobGradeCodes.has(normalizedGrade)) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "jobGradeCode",
            "ERROR",
            IMPORT_ERROR_CODES.UNKNOWN_REFERENCE,
            `jobGradeCode "${normalizedGrade}" does not exist in this company.`
          )
        );
      }
      jobGradeIntent = { kind: "value", value: normalizedGrade };
    } else if (jobGradeIntentRaw.kind === "root") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "jobGradeCode",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "jobGradeCode does not support __ROOT__ — use __NONE__ to clear it."
        )
      );
    }

    const reportsToIntentRaw = interpretFieldValue(row.values.primaryManagerPositionCode ?? "");
    let reportsToIntent: ResolvedField<string> = { kind: "keep" };
    if (reportsToIntentRaw.kind === "root") {
      reportsToIntent = { kind: "clear" };
    } else if (reportsToIntentRaw.kind === "none") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "primaryManagerPositionCode",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "primaryManagerPositionCode does not support __NONE__ — use __ROOT__ to make this position the root."
        )
      );
    } else if (reportsToIntentRaw.kind === "clear") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "primaryManagerPositionCode",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "primaryManagerPositionCode does not support __CLEAR__ — use __ROOT__ to make this position the root."
        )
      );
    } else if (reportsToIntentRaw.kind === "value") {
      reportsToIntent = { kind: "value", value: normalizeCode(reportsToIntentRaw.value) };
    }

    if (
      reportsToIntent.kind === "value" &&
      trimmedCode.length > 0 &&
      reportsToIntent.value === normalizeCode(trimmedCode)
    ) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "primaryManagerPositionCode",
          "ERROR",
          IMPORT_ERROR_CODES.SELF_REFERENCE,
          "A position cannot report to itself."
        )
      );
    }

    let status: "ACTIVE" | "INACTIVE" | null = null;
    const statusRaw = (row.values.status ?? "").trim();
    if (statusRaw.length > 0) {
      const upper = statusRaw.toUpperCase();
      if (upper === "PLANNED") {
        rowIssues.push(
          issue(
            row.rowNumber,
            "status",
            "ERROR",
            IMPORT_ERROR_CODES.UNSUPPORTED_OPERATION,
            "status PLANNED is not supported via import — create the position and set it up manually if a planned position is needed."
          )
        );
      } else if (!(POSITION_STATUSES as readonly string[]).includes(upper)) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "status",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_STATUS,
            `status must be one of: ${POSITION_STATUSES.join(", ")}.`
          )
        );
      } else {
        status = upper as "ACTIVE" | "INACTIVE";
      }
    }

    issues.push(...rowIssues);
    const hasError = rowIssues.some((i) => i.severity === "ERROR");
    const code =
      trimmedCode.length > 0 ? normalizeCode(trimmedCode) : `__invalid_row_${row.rowNumber}`;

    if (!codeOccurrences.has(code)) codeOccurrences.set(code, []);
    codeOccurrences.get(code)!.push(row.rowNumber);

    drafts.push({
      rowNumber: row.rowNumber,
      code,
      hasError,
      normalized: hasError
        ? null
        : {
            code,
            existingId: existingByCode.get(code)?.id ?? null,
            title: titleRaw.trim(),
            description: descriptionIntent,
            location: locationIntent,
            departmentCode,
            jobGradeCode: jobGradeIntent,
            reportsToCode: reportsToIntent,
            status,
          },
    });
  }

  for (const [code, rowNumbers] of codeOccurrences) {
    if (rowNumbers.length <= 1 || code.startsWith("__invalid_row_")) continue;
    for (const rowNumber of rowNumbers) {
      issues.push(
        issue(
          rowNumber,
          "positionCode",
          "ERROR",
          IMPORT_ERROR_CODES.DUPLICATE_IN_FILE,
          `positionCode "${code}" appears more than once in this file.`
        )
      );
      const draft = drafts.find((d) => d.rowNumber === rowNumber);
      if (draft) {
        draft.hasError = true;
        draft.normalized = null;
      }
    }
  }

  const fileCodesSet = new Set(drafts.filter((d) => !d.hasError).map((d) => d.code));
  for (const draft of drafts) {
    if (draft.hasError || !draft.normalized) continue;
    const { reportsToCode } = draft.normalized;
    if (reportsToCode.kind === "value") {
      const resolvesInFile = fileCodesSet.has(reportsToCode.value);
      const resolvesInDb = existingByCode.has(reportsToCode.value);
      if (!resolvesInFile && !resolvesInDb) {
        issues.push(
          issue(
            draft.rowNumber,
            "primaryManagerPositionCode",
            "ERROR",
            IMPORT_ERROR_CODES.UNKNOWN_REFERENCE,
            `primaryManagerPositionCode "${reportsToCode.value}" does not match any position in this file or company.`
          )
        );
        draft.hasError = true;
        draft.normalized = null;
        continue;
      }
    }
    if (mode === "CREATE_ONLY" && existingByCode.has(draft.code)) {
      issues.push(
        issue(
          draft.rowNumber,
          "positionCode",
          "ERROR",
          IMPORT_ERROR_CODES.CREATE_ONLY_CONFLICT,
          `positionCode "${draft.code}" already exists — CREATE_ONLY mode cannot update it.`
        )
      );
      draft.hasError = true;
      draft.normalized = null;
    }
  }

  // A CREATE row (no existing match) with reportsToCode still "keep"
  // (i.e. the file left the column blank) has nothing to default to —
  // unlike an UPDATE, there is no current manager to keep. Require the
  // author to be explicit: a real code, or __ROOT__.
  for (const draft of drafts) {
    if (draft.hasError || !draft.normalized) continue;
    const isNewRow = !existingByCode.has(draft.code);
    if (isNewRow && draft.normalized.reportsToCode.kind === "keep") {
      issues.push(
        issue(
          draft.rowNumber,
          "primaryManagerPositionCode",
          "ERROR",
          IMPORT_ERROR_CODES.REQUIRED_FIELD,
          "primaryManagerPositionCode is required for a new position — provide a manager's code, or __ROOT__ for the one company root."
        )
      );
      draft.hasError = true;
      draft.normalized = null;
    }
  }

  // Combined-state cycle detection, keyed by stable positionCode.
  const parentOf = new Map<string, string | null>();
  for (const position of existing) parentOf.set(position.code, position.reportsToCode);
  for (const draft of drafts) {
    if (draft.hasError || !draft.normalized) continue;
    const currentParent = existingByCode.get(draft.code)?.reportsToCode ?? null;
    const resolvedParent = resolveFieldForWrite(draft.normalized.reportsToCode, currentParent);
    parentOf.set(draft.code, resolvedParent);
  }
  const cycle = findCycleInGraph(parentOf);
  if (cycle) {
    const cycleSet = new Set(cycle);
    for (const draft of drafts) {
      if (draft.hasError || !cycleSet.has(draft.code)) continue;
      issues.push(
        issue(
          draft.rowNumber,
          "primaryManagerPositionCode",
          "ERROR",
          IMPORT_ERROR_CODES.HIERARCHY_CYCLE,
          `This position is part of a reporting cycle: ${cycle.join(" -> ")} -> ${cycle[0]}.`
        )
      );
      draft.hasError = true;
      draft.normalized = null;
    }
  }

  // Second-root detection across the combined graph.
  const rootCodesInCombinedGraph = [...parentOf.entries()]
    .filter(([, parent]) => parent === null)
    .map(([code]) => code);
  if (rootCodesInCombinedGraph.length > 1) {
    for (const draft of drafts) {
      if (draft.hasError || !draft.normalized) continue;
      if (draft.normalized.reportsToCode.kind !== "clear") continue;
      const currentParent = existingByCode.get(draft.code)?.reportsToCode ?? null;
      const resolvesToRoot =
        resolveFieldForWrite(draft.normalized.reportsToCode, currentParent) === null;
      if (!resolvesToRoot) continue;
      issues.push(
        issue(
          draft.rowNumber,
          "primaryManagerPositionCode",
          "ERROR",
          IMPORT_ERROR_CODES.SECOND_ROOT,
          `This would create a second root position — only one position per company may have no manager. Existing/proposed roots: ${rootCodesInCombinedGraph.join(", ")}.`
        )
      );
      draft.hasError = true;
      draft.normalized = null;
    }
  }

  const rows: RowPlanEntry<NormalizedPositionRow>[] = drafts.map((draft) => {
    if (draft.hasError || !draft.normalized) {
      return {
        rowNumber: draft.rowNumber,
        matchingCode: draft.code,
        action: "ERROR",
        diffs: [],
        normalized: null,
      };
    }
    const existingRow = existingByCode.get(draft.code) ?? null;
    if (!existingRow) {
      return {
        rowNumber: draft.rowNumber,
        matchingCode: draft.code,
        action: "CREATE",
        diffs: [],
        normalized: draft.normalized,
      };
    }
    const proposedTitle = draft.normalized.title;
    const proposedDescription = resolveFieldForWrite(
      draft.normalized.description,
      existingRow.description
    );
    const proposedLocation = resolveFieldForWrite(draft.normalized.location, existingRow.location);
    const proposedDepartment = draft.normalized.departmentCode;
    const proposedJobGrade = resolveFieldForWrite(
      draft.normalized.jobGradeCode,
      existingRow.jobGradeCode
    );
    const proposedReportsTo = resolveFieldForWrite(
      draft.normalized.reportsToCode,
      existingRow.reportsToCode
    );
    const proposedStatus = draft.normalized.status ?? existingRow.status;

    const diffs = [
      { field: "title", from: existingRow.title, to: proposedTitle },
      { field: "description", from: existingRow.description, to: proposedDescription },
      { field: "location", from: existingRow.location, to: proposedLocation },
      { field: "departmentCode", from: existingRow.departmentCode, to: proposedDepartment },
      { field: "jobGradeCode", from: existingRow.jobGradeCode, to: proposedJobGrade },
      {
        field: "primaryManagerPositionCode",
        from: existingRow.reportsToCode,
        to: proposedReportsTo,
      },
      { field: "status", from: existingRow.status, to: proposedStatus },
    ]
      .filter((d) => d.from !== d.to)
      .map((d) => ({ field: d.field, currentValue: d.from, proposedValue: d.to }));

    return {
      rowNumber: draft.rowNumber,
      matchingCode: draft.code,
      action: diffs.length === 0 ? "UNCHANGED" : "UPDATE",
      diffs,
      normalized: draft.normalized,
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
