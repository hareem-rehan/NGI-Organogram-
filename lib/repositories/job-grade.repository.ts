import "server-only";
import type { JobGrade } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

/** Read-only listing for position-form selects — Job Grade management itself is out of scope for Phases 4–6 (no CRUD UI requested). */
export async function listJobGradesForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<JobGrade[]> {
  return db.jobGrade.findMany({
    where: { companyId, status: "ACTIVE" },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

export async function findJobGradeById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<JobGrade | null> {
  return db.jobGrade.findFirst({ where: { id, companyId } });
}

export interface JobGradeUsage {
  /** Positions whose level (`jobGradeId`) is this grade. */
  positionCount: number;
  /** Career-matrix titles (level-mapping entries) mapped to this grade. */
  titleCount: number;
}

/**
 * How many Positions and career-matrix titles reference each of the
 * company's levels, keyed by grade id. Drives the Career Framework "Levels"
 * panel — showing which levels are actually used and which are safe to
 * remove — so a company can trim the standard scale down to what it uses.
 * A grade absent from the map is used by nothing.
 */
export async function getJobGradeUsageCounts(
  companyId: string,
  db: DbClient = prisma
): Promise<Map<string, JobGradeUsage>> {
  const [byPosition, byEntry] = await Promise.all([
    db.position.groupBy({
      by: ["jobGradeId"],
      where: { companyId, jobGradeId: { not: null } },
      _count: { _all: true },
    }),
    db.levelMappingEntry.groupBy({
      by: ["jobGradeId"],
      where: { companyId },
      _count: { _all: true },
    }),
  ]);

  const usage = new Map<string, JobGradeUsage>();
  const ensure = (id: string): JobGradeUsage => {
    let u = usage.get(id);
    if (!u) {
      u = { positionCount: 0, titleCount: 0 };
      usage.set(id, u);
    }
    return u;
  };
  for (const row of byPosition) {
    if (row.jobGradeId) ensure(row.jobGradeId).positionCount = row._count._all;
  }
  for (const row of byEntry) {
    ensure(row.jobGradeId).titleCount = row._count._all;
  }
  return usage;
}
