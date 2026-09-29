import "server-only";
import type { JobFamilyLevelTitle } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

/**
 * Reads for the sub-division columns of the Levels Mapping grid
 * (docs/DECISIONS.md D34). Company-scoped like every other read. Career
 * progression only; nothing here touches the reporting hierarchy.
 */

export async function listJobFamilyLevelTitlesForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<JobFamilyLevelTitle[]> {
  return db.jobFamilyLevelTitle.findMany({
    where: { companyId },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });
}

export async function findJobFamilyLevelTitleById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<JobFamilyLevelTitle | null> {
  return db.jobFamilyLevelTitle.findFirst({ where: { id, companyId } });
}
