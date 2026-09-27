import "server-only";
import type { DepartmentLevelTitle } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

/**
 * Reads for the Levels Mapping grid (department-scoped level titles). All
 * are company-scoped — a caller never reaches another company's rows. Career
 * progression only; nothing here touches the reporting hierarchy.
 */

export async function listDepartmentLevelTitlesForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<DepartmentLevelTitle[]> {
  return db.departmentLevelTitle.findMany({
    where: { companyId },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });
}

export async function listDepartmentLevelTitlesForDepartment(
  departmentId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<DepartmentLevelTitle[]> {
  return db.departmentLevelTitle.findMany({
    where: { departmentId, companyId },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });
}

export async function findDepartmentLevelTitleById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<DepartmentLevelTitle | null> {
  return db.departmentLevelTitle.findFirst({ where: { id, companyId } });
}
