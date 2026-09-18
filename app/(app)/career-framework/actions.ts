"use server";

import type { CareerTrack, JobFamily, LevelMappingEntry } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import {
  createCareerTrack,
  createJobFamily,
  createLevelMappingEntry,
  deleteCareerTrack,
  deleteJobFamily,
  deleteLevelMappingEntry,
  updateJobFamily,
} from "@/lib/services/career-framework.service";
import {
  listCareerTracksForCompany,
  listJobFamiliesForCompany,
  listLevelMappingEntriesForCompany,
} from "@/lib/repositories/career-framework.repository";
import {
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
}

/** Reloads the whole framework for the matrix after any mutation. Reads require only :view. */
export async function getCareerFrameworkAction(): Promise<ActionResult<CareerFrameworkData>> {
  return runAction(async () => {
    const user = await requirePermission("career:view");
    const [jobFamilies, careerTracks, levelMappingEntries] = await Promise.all([
      listJobFamiliesForCompany(user.companyId),
      listCareerTracksForCompany(user.companyId),
      listLevelMappingEntriesForCompany(user.companyId),
    ]);
    return { jobFamilies, careerTracks, levelMappingEntries };
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
