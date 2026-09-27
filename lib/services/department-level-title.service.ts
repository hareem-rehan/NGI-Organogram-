import "server-only";
import type { CareerTrackKind, DepartmentLevelTitle } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import {
  ConflictError,
  CrossCompanyError,
  DomainValidationError,
  NotFoundError,
} from "@/lib/domain/errors";
import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
import { findDepartmentById } from "@/lib/repositories/department.repository";
import { findDepartmentLevelTitleById } from "@/lib/repositories/department-level-title.repository";
import type { DbClient } from "@/lib/repositories/types";
import { normalizeGradeCode } from "@/lib/services/job-grade.service";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const FOREIGN_KEY_VIOLATION = "P2003";
const RECORD_NOT_FOUND = "P2025";

const SCALE_CODES = new Set(JOB_GRADE_SCALE.map((s) => s.code));

function translateWriteError(error: unknown, reference: string): Error {
  if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      return new ConflictError(`The level name "${reference}" already exists in this cell.`);
    }
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return new ConflictError("This level name is still referenced and cannot be changed.");
    }
    if (error.code === RECORD_NOT_FOUND) {
      return new NotFoundError("DepartmentLevelTitle", reference);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

export interface CreateDepartmentLevelTitleInput {
  companyId: string;
  actor?: AuditActor;
  departmentId: string;
  jobGradeCode: string;
  kind: CareerTrackKind;
  title: string;
  displayOrder?: number | null;
}

export async function createDepartmentLevelTitle(
  input: CreateDepartmentLevelTitleInput,
  db: DbClient = prisma
): Promise<DepartmentLevelTitle> {
  const jobGradeCode = normalizeGradeCode(input.jobGradeCode);
  if (!SCALE_CODES.has(jobGradeCode)) {
    throw new DomainValidationError(`Unknown level "${input.jobGradeCode}".`);
  }
  const title = input.title.trim();

  return withTransaction(db, async (tx) => {
    // The department must belong to this company — a cross-company department
    // id must never anchor a level title.
    const department = await findDepartmentById(input.departmentId, input.companyId, tx);
    if (!department) {
      throw new CrossCompanyError(
        `Department ${input.departmentId} does not exist in company ${input.companyId}.`
      );
    }

    let created: DepartmentLevelTitle;
    try {
      created = await tx.departmentLevelTitle.create({
        data: {
          companyId: input.companyId,
          departmentId: input.departmentId,
          jobGradeCode,
          kind: input.kind,
          title,
          displayOrder: input.displayOrder ?? null,
        },
      });
    } catch (error) {
      throw translateWriteError(error, title);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "CREATED",
        category: "CAREER_FRAMEWORK",
        entityType: "DepartmentLevelTitle",
        entityId: created.id,
        entityDisplayReference: `${jobGradeCode}:${input.kind}:${title}`,
        after: created,
      },
      tx
    );
    return created;
  });
}

export async function updateDepartmentLevelTitle(
  input: { companyId: string; actor?: AuditActor; id: string; title: string },
  db: DbClient = prisma
): Promise<DepartmentLevelTitle> {
  const title = input.title.trim();

  return withTransaction(db, async (tx) => {
    const existing = await findDepartmentLevelTitleById(input.id, input.companyId, tx);
    if (!existing) throw new NotFoundError("DepartmentLevelTitle", input.id);

    let updated: DepartmentLevelTitle;
    try {
      updated = await tx.departmentLevelTitle.update({
        where: { id: input.id },
        data: { title },
      });
    } catch (error) {
      throw translateWriteError(error, title);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "UPDATED",
        category: "CAREER_FRAMEWORK",
        entityType: "DepartmentLevelTitle",
        entityId: updated.id,
        entityDisplayReference: `${updated.jobGradeCode}:${updated.kind}:${updated.title}`,
        before: existing,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export async function deleteDepartmentLevelTitle(
  input: { companyId: string; actor?: AuditActor; id: string },
  db: DbClient = prisma
): Promise<void> {
  return withTransaction(db, async (tx) => {
    const existing = await findDepartmentLevelTitleById(input.id, input.companyId, tx);
    if (!existing) throw new NotFoundError("DepartmentLevelTitle", input.id);

    try {
      await tx.departmentLevelTitle.delete({ where: { id: input.id } });
    } catch (error) {
      throw translateWriteError(error, existing.title);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "DELETED",
        category: "CAREER_FRAMEWORK",
        entityType: "DepartmentLevelTitle",
        entityId: existing.id,
        entityDisplayReference: `${existing.jobGradeCode}:${existing.kind}:${existing.title}`,
        before: existing,
      },
      tx
    );
  });
}
