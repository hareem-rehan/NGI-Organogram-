"use server";

import type { CareerTrack, JobFamily, JobGrade, LevelMappingEntry } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import {
  addManagerLadder,
  createCareerTrack,
  createJobFamily,
  createLevelMappingEntry,
  deleteCareerTrack,
  deleteJobFamily,
  deleteLevelMappingEntry,
  updateJobFamily,
} from "@/lib/services/career-framework.service";
import {
  deleteLevelByCode,
  provisionStandardLevel,
  provisionStandardLevels,
  removeUnusedLevels,
} from "@/lib/services/job-grade.service";
import {
  listCareerTracksForCompany,
  listJobFamiliesForCompany,
  listLevelMappingEntriesForCompany,
} from "@/lib/repositories/career-framework.repository";
import {
  getJobGradeUsageCounts,
  listJobGradesForCompany,
} from "@/lib/repositories/job-grade.repository";
import {
  addLevelSchema,
  addManagerLadderSchema,
  createCareerTrackSchema,
  createJobFamilySchema,
  createLevelMappingEntrySchema,
  deleteCareerTrackSchema,
  deleteJobFamilySchema,
  deleteLevelMappingEntrySchema,
  deleteLevelSchema,
  updateJobFamilySchema,
} from "@/lib/validation/career-framework";

/** Per-level usage, keyed by the level CODE (e.g. "L7") so the panel matches the deduped picker. */
export type JobGradeUsageByCode = Record<string, { positionCount: number; titleCount: number }>;

export interface CareerFrameworkData {
  jobFamilies: JobFamily[];
  careerTracks: CareerTrack[];
  levelMappingEntries: LevelMappingEntry[];
  jobGrades: JobGrade[];
  /** How many positions / titles use each level code — drives the Levels panel. */
  levelUsageByCode: JobGradeUsageByCode;
}

/** Reloads the whole framework for the matrix after any mutation. Reads require only :view. */
export async function getCareerFrameworkAction(): Promise<ActionResult<CareerFrameworkData>> {
  return runAction(async () => {
    const user = await requirePermission("career:view");
    const [jobFamilies, careerTracks, levelMappingEntries, jobGrades, usageById] =
      await Promise.all([
        listJobFamiliesForCompany(user.companyId),
        listCareerTracksForCompany(user.companyId),
        listLevelMappingEntriesForCompany(user.companyId),
        listJobGradesForCompany(user.companyId),
        getJobGradeUsageCounts(user.companyId),
      ]);
    // Roll per-grade usage up to per-CODE, so a level's total is correct even
    // when it exists as both a company-wide and a per-department grade.
    const levelUsageByCode: JobGradeUsageByCode = {};
    for (const grade of jobGrades) {
      const u = usageById.get(grade.id);
      const bucket = (levelUsageByCode[grade.code] ??= { positionCount: 0, titleCount: 0 });
      if (u) {
        bucket.positionCount += u.positionCount;
        bucket.titleCount += u.titleCount;
      }
    }
    return { jobFamilies, careerTracks, levelMappingEntries, jobGrades, levelUsageByCode };
  });
}

// ── Sub-division ────────────────────────────────────────────────────────

export async function createJobFamilyAction(input: unknown): Promise<ActionResult<JobFamily>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const values = createJobFamilySchema.parse(input);
    return createJobFamily({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function updateJobFamilyAction(input: unknown): Promise<ActionResult<JobFamily>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const values = updateJobFamilySchema.parse(input);
    return updateJobFamily({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function deleteJobFamilyAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const { jobFamilyId } = deleteJobFamilySchema.parse(input);
    await deleteJobFamily({ companyId: user.companyId, actor: toAuditActor(user), jobFamilyId });
    return null;
  });
}

// ── Career track ──────────────────────────────────────────────────────

export async function createCareerTrackAction(input: unknown): Promise<ActionResult<CareerTrack>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const values = createCareerTrackSchema.parse(input);
    return createCareerTrack({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function deleteCareerTrackAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const { careerTrackId } = deleteCareerTrackSchema.parse(input);
    await deleteCareerTrack({
      companyId: user.companyId,
      actor: toAuditActor(user),
      careerTrackId,
    });
    return null;
  });
}

/**
 * Turns a single-ladder family into the two-column IC/Manager form by
 * adding a parallel Manager ladder (the base IC ladder is ensured too).
 */
export async function addManagerLadderAction(input: unknown): Promise<ActionResult<CareerTrack>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const { jobFamilyId } = addManagerLadderSchema.parse(input);
    return addManagerLadder({ companyId: user.companyId, actor: toAuditActor(user), jobFamilyId });
  });
}

// ── Level-mapping entry ───────────────────────────────────────────────

export async function createLevelMappingEntryAction(
  input: unknown
): Promise<ActionResult<LevelMappingEntry>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const values = createLevelMappingEntrySchema.parse(input);
    return createLevelMappingEntry({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
    });
  });
}

export async function deleteLevelMappingEntryAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const { levelMappingEntryId } = deleteLevelMappingEntrySchema.parse(input);
    await deleteLevelMappingEntry({
      companyId: user.companyId,
      actor: toAuditActor(user),
      levelMappingEntryId,
    });
    return null;
  });
}

// ── Levels (job grades) ───────────────────────────────────────────────

/**
 * One-click provisioning of the standard L2–L18 level scale for the
 * company. Surfaced on the Career Framework screen when no levels exist
 * yet, so a fresh company can fill its Level picker without depending on
 * the seed. :manage only — creating reference data is an admin action.
 */
export async function provisionStandardLevelsAction(): Promise<ActionResult<{ created: number }>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const { created } = await provisionStandardLevels(user.companyId, toAuditActor(user));
    return { created: created.length };
  });
}

/** Adds a single standard level (by code) as a company-wide level — the Levels panel's "Add a level" picker. :manage only. */
export async function addLevelAction(input: unknown): Promise<ActionResult<{ code: string }>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const { code } = addLevelSchema.parse(input);
    const grade = await provisionStandardLevel(user.companyId, code, toAuditActor(user));
    return { code: grade.code };
  });
}

/**
 * Removes a level by code. Re-authorized and re-validated here regardless of
 * the client (CLAUDE.md §1.8); the service refuses any level still used by a
 * position or a career-matrix title, so a level in use can never be removed.
 */
export async function deleteLevelAction(
  input: unknown
): Promise<ActionResult<{ deletedCount: number }>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const { code } = deleteLevelSchema.parse(input);
    return deleteLevelByCode(user.companyId, code, toAuditActor(user));
  });
}

/** One-click removal of every level nothing references — trims the standard scale down to what the company uses. :manage only. */
export async function removeUnusedLevelsAction(): Promise<
  ActionResult<{ removedCodes: string[] }>
> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    return removeUnusedLevels(user.companyId, toAuditActor(user));
  });
}
