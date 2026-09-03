import "server-only";

import { prisma } from "@/lib/db/prisma";
import { formatEmployeeDisplayName } from "@/lib/domain/normalize";
import type { OrganogramDepartmentInput, OrganogramPositionInput } from "@/lib/domain/organogram";
import type { DbClient } from "@/lib/repositories/types";

const CURRENT_ASSIGNMENT_DATE_FILTER = (onDate: Date) => ({
  isPrimary: true as const,
  startDate: { lte: onDate },
  OR: [{ endDate: null }, { endDate: { gt: onDate } }],
});

export interface OrganogramRawData {
  positions: OrganogramPositionInput[];
  departments: OrganogramDepartmentInput[];
  jobGradeNamesById: Map<string, string>;
  occupantNamesByPositionId: Map<string, string>;
  occupantEmployeeIdsByPositionId: Map<string, string>;
}

/**
 * One bulk pass — four queries total, run concurrently, none per-node —
 * supplying lib/domain/organogram.ts's pure functions with everything
 * they need: every position (any status, capped at 2000 per
 * docs/DECISIONS.md P7, same cap as
 * lib/repositories/dashboard.repository.ts's getPositionHierarchySnapshot),
 * every department (for name/code/color, any status — an inactive
 * department's positions may still need to render, docs/DOMAIN_MODEL.md §8),
 * every job grade name, and the currently-effective occupant display name
 * per position (never the raw Employee record — docs/ORGANOGRAM_RENDERING.md
 * "Security and Privacy").
 */
export async function getOrganogramRawData(
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<OrganogramRawData> {
  const [positions, departments, jobGrades, occupantRows] = await Promise.all([
    db.position.findMany({
      where: { companyId },
      select: {
        id: true,
        positionCode: true,
        title: true,
        departmentId: true,
        jobGradeId: true,
        organizationalLevel: true,
        status: true,
        primaryReportsToPositionId: true,
      },
      take: 2000,
    }),
    db.department.findMany({
      where: { companyId },
      select: { id: true, name: true, code: true, color: true },
    }),
    db.jobGrade.findMany({
      where: { companyId },
      select: { id: true, name: true },
    }),
    db.positionAssignment.findMany({
      where: { companyId, ...CURRENT_ASSIGNMENT_DATE_FILTER(onDate) },
      select: {
        positionId: true,
        employeeId: true,
        employee: { select: { firstName: true, lastName: true, preferredName: true } },
      },
      distinct: ["positionId"],
    }),
  ]);

  return {
    positions,
    departments,
    jobGradeNamesById: new Map(jobGrades.map((g) => [g.id, g.name])),
    occupantNamesByPositionId: new Map(
      occupantRows.map((row) => [row.positionId, formatEmployeeDisplayName(row.employee)])
    ),
    occupantEmployeeIdsByPositionId: new Map(
      occupantRows.map((row) => [row.positionId, row.employeeId])
    ),
  };
}
