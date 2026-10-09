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

  it("rejects a cycle that closes only through an existing SECOND head (D27)", () => {
    // DB: CEO ← A ← B, and T reports to CEO with second head B.
    // File: move A under T → A → T → (second head) B → A.
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nPOSA,Pos A,ENG,POST\n"
    );
    const outcome = validatePositionRows(
      parsed,
      "UPSERT",
      [
        existing({ id: "ceo", code: "CEO", reportsToCode: null }),
        existing({ id: "a", code: "POSA", reportsToCode: "CEO" }),
        existing({ id: "b", code: "POSB", reportsToCode: "POSA" }),
        existing({ id: "t", code: "POST", reportsToCode: "CEO", coReportsToCode: "POSB" }),
      ],
      DEPT,
      GRADES
    );
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "HIERARCHY_CYCLE" }));
  });

  it("rejects making a position's existing second head its first head too (D27)", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nPOST,Pos T,ENG,POSB\n"
    );
    const outcome = validatePositionRows(
      parsed,
      "UPSERT",
      [
        existing({ id: "ceo", code: "CEO", reportsToCode: null }),
        existing({ id: "b", code: "POSB", reportsToCode: "CEO" }),
        existing({ id: "t", code: "POST", reportsToCode: "CEO", coReportsToCode: "POSB" }),
      ],
      DEPT,
      GRADES
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({
        code: "HIERARCHY_CYCLE",
        safeMessage: expect.stringMatching(/same head twice/),
      })
    );
  });

  it("accepts moving a co-headed position's first head elsewhere (D27)", () => {
    const parsed = csv(
      "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\nPOST,Pos T,ENG,POSA\n"
    );
    const outcome = validatePositionRows(
      parsed,
      "UPSERT",
      [
        existing({ id: "ceo", code: "CEO", reportsToCode: null }),
        existing({ id: "a", code: "POSA", reportsToCode: "CEO" }),
        existing({ id: "b", code: "POSB", reportsToCode: "CEO" }),
        existing({ id: "t", code: "POST", reportsToCode: "CEO", coReportsToCode: "POSB" }),
      ],
      DEPT,
      GRADES
    );
    expect(outcome.issues.filter((i) => i.severity === "ERROR")).toEqual([]);
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

describe("validatePositionRows — coManagerPositionCode (second head, D27)", () => {
  const HEAD =
    "positionCode,positionTitle,departmentCode,primaryManagerPositionCode,coManagerPositionCode\n";
  const db = [
    existing({ id: "ceo", code: "CEO", reportsToCode: null }),
    existing({ id: "a", code: "POSA", reportsToCode: "CEO" }),
    existing({ id: "b", code: "POSB", reportsToCode: "CEO" }),
  ];
  const errorsOf = (outcome: ReturnType<typeof validatePositionRows>) =>
    outcome.issues.filter((i) => i.severity === "ERROR");

  it("accepts a new position with two heads", () => {
    const outcome = validatePositionRows(
      csv(HEAD + "NEW,New Role,ENG,POSA,POSB\n"),
      "UPSERT",
      db,
      DEPT,
      GRADES
    );
    expect(errorsOf(outcome)).toEqual([]);
    expect(outcome.rows[0]!.action).toBe("CREATE");
    expect(outcome.rows[0]!.normalized!.coReportsToCode).toEqual({ kind: "value", value: "POSB" });
  });

  it("accepts a second head that appears later in the same file", () => {
    const outcome = validatePositionRows(
      csv(HEAD + "NEW,New Role,ENG,POSA,LATER\nLATER,Later Head,ENG,CEO,\n"),
      "UPSERT",
      db,
      DEPT,
      GRADES
    );
    expect(errorsOf(outcome)).toEqual([]);
  });

  it("shows a second-head change on an existing position as a diff", () => {
    const withCo = [
      ...db,
      existing({ id: "t", code: "POST", reportsToCode: "POSA", coReportsToCode: "POSB" }),
    ];
    const outcome = validatePositionRows(
      csv(HEAD + "POST,Chief Executive Officer,EXEC,POSA,__NONE__\n"),
      "UPSERT",
      withCo,
      DEPT,
      GRADES
    );
    expect(errorsOf(outcome)).toEqual([]);
    expect(outcome.rows[0]!.diffs).toContainEqual({
      field: "coManagerPositionCode",
      currentValue: "POSB",
      proposedValue: null,
    });
  });

  it("keeps the current second head when the cell is blank", () => {
    const withCo = [
      ...db,
      existing({ id: "t", code: "POST", reportsToCode: "POSA", coReportsToCode: "POSB" }),
    ];
    const outcome = validatePositionRows(
      csv(HEAD + "POST,Chief Executive Officer,EXEC,POSA,\n"),
      "UPSERT",
      withCo,
      DEPT,
      GRADES
    );
    expect(errorsOf(outcome)).toEqual([]);
    expect(outcome.rows[0]!.diffs.find((d) => d.field === "coManagerPositionCode")).toBeUndefined();
  });

  it.each([
    ["an unknown code", "NEW,New Role,ENG,POSA,NOPE", "UNKNOWN_REFERENCE"],
    ["the position itself", "NEW,New Role,ENG,POSA,NEW", "SELF_REFERENCE"],
    ["__ROOT__", "NEW,New Role,ENG,POSA,__ROOT__", "INVALID_FORMAT"],
    ["the same code as the first head", "NEW,New Role,ENG,POSA,POSA", "HIERARCHY_CYCLE"],
  ])("rejects %s as the second head", (_label, row, code) => {
    const outcome = validatePositionRows(csv(HEAD + row + "\n"), "UPSERT", db, DEPT, GRADES);
    expect(errorsOf(outcome)).toContainEqual(
      expect.objectContaining({ field: "coManagerPositionCode", code })
    );
  });

  it("rejects a second head on the root", () => {
    const outcome = validatePositionRows(
      csv(HEAD + "CEO,Chief Executive Officer,EXEC,__ROOT__,POSA\n"),
      "UPSERT",
      db,
      DEPT,
      GRADES
    );
    expect(errorsOf(outcome)).toContainEqual(
      expect.objectContaining({ field: "coManagerPositionCode", code: "HIERARCHY_CYCLE" })
    );
  });

  it("rejects a second head that closes a reporting loop", () => {
    // POSA gets second head POSC, and POSC reports to POSA: POSA → POSC → POSA.
    const outcome = validatePositionRows(
      csv(HEAD + "POSA,Pos A,ENG,CEO,POSC\nPOSC,Pos C,ENG,POSA,\n"),
      "UPSERT",
      db,
      DEPT,
      GRADES
    );
    expect(errorsOf(outcome)).toContainEqual(expect.objectContaining({ code: "HIERARCHY_CYCLE" }));
  });

  it("lets a row move its first head onto its OLD second head when it also replaces the second head", () => {
    // Before: T reports to POSA (+ POSB). After: POSB (+ POSA) — a swap.
    const withCo = [
      ...db,
      existing({ id: "t", code: "POST", reportsToCode: "POSA", coReportsToCode: "POSB" }),
    ];
    const outcome = validatePositionRows(
      csv(HEAD + "POST,Chief Executive Officer,EXEC,POSB,POSA\n"),
      "UPSERT",
      withCo,
      DEPT,
      GRADES
    );
    expect(errorsOf(outcome)).toEqual([]);
  });

  describe("department by name (D52)", () => {
    const NAMED = [
      { code: "EXEC", name: "Executive" },
      { code: "ENG", name: "Engineering" },
    ];

    it("finds the department by its name, in any case", () => {
      const parsed = csv(
        "positionCode,positionTitle,departmentName,primaryManagerPositionCode\nP-1,CTO,engineering,__ROOT__\n"
      );
      const outcome = validatePositionRows(parsed, "UPSERT", [], NAMED, GRADES);
      expect(outcome.issues.filter((i) => i.severity === "ERROR")).toEqual([]);
      expect(outcome.rows[0]!.normalized!.departmentCode).toBe("ENG");
    });

    it("says plainly when a department name doesn't exist", () => {
      const parsed = csv(
        "positionCode,positionTitle,departmentName,primaryManagerPositionCode\nP-1,CTO,Nowhere,__ROOT__\n"
      );
      const outcome = validatePositionRows(parsed, "UPSERT", [], NAMED, GRADES);
      expect(outcome.issues.map((i) => i.safeMessage)).toContain(
        'departmentName "Nowhere" does not exist in this company.'
      );
    });

    it("requires a department name (or a legacy code) on every row", () => {
      const parsed = csv("positionCode,positionTitle,departmentName\nP-1,CTO,\n");
      const outcome = validatePositionRows(parsed, "UPSERT", [], NAMED, GRADES);
      expect(
        outcome.issues.some((i) => i.field === "departmentName" && i.severity === "ERROR")
      ).toBe(true);
    });

    it("shows a department change by name in the preview", () => {
      const parsed = csv("positionCode,positionTitle,departmentName\nPOS-1,Title,Executive\n");
      const outcome = validatePositionRows(
        parsed,
        "UPSERT",
        [existing({ code: "POS-1", title: "Title", departmentCode: "ENG" })],
        NAMED,
        GRADES
      );
      expect(outcome.rows[0]!.diffs).toContainEqual({
        field: "department",
        currentValue: "Engineering",
        proposedValue: "Executive",
      });
    });

    it("refuses a department name two departments share", () => {
      const parsed = csv(
        "positionCode,positionTitle,departmentName,primaryManagerPositionCode\nP-1,CTO,Engineering,__ROOT__\n"
      );
      const outcome = validatePositionRows(
        parsed,
        "UPSERT",
        [],
        [...NAMED, { code: "ENG2", name: "engineering" }],
        GRADES
      );
      expect(outcome.issues.map((i) => i.safeMessage)).toContain(
        'More than one department is called "Engineering". Rename one in the app, then import again.'
      );
    });
  });
});
