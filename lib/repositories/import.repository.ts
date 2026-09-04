import "server-only";
import type {
  Employee,
  ImportJob,
  ImportRowIssue,
  PositionAssignment,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

/**
 * Every employee in the company — capped, not truly unbounded, per
 * docs/DECISIONS.md P7's ~2,000-position scale target, mirroring
 * `listAllPositionsForCompany`'s existing precedent. Used to build the
 * "existing" snapshot Employee/Assignment import validate against.
 */
export async function listAllEmployeesForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<Employee[]> {
  return db.employee.findMany({
    where: { companyId },
    orderBy: [{ employeeCode: "asc" }],
    take: 2000,
  });
}

/**
 * Every currently-open (endDate null) primary assignment in the company —
 * one query, not N. This is the "existing" state Assignment import's
 * combined-state timeline simulation starts from.
 */
export async function listAllOpenAssignmentsForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<PositionAssignment[]> {
  return db.positionAssignment.findMany({
    where: { companyId, isPrimary: true, endDate: null },
    take: 2000,
  });
}

export interface CreateImportJobInput {
  companyId: string;
  requestedByUserId: string;
  importType: ImportJob["importType"];
  importMode: ImportJob["importMode"];
  originalFilename: string;
  fileChecksum: string;
  fileSize: number;
  rawFile: Buffer;
  expiresAt: Date;
}

export async function createImportJob(
  input: CreateImportJobInput,
  db: DbClient = prisma
): Promise<ImportJob> {
  return db.importJob.create({
    data: {
      companyId: input.companyId,
      requestedByUserId: input.requestedByUserId,
      importType: input.importType,
      importMode: input.importMode,
      originalFilename: input.originalFilename,
      fileChecksum: input.fileChecksum,
      fileSize: input.fileSize,
      rawFile: new Uint8Array(input.rawFile),
      status: "UPLOADED",
      expiresAt: input.expiresAt,
    },
  });
}

export async function findImportJobById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<ImportJob | null> {
  return db.importJob.findFirst({ where: { id, companyId } });
}

export async function listImportJobsForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<ImportJob[]> {
  return db.importJob.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function updateImportJob(
  id: string,
  data: Prisma.ImportJobUpdateInput,
  db: DbClient = prisma
): Promise<ImportJob> {
  return db.importJob.update({ where: { id }, data });
}

export async function createImportRowIssues(
  importJobId: string,
  issues: readonly Omit<Prisma.ImportRowIssueCreateManyInput, "importJobId">[],
  db: DbClient = prisma
): Promise<void> {
  if (issues.length === 0) return;
  await db.importRowIssue.createMany({
    data: issues.map((issue) => ({ ...issue, importJobId })),
  });
}

export async function listImportRowIssues(
  importJobId: string,
  db: DbClient = prisma
): Promise<ImportRowIssue[]> {
  return db.importRowIssue.findMany({
    where: { importJobId },
    orderBy: [{ rowNumber: "asc" }],
  });
}

export async function deleteImportRowIssues(
  importJobId: string,
  db: DbClient = prisma
): Promise<void> {
  await db.importRowIssue.deleteMany({ where: { importJobId } });
}
