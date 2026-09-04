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
