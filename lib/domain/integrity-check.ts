/**
 * Read-only domain-integrity checks (Phase 13 release hardening).
 *
 * These functions never mutate anything and never "fix" a violation —
 * per CLAUDE.md's Phase 13 scope, this is a diagnostic tool, not a
 * repair tool. Each function takes plain data already fetched by the
 * caller (lib/services/integrity-check.service.ts) so it stays testable
 * with in-memory fixtures, matching the existing lib/domain/ convention
 * (see lib/domain/hierarchy.ts's own file header) of keeping pure
 * business logic Prisma-free.
 *
 * Every check is independent of the application's normal write paths —
 * it re-derives the invariant from raw rows rather than trusting that
 * hierarchy.service.ts/employee.service.ts/user-admin.service.ts were
 * actually used to produce the data, so it can catch corruption from a
 * bypassed service layer (a bad migration, direct SQL, or a future bug),
 * not just re-confirm what those services already guarantee at write
 * time. See .claude/skills/organogram-hierarchy-safety/SKILL.md for the
 * 12 hierarchy invariants categories 1-7 below are derived from, and
 * docs/DOMAIN_MODEL.md for the assignment-uniqueness invariants
 * categories 10-13 are derived from.
 */

export interface IntegrityPositionRow {
  id: string;
  companyId: string;
  positionCode: string;
  primaryReportsToPositionId: string | null;
  organizationalLevel: number;
}

export interface IntegrityEmployeeRow {
  id: string;
  companyId: string;
  employeeCode: string;
}

export interface IntegrityAssignmentRow {
  id: string;
  companyId: string;
  employeeId: string;
  positionId: string;
  isPrimary: boolean;
  startDate: Date;
  endDate: Date | null;
  /** Company of the referenced employee/position, as actually stored on those rows. */
  employeeCompanyId: string;
  positionCompanyId: string;
}

export interface IntegrityUserRow {
  id: string;
  companyId: string;
  role: "ADMIN" | "HR_EDITOR" | "VIEWER";
  status: "ACTIVE" | "DISABLED";
  linkedEmployeeId: string | null;
  linkedEmployeeCompanyId: string | null;
}

export interface IntegritySessionRow {
  id: string;
  userId: string;
  userStatus: "ACTIVE" | "DISABLED";
}

export interface IntegrityAuditEventRow {
  id: string;
  companyId: string;
  actorUserId: string | null;
  actorUserCompanyId: string | null;
  importJobId: string | null;
  importJobCompanyId: string | null;
  exportJobId: string | null;
  exportJobCompanyId: string | null;
}

export type IntegrityCategory =
  | "MISSING_ROOT_POSITION"
  | "MULTIPLE_ROOT_POSITIONS"
  | "ROOT_LEVEL_NOT_ONE"
  | "CHILD_LEVEL_MISMATCH"
  | "SELF_REPORTING_POSITION"
  | "REPORTING_CYCLE"
  | "CROSS_COMPANY_REPORTS_TO"
  | "DUPLICATE_POSITION_CODE"
  | "DUPLICATE_EMPLOYEE_CODE"
  | "OVERLAPPING_POSITION_ASSIGNMENT"
  | "OVERLAPPING_EMPLOYEE_ASSIGNMENT"
  | "INVALID_ASSIGNMENT_DATE_RANGE"
  | "CROSS_COMPANY_ASSIGNMENT_REFERENCE"
  | "COMPANY_WITHOUT_ACTIVE_ADMIN"
  | "DISABLED_USER_WITH_ACTIVE_SESSION"
  | "CROSS_COMPANY_LINKED_EMPLOYEE"
  | "AUDIT_EVENT_ACTOR_COMPANY_MISMATCH"
  | "AUDIT_EVENT_JOB_COMPANY_MISMATCH";

export interface IntegrityViolation {
  category: IntegrityCategory;
  companyId: string;
  /** IDs of the specific row(s) implicated, for follow-up investigation. */
  recordIds: string[];
  message: string;
}

function byCompany<T extends { companyId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.companyId);
    if (list) list.push(row);
    else map.set(row.companyId, [row]);
  }
  return map;
}

/** Categories 1-4: root existence/uniqueness and level computation. */
export function checkPositionLevelsAndRoots(
  positions: IntegrityPositionRow[]
): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];

  for (const [companyId, companyPositions] of byCompany(positions)) {
    const roots = companyPositions.filter((p) => p.primaryReportsToPositionId === null);

    if (roots.length === 0) {
      violations.push({
        category: "MISSING_ROOT_POSITION",
        companyId,
        recordIds: [],
        message: `Company ${companyId} has ${companyPositions.length} position(s) but no root position (a position with no primaryReportsToPositionId).`,
      });
    } else if (roots.length > 1) {
      violations.push({
        category: "MULTIPLE_ROOT_POSITIONS",
        companyId,
        recordIds: roots.map((r) => r.id),
        message: `Company ${companyId} has ${roots.length} root positions; exactly one is allowed.`,
      });
    }

    for (const root of roots) {
      if (root.organizationalLevel !== 1) {
        violations.push({
          category: "ROOT_LEVEL_NOT_ONE",
          companyId,
          recordIds: [root.id],
          message: `Root position ${root.id} (code ${root.positionCode}) has organizationalLevel ${root.organizationalLevel}, expected 1.`,
        });
      }
    }

    const byId = new Map(companyPositions.map((p) => [p.id, p]));
    for (const position of companyPositions) {
      if (position.primaryReportsToPositionId === null) continue;
      const parent = byId.get(position.primaryReportsToPositionId);
      if (!parent) continue; // cross-company or dangling reference — reported separately
      if (position.organizationalLevel !== parent.organizationalLevel + 1) {
        violations.push({
          category: "CHILD_LEVEL_MISMATCH",
          companyId,
          recordIds: [position.id, parent.id],
          message: `Position ${position.id} (code ${position.positionCode}) has organizationalLevel ${position.organizationalLevel}, expected parent ${parent.organizationalLevel} + 1 = ${parent.organizationalLevel + 1}.`,
        });
      }
    }
  }

  return violations;
}

/** Categories 5-6: self-reporting and cycles of any length. */
export function checkReportingCycles(positions: IntegrityPositionRow[]): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];

  for (const [companyId, companyPositions] of byCompany(positions)) {
    const byId = new Map(companyPositions.map((p) => [p.id, p]));
    const cycleAlreadyReportedFor = new Set<string>();

    for (const position of companyPositions) {
      if (position.primaryReportsToPositionId === position.id) {
        violations.push({
          category: "SELF_REPORTING_POSITION",
          companyId,
          recordIds: [position.id],
          message: `Position ${position.id} (code ${position.positionCode}) reports to itself.`,
        });
        continue;
      }

      if (cycleAlreadyReportedFor.has(position.id)) continue;

      const visited: string[] = [];
      let current: IntegrityPositionRow | undefined = position;
      const seen = new Set<string>();
      while (current?.primaryReportsToPositionId) {
        if (seen.has(current.id)) {
          // A cycle exists somewhere in this chain; report it once per
          // distinct cycle rather than once per position on it.
          const cycleStart = visited.indexOf(current.id);
          const cycleMembers = cycleStart >= 0 ? visited.slice(cycleStart) : visited;
          for (const member of cycleMembers) cycleAlreadyReportedFor.add(member);
          violations.push({
            category: "REPORTING_CYCLE",
            companyId,
            recordIds: cycleMembers,
            message: `Reporting cycle detected among position(s): ${cycleMembers.join(" -> ")}.`,
          });
          break;
        }
        seen.add(current.id);
        visited.push(current.id);
        current = byId.get(current.primaryReportsToPositionId);
      }
    }
  }

  return violations;
}

/** Category 7: a position's parent lives in a different company. */
export function checkCrossCompanyReportsTo(
  positions: IntegrityPositionRow[]
): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  const byId = new Map(positions.map((p) => [p.id, p]));

  for (const position of positions) {
    if (!position.primaryReportsToPositionId) continue;
    const parent = byId.get(position.primaryReportsToPositionId);
    if (parent && parent.companyId !== position.companyId) {
      violations.push({
        category: "CROSS_COMPANY_REPORTS_TO",
        companyId: position.companyId,
        recordIds: [position.id, parent.id],
        message: `Position ${position.id} (company ${position.companyId}) reports to position ${parent.id} in a different company (${parent.companyId}).`,
      });
    }
  }

  return violations;
}

/** Category 8: case-insensitive duplicate position codes within a company. */
export function checkDuplicatePositionCodes(
  positions: IntegrityPositionRow[]
): IntegrityViolation[] {
  return checkDuplicateCodes(positions, (p) => p.positionCode, "DUPLICATE_POSITION_CODE");
}

/** Category 9: case-insensitive duplicate employee codes within a company. */
export function checkDuplicateEmployeeCodes(
  employees: IntegrityEmployeeRow[]
): IntegrityViolation[] {
  return checkDuplicateCodes(employees, (e) => e.employeeCode, "DUPLICATE_EMPLOYEE_CODE");
}

function checkDuplicateCodes<T extends { id: string; companyId: string }>(
  rows: T[],
  getCode: (row: T) => string,
  category: IntegrityCategory
): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];

  for (const [companyId, companyRows] of byCompany(rows)) {
    const byNormalizedCode = new Map<string, T[]>();
    for (const row of companyRows) {
      const normalized = getCode(row).trim().toLowerCase();
      const list = byNormalizedCode.get(normalized);
      if (list) list.push(row);
      else byNormalizedCode.set(normalized, [row]);
    }

    for (const [normalized, group] of byNormalizedCode) {
      if (group.length > 1) {
        violations.push({
          category,
          companyId,
          recordIds: group.map((r) => r.id),
          message: `${group.length} records share the case-insensitive code "${normalized}" in company ${companyId}: ${group.map((r) => r.id).join(", ")}.`,
        });
      }
    }
  }

  return violations;
}

function dateRangesOverlap(
  aStart: Date,
  aEnd: Date | null,
  bStart: Date,
  bEnd: Date | null
): boolean {
  // End dates are exclusive (docs/DOMAIN_MODEL.md §"occupied" definition).
  const aEndMs = aEnd ? aEnd.getTime() : Infinity;
  const bEndMs = bEnd ? bEnd.getTime() : Infinity;
  return aStart.getTime() < bEndMs && bStart.getTime() < aEndMs;
}

/** Categories 10-11: two primary assignments for the same position/employee whose date ranges overlap. */
export function checkOverlappingAssignments(
  assignments: IntegrityAssignmentRow[]
): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  const primaryOnly = assignments.filter((a) => a.isPrimary);

  const checkGroup = (
    groupBy: (a: IntegrityAssignmentRow) => string,
    category: "OVERLAPPING_POSITION_ASSIGNMENT" | "OVERLAPPING_EMPLOYEE_ASSIGNMENT",
    label: string
  ) => {
    const groups = new Map<string, IntegrityAssignmentRow[]>();
    for (const a of primaryOnly) {
      const key = groupBy(a);
      const list = groups.get(key);
      if (list) list.push(a);
      else groups.set(key, [a]);
    }
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;
          if (dateRangesOverlap(a.startDate, a.endDate, b.startDate, b.endDate)) {
            violations.push({
              category,
              companyId: a.companyId,
              recordIds: [a.id, b.id],
              message: `Two primary assignments overlap for the same ${label}: ${a.id} and ${b.id}.`,
            });
          }
        }
      }
    }
  };

  checkGroup((a) => a.positionId, "OVERLAPPING_POSITION_ASSIGNMENT", "position");
  checkGroup((a) => a.employeeId, "OVERLAPPING_EMPLOYEE_ASSIGNMENT", "employee");

  return violations;
}

/** Category 12: an assignment whose end date is not strictly after its start date. */
export function checkInvalidAssignmentDateRanges(
  assignments: IntegrityAssignmentRow[]
): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  for (const a of assignments) {
    if (a.endDate && a.endDate.getTime() <= a.startDate.getTime()) {
      violations.push({
        category: "INVALID_ASSIGNMENT_DATE_RANGE",
        companyId: a.companyId,
        recordIds: [a.id],
        message: `Assignment ${a.id} has endDate (${a.endDate.toISOString()}) not after startDate (${a.startDate.toISOString()}).`,
      });
    }
  }
  return violations;
}

/** Category 13: an assignment's own companyId disagrees with its employee's or position's actual company. */
export function checkCrossCompanyAssignmentReferences(
  assignments: IntegrityAssignmentRow[]
): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  for (const a of assignments) {
    if (a.employeeCompanyId !== a.companyId || a.positionCompanyId !== a.companyId) {
      violations.push({
        category: "CROSS_COMPANY_ASSIGNMENT_REFERENCE",
        companyId: a.companyId,
        recordIds: [a.id],
        message: `Assignment ${a.id} (company ${a.companyId}) references employee company ${a.employeeCompanyId} and/or position company ${a.positionCompanyId}.`,
      });
    }
  }
  return violations;
}

/** Category 14: a company with zero ACTIVE ADMIN users — violates the "always at least one admin" invariant at rest. */
export function checkCompaniesWithoutActiveAdmin(users: IntegrityUserRow[]): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  for (const [companyId, companyUsers] of byCompany(users)) {
    const activeAdmins = companyUsers.filter((u) => u.role === "ADMIN" && u.status === "ACTIVE");
    if (activeAdmins.length === 0) {
      violations.push({
        category: "COMPANY_WITHOUT_ACTIVE_ADMIN",
        companyId,
        recordIds: [],
        message: `Company ${companyId} has no ACTIVE user with role ADMIN — it cannot be administered through the application.`,
      });
    }
  }
  return violations;
}

/** Category 15: a DISABLED user still has a live session row (should have been revoked). */
export function checkDisabledUsersWithActiveSessions(
  sessions: IntegritySessionRow[]
): IntegrityViolation[] {
  return sessions
    .filter((s) => s.userStatus === "DISABLED")
    .map((s) => ({
      category: "DISABLED_USER_WITH_ACTIVE_SESSION" as const,
      companyId: "", // sessions carry no companyId of their own; caller may enrich if needed
      recordIds: [s.id, s.userId],
      message: `Session ${s.id} still exists for disabled user ${s.userId} — it should have been revoked.`,
    }));
}

/** Category 16: a user's linkedEmployeeId points to an Employee in a different company. */
export function checkCrossCompanyLinkedEmployees(users: IntegrityUserRow[]): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  for (const u of users) {
    if (
      u.linkedEmployeeId &&
      u.linkedEmployeeCompanyId &&
      u.linkedEmployeeCompanyId !== u.companyId
    ) {
      violations.push({
        category: "CROSS_COMPANY_LINKED_EMPLOYEE",
        companyId: u.companyId,
        recordIds: [u.id, u.linkedEmployeeId],
        message: `User ${u.id} (company ${u.companyId}) is linked to employee ${u.linkedEmployeeId} in a different company (${u.linkedEmployeeCompanyId}).`,
      });
    }
  }
  return violations;
}

/** Categories 17-18: audit events whose denormalized companyId disagrees with the actor/job it references. */
export function checkAuditEventCompanyConsistency(
  events: IntegrityAuditEventRow[]
): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  for (const e of events) {
    if (e.actorUserId && e.actorUserCompanyId && e.actorUserCompanyId !== e.companyId) {
      violations.push({
        category: "AUDIT_EVENT_ACTOR_COMPANY_MISMATCH",
        companyId: e.companyId,
        recordIds: [e.id, e.actorUserId],
        message: `Audit event ${e.id} (company ${e.companyId}) has actor ${e.actorUserId} from a different company (${e.actorUserCompanyId}).`,
      });
    }
    if (e.importJobId && e.importJobCompanyId && e.importJobCompanyId !== e.companyId) {
      violations.push({
        category: "AUDIT_EVENT_JOB_COMPANY_MISMATCH",
        companyId: e.companyId,
        recordIds: [e.id, e.importJobId],
        message: `Audit event ${e.id} (company ${e.companyId}) references import job ${e.importJobId} from a different company (${e.importJobCompanyId}).`,
      });
    }
    if (e.exportJobId && e.exportJobCompanyId && e.exportJobCompanyId !== e.companyId) {
      violations.push({
        category: "AUDIT_EVENT_JOB_COMPANY_MISMATCH",
        companyId: e.companyId,
        recordIds: [e.id, e.exportJobId],
        message: `Audit event ${e.id} (company ${e.companyId}) references export job ${e.exportJobId} from a different company (${e.exportJobCompanyId}).`,
      });
    }
  }
  return violations;
}

export interface IntegrityCheckInput {
  positions: IntegrityPositionRow[];
  employees: IntegrityEmployeeRow[];
  assignments: IntegrityAssignmentRow[];
  users: IntegrityUserRow[];
  sessions: IntegritySessionRow[];
  auditEvents: IntegrityAuditEventRow[];
}

/** Runs all 18 checks and returns every violation found, in a stable, deterministic order. */
export function runAllIntegrityChecks(input: IntegrityCheckInput): IntegrityViolation[] {
  return [
    ...checkPositionLevelsAndRoots(input.positions),
    ...checkReportingCycles(input.positions),
    ...checkCrossCompanyReportsTo(input.positions),
    ...checkDuplicatePositionCodes(input.positions),
    ...checkDuplicateEmployeeCodes(input.employees),
    ...checkOverlappingAssignments(input.assignments),
    ...checkInvalidAssignmentDateRanges(input.assignments),
    ...checkCrossCompanyAssignmentReferences(input.assignments),
    ...checkCompaniesWithoutActiveAdmin(input.users),
    ...checkDisabledUsersWithActiveSessions(input.sessions),
    ...checkCrossCompanyLinkedEmployees(input.users),
    ...checkAuditEventCompanyConsistency(input.auditEvents),
  ];
}
