import "server-only";
import type { Company, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

export async function findCompanyById(id: string, db: DbClient = prisma): Promise<Company | null> {
  return db.company.findUnique({ where: { id } });
}

/** Company profile fields only (name/legalName/timezone) — never `code` (read-only after setup, docs/DECISIONS.md) or `status`. */
export async function updateCompanyProfile(
  id: string,
  data: Pick<Prisma.CompanyUpdateInput, "name" | "legalName" | "timezone">,
  db: DbClient = prisma
): Promise<Company> {
  return db.company.update({ where: { id }, data });
}
