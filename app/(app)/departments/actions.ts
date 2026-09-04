"use server";

import type { Department } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import {
  createDepartment,
  moveDepartment,
  archiveDepartment,
  reactivateDepartment,
  updateDepartment,
} from "@/lib/services/department.service";
import {
  listDepartmentsForCompany,
  searchDepartments,
  type DepartmentSearchResult,
} from "@/lib/repositories/department.repository";
import {
  createDepartmentSchema,
  departmentStatusChangeSchema,
  listDepartmentsQuerySchema,
  moveDepartmentSchema,
  updateDepartmentSchema,
  type ListDepartmentsQuery,
} from "@/lib/validation/department";

export async function listDepartmentsAction(
  input: ListDepartmentsQuery
): Promise<ActionResult<DepartmentSearchResult>> {
  return runAction(async () => {
    // Reads require only :view — never demand the :manage permission.
    const user = await requirePermission("departments:view");
    const query = listDepartmentsQuerySchema.parse(input);
    return searchDepartments({ companyId: user.companyId, ...query });
  });
}

/** All departments for the current company, for use in selects (e.g. the Position form's department picker) — unpaginated by design since department counts stay small (docs/DECISIONS.md P7 scale target is positions, not departments). */
export async function listAllDepartmentsAction(): Promise<ActionResult<Department[]>> {
  return runAction(async () => {
    const user = await requirePermission("departments:view");
    return listDepartmentsForCompany(user.companyId);
  });
}

export async function createDepartmentAction(input: unknown): Promise<ActionResult<Department>> {
  return runAction(async () => {
    const user = await requirePermission("departments:manage");
    const values = createDepartmentSchema.parse(input);
    return createDepartment({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function updateDepartmentAction(input: unknown): Promise<ActionResult<Department>> {
  return runAction(async () => {
    const user = await requirePermission("departments:manage");
    const values = updateDepartmentSchema.parse(input);
    return updateDepartment({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function moveDepartmentAction(input: unknown): Promise<ActionResult<Department>> {
  return runAction(async () => {
    const user = await requirePermission("departments:manage");
    const values = moveDepartmentSchema.parse(input);
    return moveDepartment({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function archiveDepartmentAction(input: unknown): Promise<ActionResult<Department>> {
  return runAction(async () => {
    const user = await requirePermission("departments:manage");
    const { departmentId } = departmentStatusChangeSchema.parse(input);
    return archiveDepartment(departmentId, user.companyId, toAuditActor(user));
  });
}

export async function reactivateDepartmentAction(
  input: unknown
): Promise<ActionResult<Department>> {
  return runAction(async () => {
    const user = await requirePermission("departments:manage");
    const { departmentId } = departmentStatusChangeSchema.parse(input);
    return reactivateDepartment(departmentId, user.companyId, toAuditActor(user));
  });
}
