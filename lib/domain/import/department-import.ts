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

export const DEPARTMENT_REQUIRED_COLUMNS = ["departmentCode", "departmentName"] as const;
export const DEPARTMENT_ALLOWED_COLUMNS = [
  "departmentCode",
  "departmentName",
  "description",
  "parentDepartmentCode",
  "color",
  "status",
] as const;

const DEPARTMENT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const CODE_MIN = 2;
const CODE_MAX = 30;
const NAME_MAX = 150;
const DESCRIPTION_MAX = 500;

export interface ExistingDepartmentSnapshot {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string | null;
  /** Normalized code of the parent department, or null for a top-level department. */
  parentCode: string | null;
  status: "ACTIVE" | "INACTIVE";
}

export interface NormalizedDepartmentRow {
  code: string;
  existingId: string | null;
  name: string;
  description: ResolvedField<string>;
  color: ResolvedField<string>;
  parentCode: ResolvedField<string>;
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

function formulaIssue(rowNumber: number, field: string): RowIssue {
  return issue(
    rowNumber,
    field,
    "ERROR",
    IMPORT_ERROR_CODES.INVALID_FORMAT,
    `${field} cannot begin with =, +, -, or @ (formula-injection risk).`
  );
}

interface RowDraft {
  rowNumber: number;
  code: string;
  hasError: boolean;
  normalized: NormalizedDepartmentRow | null;
}

/**
 * Validates a Department CSV against Zod-equivalent field rules plus the
 * cross-row/combined-state checks ADR-0007 requires: duplicate codes,
 * unresolvable parents (whether in the file or already in the DB),
 * self-parenting, and — critically — a cycle across the WHOLE proposed
 * graph (file rows plus every existing department they touch), not just
 * a row-by-row parent check, since two individually valid parent changes
 * can still form a cycle together (organogram-hierarchy-safety skill).
 * Writes nothing — this is Stage 1-6 (parse through change-plan
 * generation) only; `import.service.ts.commitDepartmentRows` performs
 * the actual writes via the existing `department.service.ts`.
 */
export function validateDepartmentRows(
  parsed: ParsedCsvFile,
  mode: ImportMode,
  existing: readonly ExistingDepartmentSnapshot[]
): ValidationOutcome<NormalizedDepartmentRow> {
  const issues: RowIssue[] = [...checkColumns(parsed.headers, DEPARTMENT_ALLOWED_COLUMNS)];
  const existingByCode = new Map(existing.map((d) => [d.code, d]));
  const drafts: RowDraft[] = [];
  const codeOccurrences = new Map<string, number[]>();

  for (const row of parsed.rows) {
    const rowIssues: RowIssue[] = [];
    const codeRaw = row.values.departmentCode ?? "";
    const nameRaw = row.values.departmentName ?? "";

    if (codeRaw.trim() === "") rowIssues.push(requiredFieldIssue(row.rowNumber, "departmentCode"));
    if (nameRaw.trim() === "") rowIssues.push(requiredFieldIssue(row.rowNumber, "departmentName"));

    for (const [field, raw] of Object.entries({
      departmentName: nameRaw,
      description: row.values.description ?? "",
      parentDepartmentCode: row.values.parentDepartmentCode ?? "",
      color: row.values.color ?? "",
    })) {
      if (raw.trim() !== "" && isFormulaInjectionRisk(raw.trim())) {
        rowIssues.push(formulaIssue(row.rowNumber, field));
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
          "departmentCode",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          `departmentCode must be ${CODE_MIN}-${CODE_MAX} characters.`
        )
      );
    }
    if (nameRaw.trim().length > NAME_MAX) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "departmentName",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          `departmentName must be ${NAME_MAX} characters or fewer.`
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
          `description does not support the ${descriptionIntentRaw.kind === "none" ? "__NONE__" : "__ROOT__"} sentinel.`
        )
      );
    }

    const colorIntentRaw = interpretFieldValue(row.values.color ?? "");
    let colorIntent: ResolvedField<string> = { kind: "keep" };
    if (colorIntentRaw.kind === "clear") colorIntent = { kind: "clear" };
    else if (colorIntentRaw.kind === "value") {
      if (!HEX_COLOR_PATTERN.test(colorIntentRaw.value)) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "color",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_FORMAT,
            "color must be a valid hex value, e.g. #16a34a."
          )
        );
      }
      colorIntent = { kind: "value", value: colorIntentRaw.value };
    } else if (colorIntentRaw.kind === "none" || colorIntentRaw.kind === "root") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "color",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "color does not support that sentinel."
        )
      );
    }

    const parentIntentRaw = interpretFieldValue(row.values.parentDepartmentCode ?? "");
    let parentIntent: ResolvedField<string> = { kind: "keep" };
    if (parentIntentRaw.kind === "clear" || parentIntentRaw.kind === "none") {
      parentIntent = { kind: "clear" };
    } else if (parentIntentRaw.kind === "value") {
      parentIntent = { kind: "value", value: normalizeCode(parentIntentRaw.value) };
    } else if (parentIntentRaw.kind === "root") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "parentDepartmentCode",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "parentDepartmentCode does not support __ROOT__ — use __NONE__ for a top-level department."
        )
      );
    }

    let status: "ACTIVE" | "INACTIVE" | null = null;
    const statusRaw = (row.values.status ?? "").trim();
    if (statusRaw.length > 0) {
      if (!(DEPARTMENT_STATUSES as readonly string[]).includes(statusRaw.toUpperCase())) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "status",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_STATUS,
            `status must be one of: ${DEPARTMENT_STATUSES.join(", ")}.`
          )
        );
      } else {
        status = statusRaw.toUpperCase() as "ACTIVE" | "INACTIVE";
      }
    }

    if (
      parentIntent.kind === "value" &&
      trimmedCode.length > 0 &&
      parentIntent.value === normalizeCode(trimmedCode)
    ) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "parentDepartmentCode",
          "ERROR",
          IMPORT_ERROR_CODES.SELF_REFERENCE,
          "A department cannot be its own parent."
        )
      );
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
            name: nameRaw.trim(),
            description: descriptionIntent,
            color: colorIntent,
            parentCode: parentIntent,
            status,
          },
    });
  }

  // Stage 3: duplicate codes within the file.
  for (const [code, rowNumbers] of codeOccurrences) {
    if (rowNumbers.length <= 1 || code.startsWith("__invalid_row_")) continue;
    for (const rowNumber of rowNumbers) {
      issues.push(
        issue(
          rowNumber,
          "departmentCode",
          "ERROR",
          IMPORT_ERROR_CODES.DUPLICATE_IN_FILE,
          `departmentCode "${code}" appears more than once in this file.`
        )
      );
      const draft = drafts.find((d) => d.rowNumber === rowNumber);
      if (draft) {
        draft.hasError = true;
        draft.normalized = null;
      }
    }
  }

  // Stage 4: unresolvable parent references (not in file, not in DB) and CREATE_ONLY conflicts.
  const fileCodesSet = new Set(drafts.filter((d) => !d.hasError).map((d) => d.code));
  for (const draft of drafts) {
    if (draft.hasError || !draft.normalized) continue;
    const { parentCode } = draft.normalized;
    if (parentCode.kind === "value") {
      const resolvesInFile = fileCodesSet.has(parentCode.value);
      const resolvesInDb = existingByCode.has(parentCode.value);
      if (!resolvesInFile && !resolvesInDb) {
        issues.push(
          issue(
            draft.rowNumber,
            "parentDepartmentCode",
            "ERROR",
            IMPORT_ERROR_CODES.UNKNOWN_REFERENCE,
            `parentDepartmentCode "${parentCode.value}" does not match any department in this file or company.`
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
          "departmentCode",
          "ERROR",
          IMPORT_ERROR_CODES.CREATE_ONLY_CONFLICT,
          `departmentCode "${draft.code}" already exists — CREATE_ONLY mode cannot update it.`
        )
      );
      draft.hasError = true;
      draft.normalized = null;
    }
  }

  // Stage 5: combined-state cycle detection across the FULL graph (file rows + every
  // existing department, keyed by stable code — a valid matching key for both).
  const parentOf = new Map<string, string | null>();
  for (const dept of existing) parentOf.set(dept.code, dept.parentCode);
  for (const draft of drafts) {
    if (draft.hasError || !draft.normalized) continue;
    const currentParent = existingByCode.get(draft.code)?.parentCode ?? null;
    const resolvedParent = resolveFieldForWrite(draft.normalized.parentCode, currentParent);
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
          "parentDepartmentCode",
          "ERROR",
          IMPORT_ERROR_CODES.HIERARCHY_CYCLE,
          `This department is part of a parent-department cycle: ${cycle.join(" -> ")} -> ${cycle[0]}.`
        )
      );
      draft.hasError = true;
      draft.normalized = null;
    }
  }

  // Assemble the final row plan: action + diffs.
  const rows: RowPlanEntry<NormalizedDepartmentRow>[] = drafts.map((draft) => {
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
    const proposedName = draft.normalized.name;
    const proposedDescription = resolveFieldForWrite(
      draft.normalized.description,
      existingRow.description
    );
    const proposedColor = resolveFieldForWrite(draft.normalized.color, existingRow.color);
    const proposedParent = resolveFieldForWrite(
      draft.normalized.parentCode,
      existingRow.parentCode
    );
    const proposedStatus = draft.normalized.status ?? existingRow.status;

    const diffs = [
      { field: "name", from: existingRow.name, to: proposedName },
      { field: "description", from: existingRow.description, to: proposedDescription },
      { field: "color", from: existingRow.color, to: proposedColor },
      { field: "parentDepartmentCode", from: existingRow.parentCode, to: proposedParent },
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
