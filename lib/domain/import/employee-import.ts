import { normalizeCode, normalizeWorkEmail } from "@/lib/domain/normalize";

import type { ParsedCsvFile } from "./csv";
import { interpretFieldValue, isFormulaInjectionRisk } from "./csv";
import {
  BASE_DENYLISTED_COLUMNS,
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

export const EMPLOYEE_REQUIRED_COLUMNS = ["employeeCode", "firstName", "lastName"] as const;
export const EMPLOYEE_ALLOWED_COLUMNS = [
  "employeeCode",
  "firstName",
  "lastName",
  "preferredName",
  "workEmail",
  "employmentStatus",
  "joiningDate",
  "leavingDate",
] as const;

/**
 * Employee import must never accept a manager, department, level, or job
 * grade — those are Position/Assignment concerns, and `Employee` has no
 * such field at all (docs/DATA_DICTIONARY.md "Employee"). Extends the
 * base denylist (which alone would let `jobGradeCode`/`departmentCode`
 * through as merely-unrecognized, since those ARE legitimate on Position
 * import) with employee-specific dangerous names.
 */
export const EMPLOYEE_DENYLISTED_COLUMNS = [
  ...BASE_DENYLISTED_COLUMNS,
  "departmentCode",
  "managerCode",
  "managerPositionCode",
  "jobGradeCode",
  "positionCode",
];

const EMPLOYMENT_STATUSES = ["ACTIVE", "TRANSFERRED", "TERMINATED"] as const;
const CODE_MIN = 2;
const CODE_MAX = 30;
const NAME_MAX = 100;
const EMAIL_MAX = 255;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ExistingEmployeeSnapshot {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  workEmail: string | null;
  employmentStatus: "ACTIVE" | "TRANSFERRED" | "TERMINATED";
  joiningDate: string | null;
  leavingDate: string | null;
}

export interface NormalizedEmployeeRow {
  code: string;
  existingId: string | null;
  firstName: string;
  lastName: string;
  preferredName: ResolvedField<string>;
  workEmail: ResolvedField<string>;
  employmentStatus: "ACTIVE" | "TRANSFERRED" | "TERMINATED" | null;
  joiningDate: ResolvedField<string>;
  leavingDate: ResolvedField<string>;
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
  // Guard against JS Date's lenient overflow (e.g. 2024-02-31 -> 2024-03-02).
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

interface RowDraft {
  rowNumber: number;
  code: string;
  hasError: boolean;
  normalized: NormalizedEmployeeRow | null;
}

export function validateEmployeeRows(
  parsed: ParsedCsvFile,
  mode: ImportMode,
  existing: readonly ExistingEmployeeSnapshot[]
): ValidationOutcome<NormalizedEmployeeRow> {
  const issues: RowIssue[] = [
    ...checkColumns(parsed.headers, EMPLOYEE_ALLOWED_COLUMNS, EMPLOYEE_DENYLISTED_COLUMNS),
  ];
  const existingByCode = new Map(existing.map((e) => [e.code, e]));
  const existingByEmail = new Map(
    existing.filter((e) => e.workEmail).map((e) => [e.workEmail as string, e])
  );
  const drafts: RowDraft[] = [];
  const codeOccurrences = new Map<string, number[]>();
  const emailOccurrences = new Map<string, number[]>();

  for (const row of parsed.rows) {
    const rowIssues: RowIssue[] = [];
    const codeRaw = row.values.employeeCode ?? "";
    const firstNameRaw = row.values.firstName ?? "";
    const lastNameRaw = row.values.lastName ?? "";

    if (codeRaw.trim() === "") rowIssues.push(requiredFieldIssue(row.rowNumber, "employeeCode"));
    if (firstNameRaw.trim() === "") rowIssues.push(requiredFieldIssue(row.rowNumber, "firstName"));
    if (lastNameRaw.trim() === "") rowIssues.push(requiredFieldIssue(row.rowNumber, "lastName"));

    for (const [field, raw] of Object.entries({
      firstName: firstNameRaw,
      lastName: lastNameRaw,
      preferredName: row.values.preferredName ?? "",
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
          "employeeCode",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          `employeeCode must be ${CODE_MIN}-${CODE_MAX} characters.`
        )
      );
    }
    if (firstNameRaw.trim().length > NAME_MAX) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "firstName",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          `firstName must be ${NAME_MAX} characters or fewer.`
        )
      );
    }
    if (lastNameRaw.trim().length > NAME_MAX) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "lastName",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          `lastName must be ${NAME_MAX} characters or fewer.`
        )
      );
    }

    const preferredIntentRaw = interpretFieldValue(row.values.preferredName ?? "");
    let preferredIntent: ResolvedField<string> = { kind: "keep" };
    if (preferredIntentRaw.kind === "clear") preferredIntent = { kind: "clear" };
    else if (preferredIntentRaw.kind === "value") {
      if (preferredIntentRaw.value.length > NAME_MAX) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "preferredName",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_FORMAT,
            `preferredName must be ${NAME_MAX} characters or fewer.`
          )
        );
      }
      preferredIntent = { kind: "value", value: preferredIntentRaw.value };
    } else if (preferredIntentRaw.kind === "none" || preferredIntentRaw.kind === "root") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "preferredName",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "preferredName does not support that sentinel."
        )
      );
    }

    const emailIntentRaw = interpretFieldValue(row.values.workEmail ?? "");
    let emailIntent: ResolvedField<string> = { kind: "keep" };
    let normalizedEmail: string | null = null;
    if (emailIntentRaw.kind === "clear") emailIntent = { kind: "clear" };
    else if (emailIntentRaw.kind === "value") {
      const email = normalizeWorkEmail(emailIntentRaw.value) ?? emailIntentRaw.value.toLowerCase();
      if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "workEmail",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_FORMAT,
            "workEmail must be a valid email address."
          )
        );
      } else {
        normalizedEmail = email;
      }
      emailIntent = { kind: "value", value: email };
    } else if (emailIntentRaw.kind === "none" || emailIntentRaw.kind === "root") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "workEmail",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "workEmail does not support that sentinel — use __CLEAR__."
        )
      );
    }

    let employmentStatus: "ACTIVE" | "TRANSFERRED" | "TERMINATED" | null = null;
    const statusRaw = (row.values.employmentStatus ?? "").trim();
    if (statusRaw.length > 0) {
      const upper = statusRaw.toUpperCase();
      if (!(EMPLOYMENT_STATUSES as readonly string[]).includes(upper)) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "employmentStatus",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_STATUS,
            `employmentStatus must be one of: ${EMPLOYMENT_STATUSES.join(", ")}.`
          )
        );
      } else {
        employmentStatus = upper as "ACTIVE" | "TRANSFERRED" | "TERMINATED";
      }
    }

    const joiningIntentRaw = interpretFieldValue(row.values.joiningDate ?? "");
    let joiningIntent: ResolvedField<string> = { kind: "keep" };
    if (joiningIntentRaw.kind === "clear") joiningIntent = { kind: "clear" };
    else if (joiningIntentRaw.kind === "value") {
      const parsedDate = parseStrictDate(joiningIntentRaw.value);
      if (!parsedDate) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "joiningDate",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_FORMAT,
            "joiningDate must be a valid date in YYYY-MM-DD format."
          )
        );
      }
      joiningIntent = { kind: "value", value: parsedDate ?? joiningIntentRaw.value };
    } else if (joiningIntentRaw.kind === "none" || joiningIntentRaw.kind === "root") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "joiningDate",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "joiningDate does not support that sentinel."
        )
      );
    }

    const leavingIntentRaw = interpretFieldValue(row.values.leavingDate ?? "");
    let leavingIntent: ResolvedField<string> = { kind: "keep" };
    if (leavingIntentRaw.kind === "clear") leavingIntent = { kind: "clear" };
    else if (leavingIntentRaw.kind === "value") {
      const parsedDate = parseStrictDate(leavingIntentRaw.value);
      if (!parsedDate) {
        rowIssues.push(
          issue(
            row.rowNumber,
            "leavingDate",
            "ERROR",
            IMPORT_ERROR_CODES.INVALID_FORMAT,
            "leavingDate must be a valid date in YYYY-MM-DD format."
          )
        );
      }
      leavingIntent = { kind: "value", value: parsedDate ?? leavingIntentRaw.value };
    } else if (leavingIntentRaw.kind === "none" || leavingIntentRaw.kind === "root") {
      rowIssues.push(
        issue(
          row.rowNumber,
          "leavingDate",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_FORMAT,
          "leavingDate does not support that sentinel."
        )
      );
    }
    if (
      joiningIntent.kind === "value" &&
      leavingIntent.kind === "value" &&
      joiningIntent.value > leavingIntent.value
    ) {
      rowIssues.push(
        issue(
          row.rowNumber,
          "leavingDate",
          "ERROR",
          IMPORT_ERROR_CODES.INVALID_DATE_RANGE,
          "leavingDate cannot be before joiningDate."
        )
      );
    }

    issues.push(...rowIssues);
    const hasError = rowIssues.some((i) => i.severity === "ERROR");
    const code =
      trimmedCode.length > 0 ? normalizeCode(trimmedCode) : `__invalid_row_${row.rowNumber}`;

    if (!codeOccurrences.has(code)) codeOccurrences.set(code, []);
    codeOccurrences.get(code)!.push(row.rowNumber);
    if (normalizedEmail) {
      if (!emailOccurrences.has(normalizedEmail)) emailOccurrences.set(normalizedEmail, []);
      emailOccurrences.get(normalizedEmail)!.push(row.rowNumber);
    }

    drafts.push({
      rowNumber: row.rowNumber,
      code,
      hasError,
      normalized: hasError
        ? null
        : {
            code,
            existingId: existingByCode.get(code)?.id ?? null,
            firstName: firstNameRaw.trim(),
            lastName: lastNameRaw.trim(),
            preferredName: preferredIntent,
            workEmail: emailIntent,
            employmentStatus,
            joiningDate: joiningIntent,
            leavingDate: leavingIntent,
          },
    });
  }

  for (const [code, rowNumbers] of codeOccurrences) {
    if (rowNumbers.length <= 1 || code.startsWith("__invalid_row_")) continue;
    for (const rowNumber of rowNumbers) {
      issues.push(
        issue(
          rowNumber,
          "employeeCode",
          "ERROR",
          IMPORT_ERROR_CODES.DUPLICATE_IN_FILE,
          `employeeCode "${code}" appears more than once in this file.`
        )
      );
      const draft = drafts.find((d) => d.rowNumber === rowNumber);
      if (draft) {
        draft.hasError = true;
        draft.normalized = null;
      }
    }
  }

  for (const [email, rowNumbers] of emailOccurrences) {
    if (rowNumbers.length <= 1) continue;
    for (const rowNumber of rowNumbers) {
      issues.push(
        issue(
          rowNumber,
          "workEmail",
          "ERROR",
          IMPORT_ERROR_CODES.DUPLICATE_IN_FILE,
          `workEmail "${email}" appears more than once in this file.`
        )
      );
      const draft = drafts.find((d) => d.rowNumber === rowNumber);
      if (draft) {
        draft.hasError = true;
        draft.normalized = null;
      }
    }
  }

  for (const draft of drafts) {
    if (draft.hasError || !draft.normalized) continue;
    if (mode === "CREATE_ONLY" && existingByCode.has(draft.code)) {
      issues.push(
        issue(
          draft.rowNumber,
          "employeeCode",
          "ERROR",
          IMPORT_ERROR_CODES.CREATE_ONLY_CONFLICT,
          `employeeCode "${draft.code}" already exists — CREATE_ONLY mode cannot update it.`
        )
      );
      draft.hasError = true;
      draft.normalized = null;
      continue;
    }
    if (draft.normalized.workEmail.kind === "value") {
      const conflict = existingByEmail.get(draft.normalized.workEmail.value);
      if (conflict && conflict.code !== draft.code) {
        issues.push(
          issue(
            draft.rowNumber,
            "workEmail",
            "ERROR",
            IMPORT_ERROR_CODES.DUPLICATE_IN_DATABASE,
            `workEmail "${draft.normalized.workEmail.value}" already belongs to another employee (${conflict.code}).`
          )
        );
        draft.hasError = true;
        draft.normalized = null;
      }
    }
  }

  const rows: RowPlanEntry<NormalizedEmployeeRow>[] = drafts.map((draft) => {
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
    const proposedFirstName = draft.normalized.firstName;
    const proposedLastName = draft.normalized.lastName;
    const proposedPreferredName = resolveFieldForWrite(
      draft.normalized.preferredName,
      existingRow.preferredName
    );
    const proposedEmail = resolveFieldForWrite(draft.normalized.workEmail, existingRow.workEmail);
    const proposedStatus = draft.normalized.employmentStatus ?? existingRow.employmentStatus;
    const proposedJoining = resolveFieldForWrite(
      draft.normalized.joiningDate,
      existingRow.joiningDate
    );
    const proposedLeaving = resolveFieldForWrite(
      draft.normalized.leavingDate,
      existingRow.leavingDate
    );

    const diffs = [
      { field: "firstName", from: existingRow.firstName, to: proposedFirstName },
      { field: "lastName", from: existingRow.lastName, to: proposedLastName },
      { field: "preferredName", from: existingRow.preferredName, to: proposedPreferredName },
      { field: "workEmail", from: existingRow.workEmail, to: proposedEmail },
      { field: "employmentStatus", from: existingRow.employmentStatus, to: proposedStatus },
      { field: "joiningDate", from: existingRow.joiningDate, to: proposedJoining },
      { field: "leavingDate", from: existingRow.leavingDate, to: proposedLeaving },
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
