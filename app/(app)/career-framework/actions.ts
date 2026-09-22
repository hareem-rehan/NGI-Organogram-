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
import { provisionStandardLevels } from "@/lib/services/job-grade.service";
import {
  listCareerTracksForCompany,
  listJobFamiliesForCompany,
  listLevelMappingEntriesForCompany,
} from "@/lib/repositories/career-framework.repository";
import { listJobGradesForCompany } from "@/lib/repositories/job-grade.repository";
import {
  addManagerLadderSchema,
  createCareerTrackSchema,
  createJobFamilySchema,
  createLevelMappingEntrySchema,
  deleteCareerTrackSchema,
  deleteJobFamilySchema,
  deleteLevelMappingEntrySchema,
  updateJobFamilySchema,
} from "@/lib/validation/career-framework";

export interface CareerFrameworkData {
  jobFamilies: JobFamily[];
  careerTracks: CareerTrack[];
  levelMappingEntries: LevelMappingEntry[];
  jobGrades: JobGrade[];
}

/** Reloads the whole framework for the matrix after any mutation. Reads require only :view. */
export async function getCareerFrameworkAction(): Promise<ActionResult<CareerFrameworkData>> {
  return runAction(async () => {
    const user = await requirePermission("career:view");
    const [jobFamilies, careerTracks, levelMappingEntries, jobGrades] = await Promise.all([
      listJobFamiliesForCompany(user.companyId),
      listCareerTracksForCompany(user.companyId),
      listLevelMappingEntriesForCompany(user.companyId),
      listJobGradesForCompany(user.companyId),
    ]);
    return { jobFamilies, careerTracks, levelMappingEntries, jobGrades };
  });
}

// ── Job family ────────────────────────────────────────────────────────

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
