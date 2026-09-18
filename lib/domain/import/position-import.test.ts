import { describe, expect, it } from "vitest";

import { parseCsvFile } from "./csv";
import {
  POSITION_REQUIRED_COLUMNS,
  validatePositionRows,
  type ExistingPositionSnapshot,
} from "./position-import";

function csv(rows: string): ReturnType<typeof parseCsvFile> {
  return parseCsvFile(rows, POSITION_REQUIRED_COLUMNS);
}

function existing(overrides: Partial<ExistingPositionSnapshot> = {}): ExistingPositionSnapshot {
  return {
    id: "pos-1",
    code: "CEO",
    title: "Chief Executive Officer",
    description: null,
    location: null,
    departmentCode: "EXEC",
    jobGradeCode: null,
    reportsToCode: null,
    status: "ACTIVE",
    ...overrides,
  };
}

const DEPT = [{ code: "EXEC" }, { code: "ENG" }];
const GRADES = [{ code: "L5" }];

describe("validatePositionRows", () => {
  it("creates the root position via __ROOT__", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nCEO,CEO,EXEC,__ROOT__\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [], DEPT, GRADES);
    expect(outcome.rows[0]!.action).toBe("CREATE");
    expect(outcome.rows[0]!.normalized?.reportsToCode).toEqual({ kind: "clear" });
  });

  it("requires primaryManagerPositionCode for a new (non-root) position — blank is an error, not an implicit root", () => {
    const parsed = csv("positionCode,positionTitle,departmentCode\nVPENG,VP Eng,ENG\n");
    const outcome = validatePositionRows(parsed, "UPSERT", [existing()], DEPT, GRADES);
    expect(outcome.rows[0]!.action).toBe("ERROR");
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "primaryManagerPositionCode", code: "REQUIRED_FIELD" })
    );
  });

  it("supports manager-later-in-file resolution (shuffled parent rows)", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\n" +
        "VPENG,VP Eng,ENG,CEO\nCEO,CEO,EXEC,__ROOT__\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [], DEPT, GRADES);
    expect(outcome.rows.every((r) => r.action !== "ERROR")).toBe(true);
  });

  it("resolves a manager against existing DB data, not just the file", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nVPENG,VP Eng,ENG,CEO\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [existing()], DEPT, GRADES);
    expect(outcome.rows[0]!.action).toBe("CREATE");
  });

  it("rejects an unknown department", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nPOSX,POSX,NOPE,__ROOT__\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [], DEPT, GRADES);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "departmentCode", code: "UNKNOWN_REFERENCE" })
    );
  });

  it("rejects an unknown job grade", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,jobGradeCode,primaryManagerPositionCode\nPOSX,POSX,ENG,NOPE,__ROOT__\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [], DEPT, GRADES);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "jobGradeCode", code: "UNKNOWN_REFERENCE" })
    );
  });

  it("__NONE__ clears a job grade", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,jobGradeCode\nCEO,CEO,EXEC,__NONE__\n"
    );
    const outcome = validatePositionRows(
      parsed,
      "UPSERT",
      [existing({ jobGradeCode: "L5" })],
      DEPT,
      GRADES
    );
    expect(outcome.rows[0]!.diffs).toContainEqual({
      field: "jobGradeCode",
      currentValue: "L5",
      proposedValue: null,
    });
  });

  it("rejects self-reporting", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nCEO,CEO,EXEC,CEO\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [], DEPT, GRADES);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "SELF_REFERENCE" }));
  });

  it("rejects an in-file reporting cycle", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\n" +
        "POSA,Pos A,ENG,POSB\nPOSB,Pos B,ENG,POSA\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [], DEPT, GRADES);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "HIERARCHY_CYCLE" }));
  });

  it("rejects a cycle formed against existing database state", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nCEO,CEO,EXEC,VPENG\n"
    );
    const outcome = validatePositionRows(
      parsed,
      "UPSERT",
      [existing({ code: "VPENG", reportsToCode: "CEO" })],
      DEPT,
      GRADES
    );
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "HIERARCHY_CYCLE" }));
  });

  it("rejects a second root when one already exists in the database", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nCFO,CFO,EXEC,__ROOT__\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [existing()], DEPT, GRADES);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "SECOND_ROOT" }));
  });

  it("rejects two new roots created in the same file", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\n" +
        "CEO,CEO,EXEC,__ROOT__\nCFO,CFO,EXEC,__ROOT__\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [], DEPT, GRADES);
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "SECOND_ROOT" }));
  });

  it("allows updating the existing root without triggering a second-root false positive", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nCEO,Chief Exec,EXEC,__ROOT__\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [existing()], DEPT, GRADES);
    expect(outcome.rows[0]!.action).toBe("UPDATE");
    expect(outcome.issues.some((i) => i.code === "SECOND_ROOT")).toBe(false);
  });

  it("rejects status PLANNED with a clear, documented reason (not supported via import)", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode,status\nPOSX,POSX,ENG,__ROOT__,PLANNED\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [], DEPT, GRADES);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "status", code: "UNSUPPORTED_OPERATION" })
    );
  });

  it("rejects organizationalLevel and vacancy columns as denylisted", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,organizationalLevel,vacancy\nPOSX,POSX,ENG,3,true\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [], DEPT, GRADES);
    const denylisted = outcome.issues.filter((i) => i.code === "UNSUPPORTED_COLUMN");
    expect(denylisted.map((i) => i.field).sort()).toEqual(["organizationalLevel", "vacancy"]);
    // A file-level error must count toward errorRowCount, the field
    // import.service.ts actually checks to decide VALIDATION_FAILED.
    expect(outcome.errorRowCount).toBeGreaterThan(0);
  });

  it("rejects CREATE_ONLY mode matching an existing position code", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nCEO,CEO,EXEC,__ROOT__\n"
    );
    const outcome = validatePositionRows(parsed, "CREATE_ONLY", [existing()], DEPT, GRADES);
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "CREATE_ONLY_CONFLICT" })
    );
  });

  it("reports UNCHANGED when an update row proposes no real change", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nCEO,Chief Executive Officer,EXEC,__ROOT__\n"
    );
    const outcome = validatePositionRows(parsed, "UPSERT", [existing()], DEPT, GRADES);
    expect(outcome.rows[0]!.action).toBe("UNCHANGED");
  });
});
