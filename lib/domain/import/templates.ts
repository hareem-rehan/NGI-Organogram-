import type { ImportType } from "@prisma/client";

/**
 * Downloadable CSV templates — header row plus one clearly fictional
 * example row (docs/CSV_IMPORT_GUIDE.md has the full column reference;
 * per Phase 10 Step 4, long instructions never belong INSIDE the
 * production template itself, since they could otherwise be
 * misinterpreted as data on re-import). No real employee data, no
 * formulas, no macros — every example value is synthetic.
 */

function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n") + "\r\n";
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const TEMPLATES: Record<ImportType, { headers: string[]; example: string[]; filename: string }> = {
  DEPARTMENT: {
    headers: [
      "departmentCode",
      "departmentName",
      "description",
      "parentDepartmentCode",
      "color",
      "status",
    ],
    example: ["ENG", "Engineering", "Product engineering", "", "#16a34a", "ACTIVE"],
    filename: "department-import-template.csv",
  },
  POSITION: {
    headers: [
      "positionCode",
      "positionTitle",
      "description",
      "departmentCode",
      "jobGradeCode",
      "primaryManagerPositionCode",
      "status",
      "location",
    ],
    example: [
      "POS-ENGMGR-01",
      "Engineering Manager",
      "",
      "ENG",
      "L5",
      "__ROOT__",
      "ACTIVE",
      "Remote",
    ],
    filename: "position-import-template.csv",
  },
  EMPLOYEE: {
    headers: [
      "employeeCode",
      "firstName",
      "lastName",
      "preferredName",
      "workEmail",
      "employmentStatus",
      "joiningDate",
      "leavingDate",
    ],
    example: [
      "EMP-1001",
      "Jordan",
      "Rivera",
      "",
      "jordan.rivera@example.test",
      "ACTIVE",
      "2026-01-15",
      "",
    ],
    filename: "employee-import-template.csv",
  },
  ASSIGNMENT: {
    headers: ["operation", "employeeCode", "positionCode", "effectiveDate", "endDate"],
    example: ["ASSIGN", "EMP-1001", "POS-ENGMGR-01", "2026-01-15", ""],
    filename: "assignment-import-template.csv",
  },
};

export function generateImportTemplateCsv(importType: ImportType): {
  filename: string;
  content: string;
} {
  const template = TEMPLATES[importType];
  return {
    filename: template.filename,
    content: toCsv([template.headers, template.example]),
  };
}
