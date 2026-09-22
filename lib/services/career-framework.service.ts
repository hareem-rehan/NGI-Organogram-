import "server-only";
import type { CareerTrack, CareerTrackKind, JobFamily, LevelMappingEntry } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { normalizeCode } from "@/lib/domain/normalize";
import { ConflictError, CrossCompanyError, NotFoundError } from "@/lib/domain/errors";
import { findDepartmentById } from "@/lib/repositories/department.repository";
import { findJobGradeById } from "@/lib/repositories/job-grade.repository";
import {
  countPositionsInCareerTrack,
  countPositionsInJobFamily,
  findCareerTrackById,
  findJobFamilyById,
  findLevelMappingEntryById,
} from "@/lib/repositories/career-framework.repository";
import type { DbClient } from "@/lib/repositories/types";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const FOREIGN_KEY_VIOLATION = "P2003";
const RECORD_NOT_FOUND = "P2025";

function translateWriteError(error: unknown, entity: string, reference: string): Error {
  if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      return new ConflictError(`A ${entity} with reference "${reference}" already exists.`);
    }
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return new ConflictError(`This ${entity} is still referenced and cannot be changed.`);
    }
    if (error.code === RECORD_NOT_FOUND) {
      return new NotFoundError(entity, reference);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

// ── Job family ────────────────────────────────────────────────────────

export interface CreateJobFamilyInput {
  companyId: string;
  actor?: AuditActor;
  departmentId: string;
  name: string;
  code: string;
  description?: string | null;
  displayOrder?: number | null;
}

export async function createJobFamily(
  input: CreateJobFamilyInput,
  db: DbClient = prisma
): Promise<JobFamily> {
  const code = normalizeCode(input.code);

  return withTransaction(db, async (tx) => {
    // The parent department must belong to this company — a cross-company
    // department id must never anchor a job family.
    const department = await findDepartmentById(input.departmentId, input.companyId, tx);
    if (!department) {
      throw new CrossCompanyError(
        `Department ${input.departmentId} does not exist in company ${input.companyId}.`
      );
    }

    let created: JobFamily;
    try {
      created = await tx.jobFamily.create({
        data: {
          companyId: input.companyId,
          departmentId: input.departmentId,
          name: input.name.trim(),
          code,
          description: input.description?.trim() || null,
          displayOrder: input.displayOrder ?? null,
        },
      });
    } catch (error) {
      throw translateWriteError(error, "JobFamily", code);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "CREATED",
        category: "CAREER_FRAMEWORK",
        entityType: "JobFamily",
        entityId: created.id,
        entityDisplayReference: created.code,
        after: created,
      },
      tx
    );
    return created;
  });
}

export interface UpdateJobFamilyInput {
  companyId: string;
  actor?: AuditActor;
  jobFamilyId: string;
  name?: string;
  code?: string;
  description?: string | null;
  displayOrder?: number | null;
}

export async function updateJobFamily(
  input: UpdateJobFamilyInput,
  db: DbClient = prisma
): Promise<JobFamily> {
  return withTransaction(db, async (tx) => {
    const existing = await findJobFamilyById(input.jobFamilyId, input.companyId, tx);
    if (!existing) throw new NotFoundError("JobFamily", input.jobFamilyId);

    const code = input.code !== undefined ? normalizeCode(input.code) : undefined;

    let updated: JobFamily;
    try {
      updated = await tx.jobFamily.update({
        where: { id: input.jobFamilyId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        },
      });
    } catch (error) {
      throw translateWriteError(error, "JobFamily", code ?? existing.code);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "UPDATED",
        category: "CAREER_FRAMEWORK",
        entityType: "JobFamily",
        entityId: updated.id,
        entityDisplayReference: updated.code,
        before: existing,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export async function deleteJobFamily(
  input: { companyId: string; actor?: AuditActor; jobFamilyId: string },
  db: DbClient = prisma
): Promise<void> {
  return withTransaction(db, async (tx) => {
    const existing = await findJobFamilyById(input.jobFamilyId, input.companyId, tx);
    if (!existing) throw new NotFoundError("JobFamily", input.jobFamilyId);

    // A family with positions classified into it is not hard-deletable —
    // clearing those positions' classification is the caller's decision,
    // not a silent side effect of deletion.
    const positionCount = await countPositionsInJobFamily(input.jobFamilyId, input.companyId, tx);
    if (positionCount > 0) {
      throw new ConflictError(
        `This job family is used by ${positionCount} position(s) and cannot be deleted.`
      );
    }

    try {
      // Career tracks and level-mapping entries cascade (schema onDelete).
      await tx.jobFamily.delete({ where: { id: input.jobFamilyId } });
    } catch (error) {
      throw translateWriteError(error, "JobFamily", existing.code);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "DELETED",
        category: "CAREER_FRAMEWORK",
        entityType: "JobFamily",
        entityId: existing.id,
        entityDisplayReference: existing.code,
        before: existing,
      },
      tx
    );
  });
}

// ── Career track ──────────────────────────────────────────────────────

const DEFAULT_TRACK_NAME: Record<CareerTrackKind, string> = {
  IC: "Individual Contributor",
  MANAGER: "Manager",
};

export interface CreateCareerTrackInput {
  companyId: string;
  actor?: AuditActor;
  jobFamilyId: string;
  kind: CareerTrackKind;
  name?: string | null;
  displayOrder?: number | null;
}

export async function createCareerTrack(
  input: CreateCareerTrackInput,
  db: DbClient = prisma
): Promise<CareerTrack> {
  return withTransaction(db, async (tx) => {
    const family = await findJobFamilyById(input.jobFamilyId, input.companyId, tx);
    if (!family) {
      throw new CrossCompanyError(
        `Job family ${input.jobFamilyId} does not exist in company ${input.companyId}.`
      );
    }

    const name = input.name?.trim() || DEFAULT_TRACK_NAME[input.kind];

    let created: CareerTrack;
    try {
      created = await tx.careerTrack.create({
        data: {
          companyId: input.companyId,
          jobFamilyId: input.jobFamilyId,
          kind: input.kind,
          name,
          displayOrder: input.displayOrder ?? null,
        },
      });
    } catch (error) {
      // The unique (company, family, kind) means a family can hold at most
      // one IC and one Manager track.
      throw translateWriteError(error, "CareerTrack", `${family.code}:${input.kind}`);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "CREATED",
        category: "CAREER_FRAMEWORK",
        entityType: "CareerTrack",
        entityId: created.id,
        entityDisplayReference: `${family.code}:${created.kind}`,
        after: created,
      },
      tx
    );
    return created;
  });
}

/**
 * The base "single ladder" of a family. Every family has one implicit
 * career ladder; we model it as its IC track. Most orgs never need the
 * IC-vs-Manager distinction, so the framework does not force it: a family
 * starts with no track rows, and the first title added materialises this
 * default ladder. Only a family that genuinely runs parallel IC and
 * manager ladders adds a second (Manager) track — see `addManagerLadder`.
 *
 * Idempotent: returns the existing IC track when one is already present.
 */
export async function ensureDefaultTrack(
  companyId: string,
  jobFamilyId: string,
  actor: AuditActor | undefined,
  db: DbClient = prisma
): Promise<CareerTrack> {
  return withTransaction(db, async (tx) => {
    const existing = await tx.careerTrack.findFirst({
      where: { companyId, jobFamilyId, kind: "IC" },
    });
    if (existing) return existing;
    return createCareerTrack({ companyId, actor, jobFamilyId, kind: "IC" }, tx);
  });
}

/**
 * Adds a parallel Manager ladder to a family, turning its single-ladder
 * matrix into the two-column IC/Manager form. The base (IC) ladder is
 * ensured first so the two columns always coexist. No-ops sensibly if a
 * Manager ladder already exists (the unique (company, family, kind) makes
 * the create a friendly conflict).
 */
export async function addManagerLadder(
  input: { companyId: string; actor?: AuditActor; jobFamilyId: string },
  db: DbClient = prisma
): Promise<CareerTrack> {
  return withTransaction(db, async (tx) => {
    await ensureDefaultTrack(input.companyId, input.jobFamilyId, input.actor, tx);
    return createCareerTrack(
      {
        companyId: input.companyId,
        actor: input.actor,
        jobFamilyId: input.jobFamilyId,
        kind: "MANAGER",
      },
      tx
    );
  });
}

export async function deleteCareerTrack(
  input: { companyId: string; actor?: AuditActor; careerTrackId: string },
  db: DbClient = prisma
): Promise<void> {
  return withTransaction(db, async (tx) => {
    const existing = await findCareerTrackById(input.careerTrackId, input.companyId, tx);
    if (!existing) throw new NotFoundError("CareerTrack", input.careerTrackId);

    // The IC track is the family's base ladder. While a parallel Manager
    // ladder exists it cannot be removed on its own (that would leave the
    // manager ladder orphaned as the base) — remove the manager ladder
    // first. Deleting the manager ladder, or the sole IC ladder, is fine.
    if (existing.kind === "IC") {
      const managerTrack = await tx.careerTrack.findFirst({
        where: { companyId: input.companyId, jobFamilyId: existing.jobFamilyId, kind: "MANAGER" },
      });
      if (managerTrack) {
        throw new ConflictError(
          "Remove the manager ladder before removing this family's base ladder."
        );
      }
    }

    const positionCount = await countPositionsInCareerTrack(
      input.careerTrackId,
      input.companyId,
      tx
    );
    if (positionCount > 0) {
      throw new ConflictError(
        `This career track is used by ${positionCount} position(s) and cannot be deleted.`
      );
    }

    try {
      await tx.careerTrack.delete({ where: { id: input.careerTrackId } });
    } catch (error) {
      throw translateWriteError(error, "CareerTrack", input.careerTrackId);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "DELETED",
        category: "CAREER_FRAMEWORK",
        entityType: "CareerTrack",
        entityId: existing.id,
        entityDisplayReference: `${existing.kind}`,
        before: existing,
      },
      tx
    );
  });
}

// ── Level-mapping entry ───────────────────────────────────────────────

export interface CreateLevelMappingEntryInput {
  companyId: string;
  actor?: AuditActor;
  jobFamilyId: string;
  /**
   * The ladder this title belongs to. Optional: omit it in single-ladder
   * mode and the family's default (IC) ladder is materialised and used.
   * Provide it only to target a specific ladder (e.g. the Manager ladder
   * of a family that runs both).
   */
  careerTrackId?: string | null;
  jobGradeId: string;
  title: string;
  displayOrder?: number | null;
}

export async function createLevelMappingEntry(
  input: CreateLevelMappingEntryInput,
  db: DbClient = prisma
): Promise<LevelMappingEntry> {
  return withTransaction(db, async (tx) => {
    // Every reference must live in the same company, and the track must
    // belong to the chosen family — a cross-family or cross-company cell
    // is meaningless in the matrix.
    const family = await findJobFamilyById(input.jobFamilyId, input.companyId, tx);
    if (!family) {
      throw new CrossCompanyError(
        `Job family ${input.jobFamilyId} does not exist in this company.`
      );
    }

    // Single-ladder mode: no track was chosen, so materialise/reuse the
    // family's default (IC) ladder. Otherwise validate the chosen track.
    let track: CareerTrack;
    if (!input.careerTrackId) {
      track = await ensureDefaultTrack(input.companyId, input.jobFamilyId, input.actor, tx);
    } else {
      const chosen = await findCareerTrackById(input.careerTrackId, input.companyId, tx);
      if (!chosen) {
        throw new CrossCompanyError(
          `Career track ${input.careerTrackId} does not exist in this company.`
        );
      }
      if (chosen.jobFamilyId !== input.jobFamilyId) {
        throw new ConflictError("The career track does not belong to the chosen job family.");
      }
      track = chosen;
    }

    const grade = await findJobGradeById(input.jobGradeId, input.companyId, tx);
    if (!grade) {
      throw new CrossCompanyError(`Level ${input.jobGradeId} does not exist in this company.`);
    }

    let created: LevelMappingEntry;
    try {
      created = await tx.levelMappingEntry.create({
        data: {
          companyId: input.companyId,
          jobFamilyId: input.jobFamilyId,
          careerTrackId: track.id,
          jobGradeId: input.jobGradeId,
          title: input.title.trim(),
          displayOrder: input.displayOrder ?? null,
        },
      });
    } catch (error) {
      throw translateWriteError(error, "LevelMappingEntry", input.title.trim());
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "CREATED",
        category: "CAREER_FRAMEWORK",
        entityType: "LevelMappingEntry",
        entityId: created.id,
        entityDisplayReference: created.title,
        after: created,
      },
      tx
    );
    return created;
  });
}

export async function deleteLevelMappingEntry(
  input: { companyId: string; actor?: AuditActor; levelMappingEntryId: string },
  db: DbClient = prisma
): Promise<void> {
  return withTransaction(db, async (tx) => {
    const existing = await findLevelMappingEntryById(
      input.levelMappingEntryId,
      input.companyId,
      tx
    );
    if (!existing) throw new NotFoundError("LevelMappingEntry", input.levelMappingEntryId);

    try {
      await tx.levelMappingEntry.delete({ where: { id: input.levelMappingEntryId } });
    } catch (error) {
      throw translateWriteError(error, "LevelMappingEntry", existing.title);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "DELETED",
        category: "CAREER_FRAMEWORK",
        entityType: "LevelMappingEntry",
        entityId: existing.id,
        entityDisplayReference: existing.title,
        before: existing,
      },
      tx
    );
  });
}
