"use server";

import type {
  Department,
  DepartmentLevelTitle,
  JobFamily,
  JobFamilyLevelTitle,
} from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import { listDepartmentLevelTitlesForCompany } from "@/lib/repositories/department-level-title.repository";
import { listJobFamilyLevelTitlesForCompany } from "@/lib/repositories/job-family-level-title.repository";
import {
  createDepartmentLevelTitle,
  deleteDepartmentLevelTitle,
  updateDepartmentLevelTitle,
} from "@/lib/services/department-level-title.service";
import {
  createJobFamilyLevelTitle,
  deleteJobFamilyLevelTitle,
  setLevelsMappingColumnVisibility,
  updateJobFamilyLevelTitle,
} from "@/lib/services/job-family-level-title.service";
import {
  createDepartmentLevelTitleSchema,
  createJobFamilyLevelTitleSchema,
  deleteDepartmentLevelTitleSchema,
  deleteJobFamilyLevelTitleSchema,
  setLevelsMappingColumnSchema,
  updateDepartmentLevelTitleSchema,
  updateJobFamilyLevelTitleSchema,
} from "@/lib/validation/levels-mapping";

export interface LevelsMappingTitles {
  departmentTitles: DepartmentLevelTitle[];
  subDivisionTitles: JobFamilyLevelTitle[];
}

/** Reloads every level name on the grid after any mutation. Reads require only :view. */
export async function getLevelsMappingAction(): Promise<ActionResult<LevelsMappingTitles>> {
  return runAction(async () => {
    const user = await requirePermission("career:view");
    const [departmentTitles, subDivisionTitles] = await Promise.all([
      listDepartmentLevelTitlesForCompany(user.companyId),
      listJobFamilyLevelTitlesForCompany(user.companyId),
    ]);
    return { departmentTitles, subDivisionTitles };
  });
}

export async function createDepartmentLevelTitleAction(
  input: unknown
): Promise<ActionResult<DepartmentLevelTitle>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const values = createDepartmentLevelTitleSchema.parse(input);
    return createDepartmentLevelTitle({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
    });
  });
}

export async function updateDepartmentLevelTitleAction(
  input: unknown
): Promise<ActionResult<DepartmentLevelTitle>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const values = updateDepartmentLevelTitleSchema.parse(input);
    return updateDepartmentLevelTitle({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
    });
  });
}

export async function deleteDepartmentLevelTitleAction(
  input: unknown
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const { id } = deleteDepartmentLevelTitleSchema.parse(input);
    await deleteDepartmentLevelTitle({ companyId: user.companyId, actor: toAuditActor(user), id });
    return null;
  });
}

export async function createJobFamilyLevelTitleAction(
  input: unknown
): Promise<ActionResult<JobFamilyLevelTitle>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const values = createJobFamilyLevelTitleSchema.parse(input);
    return createJobFamilyLevelTitle({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
    });
  });
}

export async function updateJobFamilyLevelTitleAction(
  input: unknown
): Promise<ActionResult<JobFamilyLevelTitle>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const values = updateJobFamilyLevelTitleSchema.parse(input);
    return updateJobFamilyLevelTitle({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
    });
  });
}

export async function deleteJobFamilyLevelTitleAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const { id } = deleteJobFamilyLevelTitleSchema.parse(input);
    await deleteJobFamilyLevelTitle({ companyId: user.companyId, actor: toAuditActor(user), id });
    return null;
  });
}

/** Show or hide a department's / sub-division's columns (docs/DECISIONS.md D34). */
export async function setLevelsMappingColumnAction(
  input: unknown
): Promise<ActionResult<Department | JobFamily>> {
  return runAction(async () => {
    const user = await requirePermission("career:manage");
    const values = setLevelsMappingColumnSchema.parse(input);
    return setLevelsMappingColumnVisibility({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
    });
  });
}
