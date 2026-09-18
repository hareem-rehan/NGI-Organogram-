import "server-only";
import type { User, UserRole, UserStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { serverEnv } from "@/lib/env.server";
import { assertEmailDomainAllowed } from "@/lib/auth/identity-validation";
import { normalizeWorkEmail } from "@/lib/domain/normalize";
import {
  ConflictError,
  DomainValidationError,
  LastAdminError,
  NotFoundError,
  StaleUpdateError,
} from "@/lib/domain/errors";
import { DEFAULT_USER_PAGE_SIZE, MAX_USER_PAGE_SIZE } from "@/lib/domain/user-admin-pagination";
import { findEmployeeById } from "@/lib/repositories/employee.repository";
import {
  createUser,
  deleteUserSessions,
  findUserByEmail,
  findUserById,
  listUsers as listUsersRepo,
  lockActiveAdmins,
  updateUser,
  type ListUsersFilters,
} from "@/lib/repositories/user.repository";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

/**
 * ADR-0014: this is the second, in-app path to grant/change roles and
 * disable/reactivate users, alongside `scripts/provision-user.ts` — safe
 * specifically because every function here requires an ALREADY-
 * authenticated `ADMIN` caller (enforced by `requirePermission
 * ("users:manage")` at the action layer, never here) and is fully
 * audited, closing the loop ADR-0011 originally worried about.
 */

export interface ProvisionUserInput {
  companyId: string;
  actor: AuditActor;
  email: string;
  displayName?: string | null;
  role: UserRole;
  linkedEmployeeId?: string | null;
}

/**
 * Creates a new User row — no password, ever (this app has no
 * credentials provider). The user gains real access only the next time
 * they successfully sign in through Company SSO (`lib/services/
 * user.service.ts`'s `resolveOrProvisionUserForSignIn`, which finds this
 * pre-provisioned row by email and links the SSO Account to it) — this
 * function only reserves the identity and its role, it does not create a
 * session.
 */
export async function provisionUser(input: ProvisionUserInput): Promise<User> {
  const email = normalizeWorkEmail(input.email);
  if (!email) throw new DomainValidationError("A valid email address is required.");
  assertEmailDomainAllowed(email, serverEnv.AUTH_ALLOWED_EMAIL_DOMAINS);

  return withTransaction(prisma, async (tx) => {
    const existing = await findUserByEmail(email, tx);
    if (existing) {
      throw new ConflictError(`A user with email "${email}" already exists.`);
    }

    let linkedEmployeeId: string | null = null;
    if (input.linkedEmployeeId) {
      const employee = await findEmployeeById(input.linkedEmployeeId, input.companyId, tx);
      if (!employee) {
        throw new DomainValidationError(
          `Employee ${input.linkedEmployeeId} does not exist in this company.`
        );
      }
      if (employee.employmentStatus === "TERMINATED") {
        throw new DomainValidationError(
          "Cannot link a new user to a terminated employee. Choose an active employee, or leave unlinked."
        );
      }
      const alreadyLinked = await tx.user.findUnique({ where: { linkedEmployeeId: employee.id } });
      if (alreadyLinked) {
        throw new ConflictError(`Employee ${employee.id} is already linked to another user.`);
      }
      linkedEmployeeId = employee.id;
    }

    const user = await createUser(
      {
        companyId: input.companyId,
        email,
        name: input.displayName?.trim() || null,
        role: input.role,
        linkedEmployeeId,
      },
      tx
    );

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor,
        action: "USER_PROVISIONED",
        category: "USER_ADMINISTRATION",
        entityType: "User",
        entityId: user.id,
        entityDisplayReference: user.email,
        after: user,
        metadata: { linkedEmployeeId },
      },
      tx
    );
    return user;
  });
}

export interface ListUsersInput {
  companyId: string;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  linked?: "linked" | "unlinked";
  page?: number;
  pageSize?: number;
}

export { MAX_USER_PAGE_SIZE, DEFAULT_USER_PAGE_SIZE };

export async function listUsers(
  input: ListUsersInput
): Promise<{ users: User[]; total: number; page: number; pageSize: number }> {
  const page = input.page && input.page > 0 ? Math.floor(input.page) : 1;
  const pageSize =
    input.pageSize && input.pageSize > 0
      ? Math.min(Math.floor(input.pageSize), MAX_USER_PAGE_SIZE)
      : DEFAULT_USER_PAGE_SIZE;

  const filters: ListUsersFilters = {
    companyId: input.companyId,
    search: input.search,
    role: input.role,
    status: input.status,
    linked: input.linked,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
  const { users, total } = await listUsersRepo(filters);
  return { users, total, page, pageSize };
}

export async function getUser(id: string, companyId: string): Promise<User> {
  const user = await findUserById(id, companyId);
  if (!user) throw new NotFoundError("User", id);
  return user;
}

/**
 * The core last-admin guard, shared by role changes and disabling. Must
 * run AFTER `lockActiveAdmins` has already taken its row lock in the
 * SAME transaction — the lock, not this check alone, is what makes two
 * concurrent requests safe (Step 19: "enforced inside the transaction,
 * not only through a pre-check").
 */
function assertNotLastActiveAdmin(
  target: User,
  activeAdminIds: readonly { id: string }[],
  willRemainActiveAdmin: boolean
): void {
  if (target.role !== "ADMIN" || target.status !== "ACTIVE") return;
  if (willRemainActiveAdmin) return;
  if (activeAdminIds.length <= 1) {
    throw new LastAdminError(
      "This company must always have at least one active ADMIN — this action would leave zero. Promote or reactivate another ADMIN first."
    );
  }
}

export interface ChangeUserRoleInput {
  userId: string;
  companyId: string;
  actor: AuditActor;
  newRole: UserRole;
  /** Optimistic concurrency (Step 12.9/19) — when supplied, the update is rejected with `StaleUpdateError` if the row changed since the caller last read it. */
  expectedUpdatedAt?: Date;
}

export async function changeUserRole(input: ChangeUserRoleInput): Promise<User> {
  return withTransaction(prisma, async (tx) => {
    const activeAdmins = await lockActiveAdmins(input.companyId, tx);
    const target = await findUserById(input.userId, input.companyId, tx);
    if (!target) throw new NotFoundError("User", input.userId);

    if (
      input.expectedUpdatedAt &&
      target.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new StaleUpdateError();
    }

    assertNotLastActiveAdmin(target, activeAdmins, input.newRole === "ADMIN");

    if (target.role === input.newRole) return target;

    const updated = await updateUser(input.userId, { role: input.newRole }, tx);

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor,
        action: "ROLE_CHANGED",
        category: "USER_ADMINISTRATION",
        entityType: "User",
        entityId: updated.id,
        entityDisplayReference: updated.email,
        before: target,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export interface DisableUserInput {
  userId: string;
  companyId: string;
  actor: AuditActor;
  expectedUpdatedAt?: Date;
}

export async function disableUser(input: DisableUserInput): Promise<User> {
  return withTransaction(prisma, async (tx) => {
    const activeAdmins = await lockActiveAdmins(input.companyId, tx);
    const target = await findUserById(input.userId, input.companyId, tx);
    if (!target) throw new NotFoundError("User", input.userId);

    if (
      input.expectedUpdatedAt &&
      target.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new StaleUpdateError();
    }

    if (target.status === "DISABLED") return target;

    assertNotLastActiveAdmin(target, activeAdmins, false);

    const updated = await updateUser(input.userId, { status: "DISABLED" }, tx);
    await deleteUserSessions(input.userId, tx);

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor,
        action: "USER_DISABLED",
        category: "USER_ADMINISTRATION",
        entityType: "User",
        entityId: updated.id,
        entityDisplayReference: updated.email,
        before: target,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export interface ReactivateUserInput {
  userId: string;
  companyId: string;
  actor: AuditActor;
}

/** Reactivating never elevates the role — the user comes back with whatever role they had before being disabled. */
export async function reactivateUser(input: ReactivateUserInput): Promise<User> {
  return withTransaction(prisma, async (tx) => {
    const target = await findUserById(input.userId, input.companyId, tx);
    if (!target) throw new NotFoundError("User", input.userId);
    if (target.status === "ACTIVE") return target;

    const updated = await updateUser(input.userId, { status: "ACTIVE" }, tx);

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor,
        action: "USER_REACTIVATED",
        category: "USER_ADMINISTRATION",
        entityType: "User",
        entityId: updated.id,
        entityDisplayReference: updated.email,
        before: target,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export interface LinkEmployeeInput {
  userId: string;
  companyId: string;
  actor: AuditActor;
  employeeId: string;
}

/**
 * Links a User to an Employee — never changes role, assignment,
 * employment status, or SSO identity (Step 14). Both same-company
 * membership and "at most one link each way" are additionally enforced
 * at the database level (User.linkedEmployeeId's composite FK +
 * `@@unique` — see prisma/schema.prisma), so this check is defense in
 * depth, not the only guarantee, and a race is resolved by the
 * database's own unique-constraint violation, translated to a clean
 * `ConflictError` rather than a raw Prisma error.
 */
export async function linkEmployee(input: LinkEmployeeInput): Promise<User> {
  return withTransaction(prisma, async (tx) => {
    const user = await findUserById(input.userId, input.companyId, tx);
    if (!user) throw new NotFoundError("User", input.userId);

    const employee = await findEmployeeById(input.employeeId, input.companyId, tx);
    if (!employee) {
      throw new DomainValidationError(
        `Employee ${input.employeeId} does not exist in this company.`
      );
    }
    if (employee.employmentStatus === "TERMINATED") {
      throw new DomainValidationError("Cannot link to a terminated employee.");
    }

    const alreadyLinked = await tx.user.findUnique({ where: { linkedEmployeeId: employee.id } });
    if (alreadyLinked && alreadyLinked.id !== user.id) {
      throw new ConflictError(`Employee ${employee.id} is already linked to another user.`);
    }

    let updated: User;
    try {
      updated = await updateUser(input.userId, { linkedEmployeeId: employee.id }, tx);
    } catch {
      throw new ConflictError(`Employee ${employee.id} is already linked to another user.`);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor,
        action: "USER_LINKED_TO_EMPLOYEE",
        category: "USER_ADMINISTRATION",
        entityType: "User",
        entityId: updated.id,
        entityDisplayReference: updated.email,
        before: user,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export interface UnlinkEmployeeInput {
  userId: string;
  companyId: string;
  actor: AuditActor;
}

/** Never disables the User and never changes the Employee's own status (Step 14.8/14.9). */
export async function unlinkEmployee(input: UnlinkEmployeeInput): Promise<User> {
  return withTransaction(prisma, async (tx) => {
    const user = await findUserById(input.userId, input.companyId, tx);
    if (!user) throw new NotFoundError("User", input.userId);
    if (!user.linkedEmployeeId) return user;

    const updated = await updateUser(input.userId, { linkedEmployeeId: null }, tx);

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor,
        action: "USER_UNLINKED_FROM_EMPLOYEE",
        category: "USER_ADMINISTRATION",
        entityType: "User",
        entityId: updated.id,
        entityDisplayReference: updated.email,
        before: user,
        after: updated,
      },
      tx
    );
    return updated;
  });
}
