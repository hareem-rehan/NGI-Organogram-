import { describe, expect, it } from "vitest";

import {
  checkAuditEventCompanyConsistency,
  checkCompaniesWithoutActiveAdmin,
  checkCrossCompanyAssignmentReferences,
  checkCrossCompanyLinkedEmployees,
  checkCrossCompanyReportsTo,
  checkDisabledUsersWithActiveSessions,
  checkDuplicateEmployeeCodes,
  checkDuplicatePositionCodes,
  checkInvalidAssignmentDateRanges,
  checkOverlappingAssignments,
  checkPositionLevelsAndRoots,
  checkReportingCycles,
  runAllIntegrityChecks,
  type IntegrityAssignmentRow,
  type IntegrityAuditEventRow,
  type IntegrityEmployeeRow,
  type IntegrityPositionRow,
  type IntegritySessionRow,
  type IntegrityUserRow,
} from "./integrity-check";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

function position(overrides: Partial<IntegrityPositionRow> & { id: string }): IntegrityPositionRow {
  return {
    companyId: COMPANY_A,
    positionCode: `POS-${overrides.id}`,
    primaryReportsToPositionId: null,
    organizationalLevel: 1,
    ...overrides,
  };
}

describe("checkPositionLevelsAndRoots", () => {
  it("passes for a clean two-level hierarchy", () => {
    const root = position({ id: "root", organizationalLevel: 1 });
    const child = position({
      id: "child",
      primaryReportsToPositionId: "root",
      organizationalLevel: 2,
    });
    expect(checkPositionLevelsAndRoots([root, child])).toEqual([]);
  });

  it("flags a company with positions but no root", () => {
    const a = position({ id: "a", primaryReportsToPositionId: "b", organizationalLevel: 2 });
    const b = position({ id: "b", primaryReportsToPositionId: "a", organizationalLevel: 2 });
    const violations = checkPositionLevelsAndRoots([a, b]);
    expect(violations.map((v) => v.category)).toContain("MISSING_ROOT_POSITION");
  });

  it("flags a company with more than one root", () => {
    const root1 = position({ id: "root1", organizationalLevel: 1 });
    const root2 = position({ id: "root2", organizationalLevel: 1 });
    const violations = checkPositionLevelsAndRoots([root1, root2]);
    const multi = violations.find((v) => v.category === "MULTIPLE_ROOT_POSITIONS");
    expect(multi?.recordIds.sort()).toEqual(["root1", "root2"]);
  });

  it("flags a root whose level is not 1", () => {
    const root = position({ id: "root", organizationalLevel: 3 });
    const violations = checkPositionLevelsAndRoots([root]);
    expect(violations.map((v) => v.category)).toEqual(["ROOT_LEVEL_NOT_ONE"]);
  });

  it("flags a child whose level does not equal parent level + 1", () => {
    const root = position({ id: "root", organizationalLevel: 1 });
    const child = position({
      id: "child",
      primaryReportsToPositionId: "root",
      organizationalLevel: 5,
    });
    const violations = checkPositionLevelsAndRoots([root, child]);
    expect(violations.map((v) => v.category)).toEqual(["CHILD_LEVEL_MISMATCH"]);
  });

  it("keeps companies independent — one company's violation never appears under another company's id", () => {
    const goodRoot = position({ id: "good-root", companyId: COMPANY_A, organizationalLevel: 1 });
    const badRoot = position({ id: "bad-root", companyId: COMPANY_B, organizationalLevel: 9 });
    const violations = checkPositionLevelsAndRoots([goodRoot, badRoot]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.companyId).toBe(COMPANY_B);
  });
});

describe("checkReportingCycles", () => {
  it("passes for an acyclic chain", () => {
    const root = position({ id: "root" });
    const mid = position({ id: "mid", primaryReportsToPositionId: "root" });
    const leaf = position({ id: "leaf", primaryReportsToPositionId: "mid" });
    expect(checkReportingCycles([root, mid, leaf])).toEqual([]);
  });

  it("flags self-reporting", () => {
    const p = position({ id: "self", primaryReportsToPositionId: "self" });
    const violations = checkReportingCycles([p]);
    expect(violations.map((v) => v.category)).toEqual(["SELF_REPORTING_POSITION"]);
  });

  it("flags a direct A<->B cycle", () => {
    const a = position({ id: "a", primaryReportsToPositionId: "b" });
    const b = position({ id: "b", primaryReportsToPositionId: "a" });
    const violations = checkReportingCycles([a, b]);
    expect(violations.map((v) => v.category)).toContain("REPORTING_CYCLE");
  });

  it("flags an indirect A->B->C->A cycle", () => {
    const a = position({ id: "a", primaryReportsToPositionId: "c" });
    const b = position({ id: "b", primaryReportsToPositionId: "a" });
    const c = position({ id: "c", primaryReportsToPositionId: "b" });
    const violations = checkReportingCycles([a, b, c]);
    const cycle = violations.find((v) => v.category === "REPORTING_CYCLE");
    expect(cycle?.recordIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("reports a distinct cycle only once even when multiple positions sit on it", () => {
    const a = position({ id: "a", primaryReportsToPositionId: "b" });
    const b = position({ id: "b", primaryReportsToPositionId: "a" });
    const violations = checkReportingCycles([a, b]);
    expect(violations.filter((v) => v.category === "REPORTING_CYCLE")).toHaveLength(1);
  });
});

describe("checkCrossCompanyReportsTo", () => {
  it("passes when parent and child share a company", () => {
    const root = position({ id: "root", companyId: COMPANY_A });
    const child = position({
      id: "child",
      companyId: COMPANY_A,
      primaryReportsToPositionId: "root",
    });
    expect(checkCrossCompanyReportsTo([root, child])).toEqual([]);
  });

  it("flags a position reporting to a different company's position", () => {
    const foreignRoot = position({ id: "foreign-root", companyId: COMPANY_B });
    const child = position({
      id: "child",
      companyId: COMPANY_A,
      primaryReportsToPositionId: "foreign-root",
    });
    const violations = checkCrossCompanyReportsTo([foreignRoot, child]);
    expect(violations.map((v) => v.category)).toEqual(["CROSS_COMPANY_REPORTS_TO"]);
  });
});

describe("checkDuplicatePositionCodes / checkDuplicateEmployeeCodes", () => {
  it("passes for unique codes", () => {
    const a = position({ id: "a", positionCode: "ENG-001" });
    const b = position({ id: "b", positionCode: "ENG-002" });
    expect(checkDuplicatePositionCodes([a, b])).toEqual([]);
  });

  it("flags case-insensitive duplicate position codes within a company", () => {
    const a = position({ id: "a", positionCode: "ENG-001" });
    const b = position({ id: "b", positionCode: "eng-001" });
    const violations = checkDuplicatePositionCodes([a, b]);
    expect(violations.map((v) => v.category)).toEqual(["DUPLICATE_POSITION_CODE"]);
  });

  it("does not flag the same code reused across different companies", () => {
    const a = position({ id: "a", companyId: COMPANY_A, positionCode: "ENG-001" });
    const b = position({ id: "b", companyId: COMPANY_B, positionCode: "ENG-001" });
    expect(checkDuplicatePositionCodes([a, b])).toEqual([]);
  });

  it("flags case-insensitive duplicate employee codes within a company", () => {
    const employees: IntegrityEmployeeRow[] = [
      { id: "e1", companyId: COMPANY_A, employeeCode: "EMP-100" },
      { id: "e2", companyId: COMPANY_A, employeeCode: " emp-100 " },
    ];
    const violations = checkDuplicateEmployeeCodes(employees);
    expect(violations.map((v) => v.category)).toEqual(["DUPLICATE_EMPLOYEE_CODE"]);
  });
});

function assignment(
  overrides: Partial<IntegrityAssignmentRow> & { id: string }
): IntegrityAssignmentRow {
  return {
    companyId: COMPANY_A,
    employeeId: "emp-1",
    positionId: "pos-1",
    isPrimary: true,
    startDate: new Date("2024-01-01"),
    endDate: null,
    employeeCompanyId: COMPANY_A,
    positionCompanyId: COMPANY_A,
    ...overrides,
  };
}

describe("checkOverlappingAssignments", () => {
  it("passes for sequential, non-overlapping assignments to the same position", () => {
    const first = assignment({
      id: "a1",
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-06-01"),
    });
    const second = assignment({ id: "a2", startDate: new Date("2024-06-01"), endDate: null });
    expect(checkOverlappingAssignments([first, second])).toEqual([]);
  });

  it("flags two open-ended primary assignments to the same position", () => {
    const first = assignment({ id: "a1", positionId: "pos-1" });
    const second = assignment({ id: "a2", positionId: "pos-1" });
    const violations = checkOverlappingAssignments([first, second]);
    expect(violations.map((v) => v.category)).toContain("OVERLAPPING_POSITION_ASSIGNMENT");
  });

  it("flags two overlapping primary assignments for the same employee across different positions", () => {
    const first = assignment({
      id: "a1",
      employeeId: "emp-1",
      positionId: "pos-1",
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-01"),
    });
    const second = assignment({
      id: "a2",
      employeeId: "emp-1",
      positionId: "pos-2",
      startDate: new Date("2024-06-01"),
      endDate: null,
    });
    const violations = checkOverlappingAssignments([first, second]);
    expect(violations.map((v) => v.category)).toContain("OVERLAPPING_EMPLOYEE_ASSIGNMENT");
  });

  it("never flags non-primary (secondary/dotted-line-reserved) assignments", () => {
    const first = assignment({ id: "a1", positionId: "pos-1", isPrimary: false });
    const second = assignment({ id: "a2", positionId: "pos-1", isPrimary: false });
    expect(checkOverlappingAssignments([first, second])).toEqual([]);
  });
});

describe("checkInvalidAssignmentDateRanges", () => {
  it("passes when endDate is strictly after startDate", () => {
    const a = assignment({
      id: "a1",
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-02-01"),
    });
    expect(checkInvalidAssignmentDateRanges([a])).toEqual([]);
  });

  it("flags an endDate equal to startDate", () => {
    const a = assignment({
      id: "a1",
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-01-01"),
    });
    expect(checkInvalidAssignmentDateRanges([a]).map((v) => v.category)).toEqual([
      "INVALID_ASSIGNMENT_DATE_RANGE",
    ]);
  });

  it("flags an endDate before startDate", () => {
    const a = assignment({
      id: "a1",
      startDate: new Date("2024-06-01"),
      endDate: new Date("2024-01-01"),
    });
    expect(checkInvalidAssignmentDateRanges([a]).map((v) => v.category)).toEqual([
      "INVALID_ASSIGNMENT_DATE_RANGE",
    ]);
  });
});

describe("checkCrossCompanyAssignmentReferences", () => {
  it("passes when all three companyIds agree", () => {
    const a = assignment({ id: "a1" });
    expect(checkCrossCompanyAssignmentReferences([a])).toEqual([]);
  });

  it("flags when the referenced employee belongs to a different company", () => {
    const a = assignment({ id: "a1", employeeCompanyId: COMPANY_B });
    expect(checkCrossCompanyAssignmentReferences([a]).map((v) => v.category)).toEqual([
      "CROSS_COMPANY_ASSIGNMENT_REFERENCE",
    ]);
  });

  it("flags when the referenced position belongs to a different company", () => {
    const a = assignment({ id: "a1", positionCompanyId: COMPANY_B });
    expect(checkCrossCompanyAssignmentReferences([a]).map((v) => v.category)).toEqual([
      "CROSS_COMPANY_ASSIGNMENT_REFERENCE",
    ]);
  });
});

describe("checkCompaniesWithoutActiveAdmin", () => {
  function user(overrides: Partial<IntegrityUserRow> & { id: string }): IntegrityUserRow {
    return {
      companyId: COMPANY_A,
      role: "VIEWER",
      status: "ACTIVE",
      linkedEmployeeId: null,
      linkedEmployeeCompanyId: null,
      ...overrides,
    };
  }

  it("passes when a company has at least one active admin", () => {
    const admin = user({ id: "u1", role: "ADMIN", status: "ACTIVE" });
    expect(checkCompaniesWithoutActiveAdmin([admin])).toEqual([]);
  });

  it("flags a company whose only admin is disabled", () => {
    const disabledAdmin = user({ id: "u1", role: "ADMIN", status: "DISABLED" });
    const viewer = user({ id: "u2", role: "VIEWER", status: "ACTIVE" });
    const violations = checkCompaniesWithoutActiveAdmin([disabledAdmin, viewer]);
    expect(violations.map((v) => v.category)).toEqual(["COMPANY_WITHOUT_ACTIVE_ADMIN"]);
  });

  it("flags a company with users but no admin role at all", () => {
    const editor = user({ id: "u1", role: "HR_EDITOR", status: "ACTIVE" });
    expect(checkCompaniesWithoutActiveAdmin([editor]).map((v) => v.category)).toEqual([
      "COMPANY_WITHOUT_ACTIVE_ADMIN",
    ]);
  });
});

describe("checkDisabledUsersWithActiveSessions", () => {
  function session(overrides: Partial<IntegritySessionRow> & { id: string }): IntegritySessionRow {
    return { userId: "u1", userStatus: "ACTIVE", ...overrides };
  }

  it("passes when no disabled user has a session", () => {
    expect(checkDisabledUsersWithActiveSessions([session({ id: "s1" })])).toEqual([]);
  });

  it("flags a session belonging to a disabled user", () => {
    const violations = checkDisabledUsersWithActiveSessions([
      session({ id: "s1", userStatus: "DISABLED" }),
    ]);
    expect(violations.map((v) => v.category)).toEqual(["DISABLED_USER_WITH_ACTIVE_SESSION"]);
  });
});

describe("checkCrossCompanyLinkedEmployees", () => {
  function user(overrides: Partial<IntegrityUserRow> & { id: string }): IntegrityUserRow {
    return {
      companyId: COMPANY_A,
      role: "ADMIN",
      status: "ACTIVE",
      linkedEmployeeId: null,
      linkedEmployeeCompanyId: null,
      ...overrides,
    };
  }

  it("passes when no employee is linked", () => {
    expect(checkCrossCompanyLinkedEmployees([user({ id: "u1" })])).toEqual([]);
  });

  it("passes when the linked employee shares the user's company", () => {
    const u = user({ id: "u1", linkedEmployeeId: "e1", linkedEmployeeCompanyId: COMPANY_A });
    expect(checkCrossCompanyLinkedEmployees([u])).toEqual([]);
  });

  it("flags a user linked to an employee in a different company", () => {
    const u = user({ id: "u1", linkedEmployeeId: "e1", linkedEmployeeCompanyId: COMPANY_B });
    expect(checkCrossCompanyLinkedEmployees([u]).map((v) => v.category)).toEqual([
      "CROSS_COMPANY_LINKED_EMPLOYEE",
    ]);
  });
});

describe("checkAuditEventCompanyConsistency", () => {
  function event(
    overrides: Partial<IntegrityAuditEventRow> & { id: string }
  ): IntegrityAuditEventRow {
    return {
      companyId: COMPANY_A,
      actorUserId: null,
      actorUserCompanyId: null,
      importJobId: null,
      importJobCompanyId: null,
      exportJobId: null,
      exportJobCompanyId: null,
      ...overrides,
    };
  }

  it("passes when actor/job companies all agree with the event", () => {
    const e = event({
      id: "ev1",
      actorUserId: "u1",
      actorUserCompanyId: COMPANY_A,
      importJobId: "job1",
      importJobCompanyId: COMPANY_A,
    });
    expect(checkAuditEventCompanyConsistency([e])).toEqual([]);
  });

  it("flags an event whose actor belongs to a different company", () => {
    const e = event({ id: "ev1", actorUserId: "u1", actorUserCompanyId: COMPANY_B });
    expect(checkAuditEventCompanyConsistency([e]).map((v) => v.category)).toEqual([
      "AUDIT_EVENT_ACTOR_COMPANY_MISMATCH",
    ]);
  });

  it("flags an event whose import job belongs to a different company", () => {
    const e = event({ id: "ev1", importJobId: "job1", importJobCompanyId: COMPANY_B });
    expect(checkAuditEventCompanyConsistency([e]).map((v) => v.category)).toEqual([
      "AUDIT_EVENT_JOB_COMPANY_MISMATCH",
    ]);
  });

  it("flags an event whose export job belongs to a different company", () => {
    const e = event({ id: "ev1", exportJobId: "job1", exportJobCompanyId: COMPANY_B });
    expect(checkAuditEventCompanyConsistency([e]).map((v) => v.category)).toEqual([
      "AUDIT_EVENT_JOB_COMPANY_MISMATCH",
    ]);
  });
});

describe("runAllIntegrityChecks", () => {
  it("returns no violations for a fully clean dataset", () => {
    const root = position({ id: "root", organizationalLevel: 1 });
    const child = position({
      id: "child",
      primaryReportsToPositionId: "root",
      organizationalLevel: 2,
    });
    const employee: IntegrityEmployeeRow = {
      id: "e1",
      companyId: COMPANY_A,
      employeeCode: "EMP-1",
    };
    const admin: IntegrityUserRow = {
      id: "u1",
      companyId: COMPANY_A,
      role: "ADMIN",
      status: "ACTIVE",
      linkedEmployeeId: null,
      linkedEmployeeCompanyId: null,
    };
    expect(
      runAllIntegrityChecks({
        positions: [root, child],
        employees: [employee],
        assignments: [],
        users: [admin],
        sessions: [],
        auditEvents: [],
      })
    ).toEqual([]);
  });

  it("aggregates violations across every category when the data is corrupt", () => {
    const selfReporting = position({ id: "p1", primaryReportsToPositionId: "p1" });
    const viewerOnly: IntegrityUserRow = {
      id: "u1",
      companyId: COMPANY_A,
      role: "VIEWER",
      status: "ACTIVE",
      linkedEmployeeId: null,
      linkedEmployeeCompanyId: null,
    };
    const violations = runAllIntegrityChecks({
      positions: [selfReporting],
      employees: [],
      assignments: [],
      users: [viewerOnly],
      sessions: [],
      auditEvents: [],
    });
    const categories = violations.map((v) => v.category);
    expect(categories).toContain("SELF_REPORTING_POSITION");
    expect(categories).toContain("MISSING_ROOT_POSITION");
    expect(categories).toContain("COMPANY_WITHOUT_ACTIVE_ADMIN");
  });
});
