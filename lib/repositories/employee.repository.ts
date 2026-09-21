import "server-only";
import type { Employee, EmploymentStatus, Position, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

export async function findEmployeeById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<Employee | null> {
  return db.employee.findFirst({ where: { id, companyId } });
}

export interface EmployeeSearchParams {
  companyId: string;
  search?: string;
  status?: EmploymentStatus;
  /** "assigned" = has a currently open-ended primary assignment; "unassigned" = does not. Omit for no filter. */
  assignment?: "assigned" | "unassigned";
  departmentId?: string;
  page: number;
  pageSize: number;
}

export interface EmployeeSearchResult {
  items: Employee[];
  totalCount: number;
}

/**
 * Server-side paginated/filterable employee listing. `search` matches
 * name, employee code, or work email (case-insensitive, substring).
 * Unassigned employees are never excluded by default — only the
 * explicit `assignment: "unassigned"` filter surfaces them exclusively,
 * and no filter at all includes both (Phase 6 Step 11 requirement:
 * "Unassigned employees must remain visible").
 */
export async function searchEmployees(
  params: EmployeeSearchParams,
  db: DbClient = prisma
): Promise<EmployeeSearchResult> {
  const currentAssignmentFilter = { isPrimary: true, endDate: null } as const;

  const where: Prisma.EmployeeWhereInput = {
    companyId: params.companyId,
    ...(params.status ? { employmentStatus: params.status } : {}),
    ...(params.assignment === "assigned" ? { assignments: { some: currentAssignmentFilter } } : {}),
    ...(params.assignment === "unassigned"
      ? { assignments: { none: currentAssignmentFilter } }
      : {}),
    ...(params.departmentId
      ? {
          assignments: {
            some: { ...currentAssignmentFilter, position: { departmentId: params.departmentId } },
          },
        }
      : {}),
    ...(params.search
      ? {
          OR: [
            { firstName: { contains: params.search, mode: "insensitive" } },
            { lastName: { contains: params.search, mode: "insensitive" } },
            { preferredName: { contains: params.search, mode: "insensitive" } },
            { employeeCode: { contains: params.search, mode: "insensitive" } },
            { workEmail: { contains: params.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, totalCount] = await Promise.all([
    db.employee.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.employee.count({ where }),
  ]);

  return { items, totalCount };
}

export interface CurrentAssignmentInfo {
  assignmentId: string;
  startDate: Date;
  position: Position;
}

/**
 * Bulk "what is this employee currently assigned to" lookup for a set of
 * employees — one query, not N (same pattern as
 * lib/repositories/position.repository.ts's `listOccupiedPositionIds`).
 * Used to derive department/manager/level/job-grade for a page of list
 * results without a per-row query. `onDate` uses the same half-open
 * effective-date semantics as lib/domain/assignment.ts.
 */
export async function listCurrentAssignmentsForEmployees(
  employeeIds: readonly string[],
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<Map<string, CurrentAssignmentInfo>> {
  const result = new Map<string, CurrentAssignmentInfo>();
  if (employeeIds.length === 0) return result;

  const rows = await db.positionAssignment.findMany({
    where: {
      companyId,
      employeeId: { in: [...employeeIds] },
      isPrimary: true,
      startDate: { lte: onDate },
      OR: [{ endDate: null }, { endDate: { gt: onDate } }],
    },
    include: { position: true },
  });

  for (const row of rows) {
    result.set(row.employeeId, {
      assignmentId: row.id,
      startDate: row.startDate,
      position: row.position,
    });
  }
  return result;
}
