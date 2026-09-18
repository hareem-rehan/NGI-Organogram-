import "server-only";
import type { Department, Position } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

const CURRENT_ASSIGNMENT_DATE_FILTER = (onDate: Date) => ({
  isPrimary: true as const,
  startDate: { lte: onDate },
  OR: [{ endDate: null }, { endDate: { gt: onDate } }],
});

export interface DepartmentCounts {
  totalActive: number;
  totalInactive: number;
  topLevelActive: number;
  nestedActive: number;
}

/** All four counts in one Promise.all round-trip, each a single Postgres COUNT — docs/DASHBOARD_METRICS.md §B. */
export async function getDepartmentCounts(
  companyId: string,
  db: DbClient = prisma
): Promise<DepartmentCounts> {
  const [totalActive, totalInactive, topLevelActive, nestedActive] = await Promise.all([
    db.department.count({ where: { companyId, status: "ACTIVE" } }),
    db.department.count({ where: { companyId, status: "INACTIVE" } }),
    db.department.count({ where: { companyId, status: "ACTIVE", parentDepartmentId: null } }),
    db.department.count({
      where: { companyId, status: "ACTIVE", parentDepartmentId: { not: null } },
    }),
  ]);
  return { totalActive, totalInactive, topLevelActive, nestedActive };
}

export interface PositionCounts {
  totalActive: number;
  planned: number;
  inactive: number;
}

/** docs/DASHBOARD_METRICS.md §C — status counts only; occupancy is computed separately (date-sensitive). */
export async function getPositionCounts(
  companyId: string,
  db: DbClient = prisma
): Promise<PositionCounts> {
  const [totalActive, planned, inactive] = await Promise.all([
    db.position.count({ where: { companyId, status: "ACTIVE" } }),
    db.position.count({ where: { companyId, status: "PLANNED" } }),
    db.position.count({ where: { companyId, status: "INACTIVE" } }),
  ]);
  return { totalActive, planned, inactive };
}

/**
 * Distinct positionIds with a currently-effective primary assignment,
 * restricted to ACTIVE positions — one query, computed in Postgres
 * (DISTINCT), not a full-record fetch. Same effective-date convention as
 * lib/repositories/position.repository.ts's listOccupiedPositionIds
 * (reused rather than duplicated where that function already fits; this
 * variant additionally joins position.status so callers don't need a
 * second query to filter it — docs/DASHBOARD_METRICS.md §C).
 */
export async function countOccupiedActivePositions(
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<number> {
  const rows = await db.positionAssignment.findMany({
    where: { companyId, ...CURRENT_ASSIGNMENT_DATE_FILTER(onDate), position: { status: "ACTIVE" } },
    select: { positionId: true },
    distinct: ["positionId"],
  });
  return rows.length;
}

/**
 * "Total eligible active positions" for the vacancy-rate denominator
 * (docs/DASHBOARD_METRICS.md §F) — ACTIVE positions in an ACTIVE
 * department only. Deliberately a separate, narrower count from
 * getPositionCounts().totalActive (§C's plain "Total active positions"
 * metric, which is not department-status-restricted) — the two metrics
 * have different, individually documented definitions and must never be
 * silently conflated.
 */
export async function countEligibleActivePositions(
  companyId: string,
  db: DbClient = prisma
): Promise<number> {
  return db.position.count({
    where: { companyId, status: "ACTIVE", department: { status: "ACTIVE" } },
  });
}

/** Same eligibility restriction as countEligibleActivePositions, further filtered to currently occupied — the vacancy-rate numerator's complement. */
export async function countOccupiedEligibleActivePositions(
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<number> {
  const rows = await db.positionAssignment.findMany({
    where: {
      companyId,
      ...CURRENT_ASSIGNMENT_DATE_FILTER(onDate),
      position: { status: "ACTIVE", department: { status: "ACTIVE" } },
    },
    select: { positionId: true },
    distinct: ["positionId"],
  });
  return rows.length;
}

export interface EmployeeCounts {
  active: number;
  inactiveOrTerminated: number;
}

/** docs/DASHBOARD_METRICS.md §D — employmentStatus counts only. */
export async function getEmployeeCounts(
  companyId: string,
  db: DbClient = prisma
): Promise<EmployeeCounts> {
  const [active, inactiveOrTerminated] = await Promise.all([
    db.employee.count({ where: { companyId, employmentStatus: "ACTIVE" } }),
    db.employee.count({
      where: { companyId, employmentStatus: { in: ["TRANSFERRED", "TERMINATED"] } },
    }),
  ]);
  return { active, inactiveOrTerminated };
}

/** Distinct employeeIds with a currently-effective primary assignment, restricted to ACTIVE employees. */
export async function countActiveAssignedEmployees(
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<number> {
  const rows = await db.positionAssignment.findMany({
    where: {
      companyId,
      ...CURRENT_ASSIGNMENT_DATE_FILTER(onDate),
      employee: { employmentStatus: "ACTIVE" },
    },
    select: { employeeId: true },
    distinct: ["employeeId"],
  });
  return rows.length;
}

export interface AssignmentCounts {
  currentPrimary: number;
  future: number;
}

export async function getAssignmentCounts(
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<AssignmentCounts> {
  const [currentPrimary, future] = await Promise.all([
    db.positionAssignment.count({
      where: { companyId, ...CURRENT_ASSIGNMENT_DATE_FILTER(onDate) },
    }),
    db.positionAssignment.count({
      where: { companyId, isPrimary: true, startDate: { gt: onDate } },
    }),
  ]);
  return { currentPrimary, future };
}

/**
 * Positions with more than one currently-effective primary assignment —
 * should always be empty (docs/DASHBOARD_METRICS.md §H). A real SQL
 * GROUP BY + HAVING, computed entirely in Postgres.
 */
export async function findPositionsWithMultipleEffectiveOccupants(
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<string[]> {
  const rows = await db.positionAssignment.groupBy({
    by: ["positionId"],
    where: { companyId, ...CURRENT_ASSIGNMENT_DATE_FILTER(onDate) },
    _count: { positionId: true },
    having: { positionId: { _count: { gt: 1 } } },
  });
  return rows.map((r) => r.positionId);
}

/** Employees with more than one currently-effective primary assignment — should always be empty. */
export async function findEmployeesWithMultipleEffectiveAssignments(
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<string[]> {
  const rows = await db.positionAssignment.groupBy({
    by: ["employeeId"],
    where: { companyId, ...CURRENT_ASSIGNMENT_DATE_FILTER(onDate) },
    _count: { employeeId: true },
    having: { employeeId: { _count: { gt: 1 } } },
  });
  return rows.map((r) => r.employeeId);
}

/** Active positions belonging to an inactive department — docs/DASHBOARD_METRICS.md §H. */
export async function findActivePositionsInInactiveDepartments(
  companyId: string,
  db: DbClient = prisma
): Promise<string[]> {
  const rows = await db.position.findMany({
    where: { companyId, status: "ACTIVE", department: { status: "INACTIVE" } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Currently-effective primary assignments whose employee is not ACTIVE — should always be empty. */
export async function findAssignmentsWithInactiveEmployee(
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<string[]> {
  const rows = await db.positionAssignment.findMany({
    where: {
      companyId,
      ...CURRENT_ASSIGNMENT_DATE_FILTER(onDate),
      employee: { employmentStatus: { not: "ACTIVE" } },
    },
    select: { employeeId: true },
    distinct: ["employeeId"],
  });
  return rows.map((r) => r.employeeId);
}

/** Currently-effective primary assignments whose position is INACTIVE — should always be empty. */
export async function findAssignmentsWithInactivePosition(
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<string[]> {
  const rows = await db.positionAssignment.findMany({
    where: {
      companyId,
      ...CURRENT_ASSIGNMENT_DATE_FILTER(onDate),
      position: { status: "INACTIVE" },
    },
    select: { positionId: true },
    distinct: ["positionId"],
  });
  return rows.map((r) => r.positionId);
}

export interface PositionHierarchySnapshot {
  id: string;
  title: string;
  status: "PLANNED" | "ACTIVE" | "INACTIVE";
  organizationalLevel: number;
  primaryReportsToPositionId: string | null;
  departmentId: string;
}

/**
 * Minimal-field snapshot of EVERY position in the company (any status,
 * capped at 2000 per docs/DECISIONS.md P7), used for the graph-shaped
 * derivations that cannot be expressed as a single SQL aggregate
 * (level distribution, root/disconnected/cycle detection —
 * lib/domain/dashboard.ts). One query, five scalar columns, never the
 * full Position record.
 */
export async function getPositionHierarchySnapshot(
  companyId: string,
  db: DbClient = prisma
): Promise<PositionHierarchySnapshot[]> {
  return db.position.findMany({
    where: { companyId },
    select: {
      id: true,
      title: true,
      status: true,
      organizationalLevel: true,
      primaryReportsToPositionId: true,
      departmentId: true,
    },
    take: 2000,
  });
}

export async function findRootPositionRow(
  companyId: string,
  db: DbClient = prisma
): Promise<Position | null> {
  return db.position.findFirst({ where: { companyId, primaryReportsToPositionId: null } });
}

export interface DepartmentSummaryRow {
  department: Department;
  activePositionCount: number;
  occupiedPositionCount: number;
  vacantPositionCount: number;
  plannedPositionCount: number;
  activeAssignedEmployeeCount: number;
  maxOrganizationalLevel: number | null;
  childDepartmentCount: number;
}

/**
 * One row per department (all statuses — callers filter for display per
 * the "inactive departments follow documented visibility rules" default),
 * each count computed from a single shared position/assignment fetch
 * grouped in application code — avoids N+1 (one query per department)
 * while still working department-by-department, since Prisma's groupBy
 * can't express "distinct occupied positionId count per department" in
 * one aggregate call alongside the other per-department counts.
 */
export async function buildDepartmentSummaries(
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<DepartmentSummaryRow[]> {
  const [departments, positions, occupiedRows] = await Promise.all([
    db.department.findMany({
      where: { companyId },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
    db.position.findMany({
      where: { companyId },
      select: { id: true, departmentId: true, status: true, organizationalLevel: true },
    }),
    db.positionAssignment.findMany({
      where: { companyId, ...CURRENT_ASSIGNMENT_DATE_FILTER(onDate) },
      select: { positionId: true, employeeId: true, position: { select: { departmentId: true } } },
    }),
  ]);

  const occupiedPositionIds = new Set(occupiedRows.map((r) => r.positionId));
  const assignedEmployeesByDept = new Map<string, Set<string>>();
  for (const row of occupiedRows) {
    const deptId = row.position.departmentId;
    const set = assignedEmployeesByDept.get(deptId) ?? new Set<string>();
    set.add(row.employeeId);
    assignedEmployeesByDept.set(deptId, set);
  }

  const childCounts = new Map<string, number>();
  for (const department of departments) {
    if (department.parentDepartmentId) {
      childCounts.set(
        department.parentDepartmentId,
        (childCounts.get(department.parentDepartmentId) ?? 0) + 1
      );
    }
  }

  return departments.map((department) => {
    const deptPositions = positions.filter((p) => p.departmentId === department.id);
    const activePositions = deptPositions.filter((p) => p.status === "ACTIVE");
    const occupied = activePositions.filter((p) => occupiedPositionIds.has(p.id));
    const planned = deptPositions.filter((p) => p.status === "PLANNED");
    const levels = activePositions.map((p) => p.organizationalLevel);

    return {
      department,
      activePositionCount: activePositions.length,
      occupiedPositionCount: occupied.length,
      vacantPositionCount: activePositions.length - occupied.length,
      plannedPositionCount: planned.length,
      activeAssignedEmployeeCount: assignedEmployeesByDept.get(department.id)?.size ?? 0,
      maxOrganizationalLevel: levels.length > 0 ? Math.max(...levels) : null,
      childDepartmentCount: childCounts.get(department.id) ?? 0,
    };
  });
}
