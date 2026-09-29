import "server-only";
import type { CareerTrackKind, Department, JobFamily, JobFamilyLevelTitle } from "@prisma/client";
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
import { findJobFamilyById } from "@/lib/repositories/career-framework.repository";
import { findDepartmentById } from "@/lib/repositories/department.repository";
import { findJobFamilyLevelTitleById } from "@/lib/repositories/job-family-level-title.repository";
import type { DbClient } from "@/lib/repositories/types";
import { normalizeGradeCode } from "@/lib/services/job-grade.service";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

/**
 * Levels Mapping, one level down (docs/DECISIONS.md D34): sub-division
 * level names, plus showing / hiding a department's or sub-division's
 * columns on the grid. Mirrors department-level-title.service. Career
 * progression only — never touches the reporting hierarchy.
 */

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const RECORD_NOT_FOUND = "P2025";

const SCALE_CODES = new Set(JOB_GRADE_SCALE.map((s) => s.code));

function translateWriteError(error: unknown, reference: string): Error {
  if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      return new ConflictError(`The level name "${reference}" already exists in this cell.`);
    }
    if (error.code === RECORD_NOT_FOUND) {
      return new NotFoundError("JobFamilyLevelTitle", reference);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

export interface CreateJobFamilyLevelTitleInput {
  companyId: string;
  actor?: AuditActor;
  jobFamilyId: string;
  jobGradeCode: string;
  kind: CareerTrackKind;
  title: string;
  displayOrder?: number | null;
}

export async function createJobFamilyLevelTitle(
  input: CreateJobFamilyLevelTitleInput,
  db: DbClient = prisma
): Promise<JobFamilyLevelTitle> {
  const jobGradeCode = normalizeGradeCode(input.jobGradeCode);
  if (!SCALE_CODES.has(jobGradeCode)) {
    throw new DomainValidationError(`Unknown level "${input.jobGradeCode}".`);
  }
  const title = input.title.trim();

  return withTransaction(db, async (tx) => {
    const family = await findJobFamilyById(input.jobFamilyId, input.companyId, tx);
    if (!family) {
      throw new CrossCompanyError(
        `Sub-division ${input.jobFamilyId} does not exist in company ${input.companyId}.`
      );
    }

    let created: JobFamilyLevelTitle;
    try {
      created = await tx.jobFamilyLevelTitle.create({
        data: {
          companyId: input.companyId,
          jobFamilyId: input.jobFamilyId,
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
        entityType: "JobFamilyLevelTitle",
        entityId: created.id,
        entityDisplayReference: `${family.code}:${jobGradeCode}:${input.kind}:${title}`,
        after: created,
      },
      tx
    );
    return created;
  });
}

export async function updateJobFamilyLevelTitle(
  input: { companyId: string; actor?: AuditActor; id: string; title: string },
  db: DbClient = prisma
): Promise<JobFamilyLevelTitle> {
  const title = input.title.trim();

  return withTransaction(db, async (tx) => {
    const existing = await findJobFamilyLevelTitleById(input.id, input.companyId, tx);
    if (!existing) throw new NotFoundError("JobFamilyLevelTitle", input.id);

    let updated: JobFamilyLevelTitle;
    try {
      updated = await tx.jobFamilyLevelTitle.update({ where: { id: input.id }, data: { title } });
    } catch (error) {
      throw translateWriteError(error, title);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "UPDATED",
        category: "CAREER_FRAMEWORK",
        entityType: "JobFamilyLevelTitle",
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

export async function deleteJobFamilyLevelTitle(
  input: { companyId: string; actor?: AuditActor; id: string },
  db: DbClient = prisma
): Promise<void> {
  return withTransaction(db, async (tx) => {
    const existing = await findJobFamilyLevelTitleById(input.id, input.companyId, tx);
    if (!existing) throw new NotFoundError("JobFamilyLevelTitle", input.id);

    try {
      await tx.jobFamilyLevelTitle.delete({ where: { id: input.id } });
    } catch (error) {
      throw translateWriteError(error, existing.title);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "DELETED",
        category: "CAREER_FRAMEWORK",
        entityType: "JobFamilyLevelTitle",
        entityId: existing.id,
        entityDisplayReference: `${existing.jobGradeCode}:${existing.kind}:${existing.title}`,
        before: existing,
      },
      tx
    );
  });
}

/**
 * Show or hide one column group on the Levels Mapping grid. Hiding keeps the
 * level names (they come back when the column is shown again) and never
 * changes the department's ladders or any position.
 */
export async function setLevelsMappingColumnVisibility(
  input: {
    companyId: string;
    actor?: AuditActor;
    target: "DEPARTMENT" | "SUB_DIVISION";
    id: string;
    visible: boolean;
  },
  db: DbClient = prisma
): Promise<Department | JobFamily> {
  return withTransaction(db, async (tx) => {
    if (input.target === "DEPARTMENT") {
      const before = await findDepartmentById(input.id, input.companyId, tx);
      if (!before) throw new NotFoundError("Department", input.id);
      if (before.showInLevelsMapping === input.visible) return before;
      const after = await tx.department.update({
        where: { id: before.id },
        data: { showInLevelsMapping: input.visible },
      });
      await recordAuditEvent(
        {
          companyId: input.companyId,
          actor: input.actor ?? "SYSTEM",
          action: "UPDATED",
          category: "CAREER_FRAMEWORK",
          entityType: "Department",
          entityId: after.id,
          entityDisplayReference: after.code,
          before: { showInLevelsMapping: before.showInLevelsMapping },
          after: { showInLevelsMapping: after.showInLevelsMapping },
        },
        tx
      );
      return after;
    }

    const before = await findJobFamilyById(input.id, input.companyId, tx);
    if (!before) throw new NotFoundError("JobFamily", input.id);
    if (before.showInLevelsMapping === input.visible) return before;
    const after = await tx.jobFamily.update({
      where: { id: before.id },
      data: { showInLevelsMapping: input.visible },
    });
    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "UPDATED",
        category: "CAREER_FRAMEWORK",
        entityType: "JobFamily",
        entityId: after.id,
        entityDisplayReference: after.code,
        before: { showInLevelsMapping: before.showInLevelsMapping },
        after: { showInLevelsMapping: after.showInLevelsMapping },
      },
      tx
    );
    return after;
  });
}
