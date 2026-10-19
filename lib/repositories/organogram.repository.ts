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
  /** Grade code + numeric rank, for the leadership view's L7+ threshold. */
  jobGradesById: Map<string, { code: string; level: number | null }>;
  /** Family name per id, for the card/details/colour dimension. */
  jobFamilyNamesById: Map<string, string>;
  /** Every current holder's display name per position, longest-serving first (D56). */
  occupantNamesByPositionId: Map<string, string[]>;
  /** Every current holder's employee id per position, in the same order as the names. */
  occupantEmployeeIdsByPositionId: Map<string, string[]>;
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
  const [positions, departments, jobGrades, jobFamilies, occupantRows] = await Promise.all([
    db.position.findMany({
      where: { companyId },
      select: {
        id: true,
        positionCode: true,
        title: true,
        departmentId: true,
        jobGradeId: true,
        jobFamilyId: true,
        organizationalLevel: true,
        status: true,
        primaryReportsToPositionId: true,
        coReportsToPositionId: true,
        displayOrder: true,
      },
      take: 2000,
    }),
    db.department.findMany({
      where: { companyId },
      select: { id: true, name: true, code: true, color: true, parentDepartmentId: true },
    }),
    db.jobGrade.findMany({
      where: { companyId },
      select: { id: true, name: true, code: true, displayOrder: true },
    }),
    db.jobFamily.findMany({
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
      // Every current holder (a position may have several, D56), the
      // longest-serving first so the card's first name is stable.
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  return {
    positions,
    departments,
    jobGradeNamesById: new Map(jobGrades.map((g) => [g.id, g.name])),
    jobGradesById: new Map(jobGrades.map((g) => [g.id, { code: g.code, level: g.displayOrder }])),
    jobFamilyNamesById: new Map(jobFamilies.map((f) => [f.id, f.name])),
    occupantNamesByPositionId: groupByPosition(occupantRows, (row) =>
      formatEmployeeDisplayName(row.employee)
    ),
    occupantEmployeeIdsByPositionId: groupByPosition(occupantRows, (row) => row.employeeId),
  };
}

/** One list per position, keeping the rows' order. */
function groupByPosition<R extends { positionId: string }>(
  rows: readonly R[],
  value: (row: R) => string
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const list = grouped.get(row.positionId) ?? [];
    list.push(value(row));
    grouped.set(row.positionId, list);
  }
  return grouped;
}
