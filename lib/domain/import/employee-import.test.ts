import { describe, expect, it } from "vitest";

import { parseCsvFile } from "./csv";
import {
  EMPLOYEE_REQUIRED_COLUMNS,
  validateEmployeeRows,
  type ExistingEmployeeSnapshot,
} from "./employee-import";

function csv(rows: string): ReturnType<typeof parseCsvFile> {
  return parseCsvFile(rows, EMPLOYEE_REQUIRED_COLUMNS);
}

function existing(overrides: Partial<ExistingEmployeeSnapshot> = {}): ExistingEmployeeSnapshot {
  return {
    id: "emp-1",
    code: "EMP001",
    firstName: "Nadia",
    lastName: "Volkov",
    preferredName: null,
    workEmail: null,
    employmentStatus: "ACTIVE",
    joiningDate: null,
    leavingDate: null,
    ...overrides,
  };
}

describe("validateEmployeeRows", () => {
  it("creates a new employee with valid data", () => {
    const parsed = csv("employeeCode,firstName,lastName\nEMP002,Amara,Diallo\n");
    const outcome = validateEmployeeRows(parsed, "UPSERT", []);
    expect(outcome.rows[0]!.action).toBe("CREATE");
  });

  it("updates an existing employee when a field changes", () => {
    const parsed = csv("employeeCode,firstName,lastName\nEMP001,Nadia,Petrova\n");
    const outcome = validateEmployeeRows(parsed, "UPSERT", [existing()]);
    expect(outcome.rows[0]!.action).toBe("UPDATE");
    expect(outcome.rows[0]!.diffs).toEqual([
      { field: "lastName", currentValue: "Volkov", proposedValue: "Petrova" },
    ]);
  });

  it("rejects a duplicate employee code within the file", () => {
    const parsed = csv("employeeCode,firstName,lastName\nEMP002,A,B\nEMP002,C,D\n");
    const outcome = validateEmployeeRows(parsed, "UPSERT", []);
    expect(
      outcome.issues.filter((i) => i.code === "DUPLICATE_IN_FILE" && i.field === "employeeCode")
    ).toHaveLength(2);
  });

  it("rejects an invalid email format", () => {
    const parsed = csv("employeeCode,firstName,lastName,workEmail\nEMP002,A,B,not-an-email\n");
    const outcome = validateEmployeeRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "workEmail", code: "INVALID_FORMAT" })
    );
  });

  it("rejects an invalid employmentStatus", () => {
    const parsed = csv("employeeCode,firstName,lastName,employmentStatus\nEMP002,A,B,RETIRED\n");
    const outcome = validateEmployeeRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "INVALID_STATUS" }));
  });

  it("rejects invalid dates and a leavingDate before joiningDate", () => {
    const parsed = csv(
      "employeeCode,firstName,lastName,joiningDate,leavingDate\nEMP002,A,B,2024-02-31,2024-02-31\n"
    );
    const outcome = validateEmployeeRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "joiningDate", code: "INVALID_FORMAT" })
    );
  });

  it("rejects leavingDate before joiningDate for otherwise-valid dates", () => {
    const parsed = csv(
      "employeeCode,firstName,lastName,joiningDate,leavingDate\nEMP002,A,B,2024-06-01,2024-01-01\n"
    );
    const outcome = validateEmployeeRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "INVALID_DATE_RANGE" }));
  });

  it("rejects manager/department/level/jobGrade/role/salary/sso columns as denylisted", () => {
    const parsed = csv(
      "employeeCode,firstName,lastName,departmentCode,managerCode,jobGradeCode,organizationalLevel,role,salary,ssoId\n" +
        "EMP002,A,B,ENG,CEO,L5,3,ADMIN,100000,sso-1\n"
    );
    const outcome = validateEmployeeRows(parsed, "UPSERT", []);
    const denylistedFields = outcome.issues
      .filter((i) => i.code === "UNSUPPORTED_COLUMN")
      .map((i) => i.field);
    expect(denylistedFields.sort()).toEqual(
      [
        "departmentCode",
        "jobGradeCode",
        "managerCode",
        "organizationalLevel",
        "role",
        "salary",
        "ssoId",
      ].sort()
    );
    expect(outcome.errorRowCount).toBeGreaterThan(0);
  });

  it("__CLEAR__ explicitly clears preferredName", () => {
    const parsed = csv(
      "employeeCode,firstName,lastName,preferredName\nEMP001,Nadia,Volkov,__CLEAR__\n"
    );
    const outcome = validateEmployeeRows(parsed, "UPSERT", [existing({ preferredName: "Nadi" })]);
    expect(outcome.rows[0]!.diffs).toContainEqual({
      field: "preferredName",
      currentValue: "Nadi",
      proposedValue: null,
    });
  });

  it("a blank optional field means no change during UPSERT", () => {
    const parsed = csv("employeeCode,firstName,lastName,workEmail\nEMP001,Nadia,Volkov,\n");
    const outcome = validateEmployeeRows(parsed, "UPSERT", [existing({ workEmail: "n@x.com" })]);
    expect(outcome.rows[0]!.action).toBe("UNCHANGED");
  });

  it("rejects CREATE_ONLY mode matching an existing employee code", () => {
    const parsed = csv("employeeCode,firstName,lastName\nEMP001,Nadia,Volkov\n");
    const outcome = validateEmployeeRows(parsed, "CREATE_ONLY", [existing()]);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "CREATE_ONLY_CONFLICT" })
    );
  });

  it("rejects a work email that already belongs to a different employee in the database", () => {
    const parsed = csv(
      "employeeCode,firstName,lastName,workEmail\nEMP002,Other,Person,taken@x.com\n"
    );
    const outcome = validateEmployeeRows(parsed, "UPSERT", [
      existing({ workEmail: "taken@x.com" }),
    ]);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_IN_DATABASE" })
    );
  });

  it("allows updating an employee's own row using their own existing email (no false duplicate)", () => {
    const parsed = csv(
      "employeeCode,firstName,lastName,workEmail\nEMP001,Nadia,Volkov,keep@x.com\n"
    );
    const outcome = validateEmployeeRows(parsed, "UPSERT", [existing({ workEmail: "keep@x.com" })]);
    expect(outcome.rows[0]!.action).toBe("UNCHANGED");
  });

  it("rejects formula-injection-shaped content in a name field", () => {
    const parsed = csv('employeeCode,firstName,lastName\nEMP002,"=cmd|test",B\n');
    const outcome = validateEmployeeRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "firstName", code: "INVALID_FORMAT" })
    );
  });

  it("normalizes email case for comparison purposes", () => {
    const parsed = csv(
      "employeeCode,firstName,lastName,workEmail\nEMP002,Other,Person,TAKEN@X.com\n"
    );
    const outcome = validateEmployeeRows(parsed, "UPSERT", [
      existing({ workEmail: "taken@x.com" }),
    ]);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_IN_DATABASE" })
    );
  });
});
