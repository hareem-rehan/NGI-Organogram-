import "server-only";
import type { CompanySettings, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

export async function findSettingsByCompanyId(
  companyId: string,
  db: DbClient = prisma
): Promise<CompanySettings | null> {
  return db.companySettings.findUnique({ where: { companyId } });
}

export async function createDefaultSettings(
  companyId: string,
  db: DbClient = prisma
): Promise<CompanySettings> {
  return db.companySettings.create({ data: { companyId } });
}

export async function updateSettings(
  companyId: string,
  data: Prisma.CompanySettingsUpdateInput,
  db: DbClient = prisma
): Promise<CompanySettings> {
  return db.companySettings.update({ where: { companyId }, data });
}
