"use server";

import type { Company, CompanySettings, JobGrade } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import { findCompanyById } from "@/lib/repositories/company.repository";
import { NotFoundError } from "@/lib/domain/errors";
import {
  getAuthDisplaySettings,
  getOrCreateSettings,
  updateCompanyProfile,
  updateSettings,
  type AuthDisplaySettings,
} from "@/lib/services/settings.service";
import {
  deleteLevelByCode,
  provisionStandardLevel,
  provisionStandardLevels,
  removeUnusedLevels,
} from "@/lib/services/job-grade.service";
import {
  getJobGradeUsageCounts,
  listJobGradesForCompany,
} from "@/lib/repositories/job-grade.repository";
import { addLevelSchema, deleteLevelSchema } from "@/lib/validation/career-framework";
import { updateCompanyProfileSchema, updateSettingsSchema } from "@/lib/validation/settings";

export interface SettingsPagePayload {
  company: Company;
  settings: CompanySettings;
  auth: AuthDisplaySettings;
}

/** Per-level usage keyed by level CODE (e.g. "L7") — drives the Levels section's usage display. */
export type JobGradeUsageByCode = Record<string, { positionCount: number; titleCount: number }>;

export interface CompanyLevelsPayload {
  jobGrades: JobGrade[];
  levelUsageByCode: JobGradeUsageByCode;
}

export async function getSettingsAction(): Promise<ActionResult<SettingsPagePayload>> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    const company = await findCompanyById(user.companyId);
    if (!company) throw new NotFoundError("Company", user.companyId);
    const settings = await getOrCreateSettings(user.companyId);
    return { company, settings, auth: getAuthDisplaySettings() };
  });
}

export async function updateCompanyProfileAction(input: unknown): Promise<ActionResult<Company>> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    const values = updateCompanyProfileSchema.parse(input);
    return updateCompanyProfile({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
    });
  });
}

export async function updateSettingsAction(input: unknown): Promise<ActionResult<CompanySettings>> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    const values = updateSettingsSchema.parse(input);
    return updateSettings({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

// ── Levels (job-grade scale) ──────────────────────────────────────────
// The company-wide seniority scale used by the Position form and the
// organogram. Managed here in Settings (a company-config surface); gated on
// settings:manage, so this is an ADMIN capability. Career progression titles
// still reference levels, but the level SCALE is curated here.

/** The company's levels plus per-code usage, for the Settings "Levels" section. */
export async function getCompanyLevelsAction(): Promise<ActionResult<CompanyLevelsPayload>> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    const [jobGrades, usageById] = await Promise.all([
      listJobGradesForCompany(user.companyId),
      getJobGradeUsageCounts(user.companyId),
    ]);
    // Roll per-grade usage up to per-code (correct whether a level exists
    // company-wide or per-department).
    const levelUsageByCode: JobGradeUsageByCode = {};
    for (const grade of jobGrades) {
      const u = usageById.get(grade.id);
      const bucket = (levelUsageByCode[grade.code] ??= { positionCount: 0, titleCount: 0 });
      if (u) {
        bucket.positionCount += u.positionCount;
        bucket.titleCount += u.titleCount;
      }
    }
    return { jobGrades, levelUsageByCode };
  });
}

/** One-click provisioning of the full standard L2–L18 scale. settings:manage only. */
export async function provisionStandardLevelsAction(): Promise<ActionResult<{ created: number }>> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    const { created } = await provisionStandardLevels(user.companyId, toAuditActor(user));
    return { created: created.length };
  });
}

/** Adds a single standard level (by code) as a company-wide level. settings:manage only. */
export async function addLevelAction(input: unknown): Promise<ActionResult<{ code: string }>> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    const { code } = addLevelSchema.parse(input);
    const grade = await provisionStandardLevel(user.companyId, code, toAuditActor(user));
    return { code: grade.code };
  });
}

/**
 * Removes a level by code. Re-authorized and re-validated here regardless of
 * the client (CLAUDE.md §1.8); the service refuses any level still used by a
 * position or a career-matrix title.
 */
export async function deleteLevelAction(
  input: unknown
): Promise<ActionResult<{ deletedCount: number }>> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    const { code } = deleteLevelSchema.parse(input);
    return deleteLevelByCode(user.companyId, code, toAuditActor(user));
  });
}

/** One-click removal of every level nothing references. settings:manage only. */
export async function removeUnusedLevelsAction(): Promise<
  ActionResult<{ removedCodes: string[] }>
> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    return removeUnusedLevels(user.companyId, toAuditActor(user));
  });
}
