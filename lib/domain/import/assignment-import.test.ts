import { describe, expect, it } from "vitest";

import { parseCsvFile } from "./csv";
import {
  ASSIGNMENT_REQUIRED_COLUMNS,
  validateAssignmentRows,
  type ExistingAssignmentSnapshot,
  type ExistingEmployeeLookup,
  type ExistingPositionLookup,
} from "./assignment-import";

function csv(rows: string): ReturnType<typeof parseCsvFile> {
  return parseCsvFile(rows, ASSIGNMENT_REQUIRED_COLUMNS);
}

const EMPLOYEES: ExistingEmployeeLookup[] = [
  { code: "EMP001", employmentStatus: "ACTIVE" },
  { code: "EMP002", employmentStatus: "ACTIVE" },
  { code: "EMPTERM", employmentStatus: "TERMINATED" },
];
const POSITIONS: ExistingPositionLookup[] = [
  { code: "VPENG", status: "ACTIVE" },
  { code: "ENGMGR", status: "ACTIVE" },
  { code: "INACTIVEPOS", status: "INACTIVE" },
];

function run(csvText: string, assignments: ExistingAssignmentSnapshot[] = []) {
  return validateAssignmentRows(csv(csvText), EMPLOYEES, POSITIONS, assignments);
}

describe("validateAssignmentRows", () => {
  it("validates a simple ASSIGN with no existing assignments", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nASSIGN,EMP001,VPENG,2026-01-01\n"
    );
    expect(outcome.rows[0]!.action).toBe("CREATE");
  });

  it("validates a TRANSFER against an existing open assignment", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nTRANSFER,EMP001,ENGMGR,2026-02-01\n",
      [{ employeeCode: "EMP001", positionCode: "VPENG", startDate: "2025-01-01", endDate: null }]
    );
    expect(outcome.rows[0]!.action).toBe("UPDATE");
    expect(outcome.rows.every((r) => r.action !== "ERROR")).toBe(true);
  });

  it("validates an END_ASSIGNMENT against an existing open assignment on the right position", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate,endDate\nEND_ASSIGNMENT,EMP001,VPENG,,2026-02-01\n",
      [{ employeeCode: "EMP001", positionCode: "VPENG", startDate: "2025-01-01", endDate: null }]
    );
    expect(outcome.rows[0]!.action).toBe("UPDATE");
    expect(outcome.rows.every((r) => r.action !== "ERROR")).toBe(true);
  });

  it("rejects an unknown operation value", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nPROMOTE,EMP001,VPENG,2026-01-01\n"
    );
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "UNKNOWN_OPERATION" }));
  });

  it("rejects TERMINATE_EMPLOYEE with a clear, documented reason (unsupported this phase)", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nTERMINATE_EMPLOYEE,EMP001,VPENG,2026-01-01\n"
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_OPERATION" })
    );
  });

  it("rejects an unknown employeeCode", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nASSIGN,NOPE,VPENG,2026-01-01\n"
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "employeeCode", code: "UNKNOWN_REFERENCE" })
    );
  });

  it("rejects an unknown positionCode", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nASSIGN,EMP001,NOPE,2026-01-01\n"
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "positionCode", code: "UNKNOWN_REFERENCE" })
    );
  });

  it("rejects a cross-company-shaped reference the same way as any unknown code (existing lists are always pre-scoped to one company)", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nASSIGN,FOREIGN_EMP,VPENG,2026-01-01\n"
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "employeeCode", code: "UNKNOWN_REFERENCE" })
    );
  });

  it("rejects ASSIGN for a non-ACTIVE employee", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nASSIGN,EMPTERM,VPENG,2026-01-01\n"
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "UNSAFE_STATUS_CHANGE" })
    );
  });

  it("rejects ASSIGN to an INACTIVE position", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nASSIGN,EMP001,INACTIVEPOS,2026-01-01\n"
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "UNSAFE_STATUS_CHANGE" })
    );
  });

  it("rejects an employee already assigned (ASSIGN with an existing open assignment)", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nASSIGN,EMP001,ENGMGR,2026-02-01\n",
      [{ employeeCode: "EMP001", positionCode: "VPENG", startDate: "2025-01-01", endDate: null }]
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "EMPLOYEE_ALREADY_ASSIGNED" })
    );
  });

  it("rejects a position already occupied (two different employees ASSIGNed to the same position, overlapping)", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\n" +
        "ASSIGN,EMP001,VPENG,2026-01-01\nASSIGN,EMP002,VPENG,2026-01-15\n"
    );
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "POSITION_OCCUPIED" }));
  });

  it("allows a same-day handoff on a position (new occupant starts exactly when the prior one's assignment ends)", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate,endDate\n" +
        "END_ASSIGNMENT,EMP001,VPENG,,2026-02-01\nASSIGN,EMP002,VPENG,2026-02-01,\n",
      [{ employeeCode: "EMP001", positionCode: "VPENG", startDate: "2025-01-01", endDate: null }]
    );
    expect(outcome.rows.every((r) => r.action !== "ERROR")).toBe(true);
  });

  it("rejects TRANSFER for an employee with no current open assignment", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nTRANSFER,EMP001,VPENG,2026-01-01\n"
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_REFERENCE", field: "employeeCode" })
    );
  });

  it("a TRANSFER correctly vacates the SOURCE position, allowing a new hire into it the same day", () => {
    // EMP001 transfers off VPENG onto ENGMGR; EMP002 is ASSIGNed into the
    // now-vacant VPENG the same day. This only validates correctly if the
    // position-keyed simulation knows the TRANSFER frees VPENG — the CSV
    // row for the transfer never names VPENG at all (only its
    // destination), so the source must be resolved from existing DB
    // state.
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\n" +
        "TRANSFER,EMP001,ENGMGR,2026-03-01\nASSIGN,EMP002,VPENG,2026-03-01\n",
      [{ employeeCode: "EMP001", positionCode: "VPENG", startDate: "2025-01-01", endDate: null }]
    );
    expect(outcome.rows.every((r) => r.action !== "ERROR")).toBe(true);
  });

  it("rejects END_ASSIGNMENT for a position code that does not match the employee's actual open assignment", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate,endDate\nEND_ASSIGNMENT,EMP001,ENGMGR,,2026-02-01\n",
      [{ employeeCode: "EMP001", positionCode: "VPENG", startDate: "2025-01-01", endDate: null }]
    );
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "UNKNOWN_REFERENCE" }));
  });

  it("rejects END_ASSIGNMENT with no open assignment to end", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate,endDate\nEND_ASSIGNMENT,EMP001,VPENG,,2026-02-01\n"
    );
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "UNKNOWN_REFERENCE" }));
  });

  it("rejects an invalid effectiveDate", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\nASSIGN,EMP001,VPENG,2026-99-99\n"
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "effectiveDate", code: "INVALID_FORMAT" })
    );
  });

  it("rejects endDate supplied on an ASSIGN row (not applicable to that operation)", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate,endDate\nASSIGN,EMP001,VPENG,2026-01-01,2026-06-01\n"
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "endDate", code: "INVALID_FORMAT" })
    );
  });

  it("rejects effectiveDate supplied on an END_ASSIGNMENT row (not applicable to that operation)", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate,endDate\nEND_ASSIGNMENT,EMP001,VPENG,2026-01-01,2026-06-01\n",
      [{ employeeCode: "EMP001", positionCode: "VPENG", startDate: "2025-01-01", endDate: null }]
    );
    expect(outcome.issues).toContainEqual(
      expect.objectContaining({ field: "effectiveDate", code: "INVALID_FORMAT" })
    );
  });

  it("rejects an endDate earlier than the assignment's own startDate", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate,endDate\nEND_ASSIGNMENT,EMP001,VPENG,,2024-01-01\n",
      [{ employeeCode: "EMP001", positionCode: "VPENG", startDate: "2025-01-01", endDate: null }]
    );
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: "INVALID_DATE_RANGE" }));
  });

  it("supports a coherent multi-step sequence for one employee within a single file (ASSIGN then TRANSFER)", () => {
    const outcome = run(
      "operation,employeeCode,positionCode,effectiveDate\n" +
        "ASSIGN,EMP001,VPENG,2026-01-01\nTRANSFER,EMP001,ENGMGR,2026-06-01\n"
    );
    expect(outcome.rows.every((r) => r.action !== "ERROR")).toBe(true);
  });

  it("is order-independent — the same two rows validate identically regardless of file order", () => {
    const forward = run(
      "operation,employeeCode,positionCode,effectiveDate\n" +
        "ASSIGN,EMP001,VPENG,2026-01-01\nTRANSFER,EMP001,ENGMGR,2026-06-01\n"
    );
    const reversed = run(
      "operation,employeeCode,positionCode,effectiveDate\n" +
        "TRANSFER,EMP001,ENGMGR,2026-06-01\nASSIGN,EMP001,VPENG,2026-01-01\n"
    );
    expect(forward.rows.every((r) => r.action !== "ERROR")).toBe(true);
    expect(reversed.rows.every((r) => r.action !== "ERROR")).toBe(true);
  });
});
