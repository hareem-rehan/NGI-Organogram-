import { describe, expect, it } from "vitest";

import { parseCsvFile } from "./csv";
import {
  DEPARTMENT_REQUIRED_COLUMNS,
  validateDepartmentRows,
  type ExistingDepartmentSnapshot,
} from "./department-import";

function csv(rows: string): ReturnType<typeof parseCsvFile> {
  return parseCsvFile(rows, DEPARTMENT_REQUIRED_COLUMNS);
}

function existing(overrides: Partial<ExistingDepartmentSnapshot> = {}): ExistingDepartmentSnapshot {
  return {
    id: "dept-1",
    code: "ENG",
    name: "Engineering",
    description: null,
    color: null,
    parentCode: null,
    status: "ACTIVE",
    ...overrides,
  };
}

describe("validateDepartmentRows", () => {
  it("creates a new department with valid data", () => {
    const parsed = csv("departmentCode,departmentName\nSALES,Sales\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.createCount).toBe(1);
    expect(outcome.rows[0]!.action).toBe("CREATE");
    expect(outcome.rows[0]!.normalized?.name).toBe("Sales");
  });

  it("updates an existing department when a field changes", () => {
    const parsed = csv("departmentCode,departmentName\nENG,Engineering Team\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", [existing()]);
    expect(outcome.rows[0]!.action).toBe("UPDATE");
    expect(outcome.rows[0]!.diffs).toEqual([
      { field: "name", currentValue: "Engineering", proposedValue: "Engineering Team" },
    ]);
  });

  it("reports UNCHANGED when nothing actually differs", () => {
    const parsed = csv("departmentCode,departmentName\nENG,Engineering\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", [existing()]);
    expect(outcome.rows[0]!.action).toBe("UNCHANGED");
    expect(outcome.unchangedCount).toBe(1);
  });

  it("rejects a missing required field", () => {
    const parsed = csv("departmentCode,departmentName\n,Sales\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.rows[0]!.action).toBe("ERROR");
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "REQUIRED_FIELD", field: "departmentCode" })
    );
  });

  it("rejects a code shorter than the minimum length", () => {
    const parsed = csv("departmentCode,departmentName\nA,Sales\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "INVALID_FORMAT" }));
  });

  it("supports parent-later-in-file resolution (shuffled parent rows)", () => {
    const parsed = csv(
      "departmentCode,departmentName,parentDepartmentCode\nCHILD,Child,PARENT\nPARENT,Parent,\n"
    );
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.rows.every((r) => r.action !== "ERROR")).toBe(true);
    expect(outcome.rows[0]!.normalized?.parentCode).toEqual({ kind: "value", value: "PARENT" });
  });

  it("rejects a duplicate code within the file (both occurrences)", () => {
    const parsed = csv("departmentCode,departmentName\nENG,Engineering\nENG,Engineering 2\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.rows.every((r) => r.action === "ERROR")).toBe(true);
    expect(outcome.issues.filter((i) => i.code === "DUPLICATE_IN_FILE")).toHaveLength(2);
  });

  it("rejects self-parenting", () => {
    const parsed = csv("departmentCode,departmentName,parentDepartmentCode\nENG,Engineering,ENG\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "SELF_REFERENCE" }));
  });

  it("rejects a direct two-department cycle formed across two rows", () => {
    const parsed = csv(
      "departmentCode,departmentName,parentDepartmentCode\nDEPTA,Dept A,DEPTB\nDEPTB,Dept B,DEPTA\n"
    );
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.rows.every((r) => r.action === "ERROR")).toBe(true);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "HIERARCHY_CYCLE" }));
  });

  it("rejects a cycle formed against existing database state (file row + DB parent)", () => {
    // ENG already reports to nothing; importing PARENT-of-ENG whose OWN
    // parent is set (via the file) back to ENG closes a cycle that only
    // exists once DB state and file state are combined.
    const parsed = csv("departmentCode,departmentName,parentDepartmentCode\nPARENT,Parent,ENG\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", [
      existing({ code: "ENG", parentCode: "PARENT" }),
    ]);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "HIERARCHY_CYCLE" }));
  });

  it("rejects an unresolvable parent reference (not in file or DB)", () => {
    const parsed = csv(
      "departmentCode,departmentName,parentDepartmentCode\nSALES,Sales,NONEXISTENT\n"
    );
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "UNKNOWN_REFERENCE" }));
  });

  it("rejects CREATE_ONLY mode matching an existing code", () => {
    const parsed = csv("departmentCode,departmentName\nENG,Engineering\n");
    const outcome = validateDepartmentRows(parsed, "CREATE_ONLY", [existing()]);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "CREATE_ONLY_CONFLICT" })
    );
  });

  it("__CLEAR__ explicitly clears an optional field, blank leaves it unchanged", () => {
    const parsed = csv("departmentCode,departmentName,description\nENG,Engineering,__CLEAR__\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", [
      existing({ description: "Old description" }),
    ]);
    expect(outcome.rows[0]!.diffs).toContainEqual({
      field: "description",
      currentValue: "Old description",
      proposedValue: null,
    });
  });

  it("a blank optional field means no change during UPSERT", () => {
    const parsed = csv("departmentCode,departmentName,description\nENG,Engineering,\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", [
      existing({ description: "Keep me" }),
    ]);
    expect(outcome.rows[0]!.action).toBe("UNCHANGED");
  });

  it("__NONE__ makes a department top-level", () => {
    const parsed = csv(
      "departmentCode,departmentName,parentDepartmentCode\nENG,Engineering,__NONE__\n"
    );
    const outcome = validateDepartmentRows(parsed, "UPSERT", [existing({ parentCode: "PARENT" })]);
    expect(outcome.rows[0]!.diffs).toContainEqual({
      field: "parentDepartmentCode",
      currentValue: "PARENT",
      proposedValue: null,
    });
  });

  it("rejects an invalid hex color", () => {
    const parsed = csv("departmentCode,departmentName,color\nENG,Engineering,notacolor\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "color", code: "INVALID_FORMAT" })
    );
  });

  it("rejects an invalid status value", () => {
    const parsed = csv("departmentCode,departmentName,status\nENG,Engineering,DELETED\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "INVALID_STATUS" }));
  });

  it("rejects formula-injection-shaped content in a text field", () => {
    const parsed = csv("departmentCode,departmentName\nENG,\"=cmd|'/c calc'\"\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "INVALID_FORMAT" }));
  });

  it("flags a denylisted column (organizationalLevel) as a blocking file-level error", () => {
    const parsed = csv("departmentCode,departmentName,organizationalLevel\nENG,Engineering,3\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ rowNumber: 0, code: "UNSUPPORTED_COLUMN" })
    );
    // A file-level (rowNumber: 0) error must still count toward
    // errorRowCount — this is exactly what determines whether the
    // caller (import.service.ts) marks the whole job VALIDATION_FAILED.
    // An otherwise-perfectly-valid row must not let a denylisted column
    // slip through as if the file were clean.
    expect(outcome.errorRowCount).toBeGreaterThan(0);
  });

  it("warns (does not block) on an unrecognized column, but still counts toward warningRowCount so it requires acknowledgement", () => {
    const parsed = csv("departmentCode,departmentName,someExtraColumn\nENG,Engineering,x\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ rowNumber: 0, severity: "WARNING" })
    );
    expect(outcome.rows[0]!.action).not.toBe("ERROR");
    expect(outcome.errorRowCount).toBe(0);
    expect(outcome.warningRowCount).toBeGreaterThan(0);
  });

  it("a valid and an invalid row in the same file are validated independently", () => {
    const parsed = csv("departmentCode,departmentName\nSALES,Sales\n,Missing Code\n");
    const outcome = validateDepartmentRows(parsed, "UPSERT", []);
    expect(outcome.rows[0]!.action).toBe("CREATE");
    expect(outcome.rows[1]!.action).toBe("ERROR");
  });
});
