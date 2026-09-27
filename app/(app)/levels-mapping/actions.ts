"use server";

import type { DepartmentLevelTitle } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import { listDepartmentLevelTitlesForCompany } from "@/lib/repositories/department-level-title.repository";
import {
  createDepartmentLevelTitle,
  deleteDepartmentLevelTitle,
  updateDepartmentLevelTitle,
} from "@/lib/services/department-level-title.service";
import {
  createDepartmentLevelTitleSchema,
  deleteDepartmentLevelTitleSchema,
  updateDepartmentLevelTitleSchema,
} from "@/lib/validation/levels-mapping";

/** Reloads the whole Levels Mapping grid after any mutation. Reads require only :view. */
export async function getLevelsMappingAction(): Promise<ActionResult<DepartmentLevelTitle[]>> {
  return runAction(async () => {
    const user = await requirePermission("career:view");
    return listDepartmentLevelTitlesForCompany(user.companyId);
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
