import "server-only";
import type { ExportJob, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

export interface CreateExportJobInput {
  companyId: string;
  requestedByUserId: string;
  format: ExportJob["format"];
  scope: ExportJob["scope"];
  optionsSnapshot: Prisma.InputJsonValue;
  scopeLabel: string;
  expiresAt: Date;
}

export async function createExportJob(
  input: CreateExportJobInput,
  db: DbClient = prisma
): Promise<ExportJob> {
  return db.exportJob.create({
    data: {
      companyId: input.companyId,
      requestedByUserId: input.requestedByUserId,
      format: input.format,
      scope: input.scope,
      optionsSnapshot: input.optionsSnapshot,
      scopeLabel: input.scopeLabel,
      status: "QUEUED",
      expiresAt: input.expiresAt,
    },
  });
}

export async function findExportJobById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<ExportJob | null> {
  return db.exportJob.findFirst({ where: { id, companyId } });
}

export async function listExportJobsForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<ExportJob[]> {
  return db.exportJob.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function updateExportJob(
  id: string,
  data: Prisma.ExportJobUpdateInput,
  db: DbClient = prisma
): Promise<ExportJob> {
  return db.exportJob.update({ where: { id }, data });
}
