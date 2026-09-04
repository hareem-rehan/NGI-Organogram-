"use server";

import type { User } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import {
  changeUserRole,
  disableUser,
  getUser,
  linkEmployee,
  listUsers,
  provisionUser,
  reactivateUser,
  unlinkEmployee,
} from "@/lib/services/user-admin.service";
import { searchEmployees, type EmployeeSearchResult } from "@/lib/repositories/employee.repository";
import {
  changeUserRoleSchema,
  disableUserSchema,
  linkEmployeeSchema,
  listUsersQuerySchema,
  provisionUserSchema,
  userIdSchema,
} from "@/lib/validation/user-admin";

export async function listUsersAction(
  input: unknown
): Promise<ActionResult<Awaited<ReturnType<typeof listUsers>>>> {
  return runAction(async () => {
    const user = await requirePermission("users:manage");
    const query = listUsersQuerySchema.parse(input);
    return listUsers({ companyId: user.companyId, ...query });
  });
}

export async function getUserAction(input: unknown): Promise<ActionResult<User>> {
  return runAction(async () => {
    const user = await requirePermission("users:manage");
    const { userId } = userIdSchema.parse(input);
    return getUser(userId, user.companyId);
  });
}

/** For the "Link Employee" picker — reuses the same search the Employees module itself uses. */
export async function searchEmployeesForLinkingAction(
  search: string | undefined
): Promise<ActionResult<EmployeeSearchResult>> {
  return runAction(async () => {
    const user = await requirePermission("users:manage");
    return searchEmployees({ companyId: user.companyId, search, page: 1, pageSize: 20 });
  });
}

export async function provisionUserAction(input: unknown): Promise<ActionResult<User>> {
  return runAction(async () => {
    const user = await requirePermission("users:manage");
    const values = provisionUserSchema.parse(input);
    return provisionUser({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function changeUserRoleAction(input: unknown): Promise<ActionResult<User>> {
  return runAction(async () => {
    const user = await requirePermission("users:manage");
    const values = changeUserRoleSchema.parse(input);
    return changeUserRole({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function disableUserAction(input: unknown): Promise<ActionResult<User>> {
  return runAction(async () => {
    const user = await requirePermission("users:manage");
    const values = disableUserSchema.parse(input);
    return disableUser({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function reactivateUserAction(input: unknown): Promise<ActionResult<User>> {
  return runAction(async () => {
    const user = await requirePermission("users:manage");
    const { userId } = userIdSchema.parse(input);
    return reactivateUser({ companyId: user.companyId, actor: toAuditActor(user), userId });
  });
}

export async function linkEmployeeAction(input: unknown): Promise<ActionResult<User>> {
  return runAction(async () => {
    const user = await requirePermission("users:manage");
    const values = linkEmployeeSchema.parse(input);
    return linkEmployee({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function unlinkEmployeeAction(input: unknown): Promise<ActionResult<User>> {
  return runAction(async () => {
    const user = await requirePermission("users:manage");
    const { userId } = userIdSchema.parse(input);
    return unlinkEmployee({ companyId: user.companyId, actor: toAuditActor(user), userId });
  });
}
