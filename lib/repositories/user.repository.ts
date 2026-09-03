import "server-only";
import type { Prisma, User, UserRole, UserStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

export async function findUserById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<User | null> {
  return db.user.findFirst({ where: { id, companyId } });
}

export async function findUserByEmail(email: string, db: DbClient = prisma): Promise<User | null> {
  return db.user.findUnique({ where: { email } });
}

export interface ListUsersFilters {
  companyId: string;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  linked?: "linked" | "unlinked";
  skip: number;
  take: number;
}

export async function listUsers(
  filters: ListUsersFilters,
  db: DbClient = prisma
): Promise<{ users: User[]; total: number }> {
  const where: Prisma.UserWhereInput = {
    companyId: filters.companyId,
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.linked === "linked" ? { linkedEmployeeId: { not: null } } : {}),
    ...(filters.linked === "unlinked" ? { linkedEmployeeId: null } : {}),
    ...(filters.search
      ? {
          OR: [
            { email: { contains: filters.search, mode: "insensitive" } },
            { name: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { email: "asc" }, skip: filters.skip, take: filters.take }),
    db.user.count({ where }),
  ]);
  return { users, total };
}

export interface CreateUserInput {
  companyId: string;
  email: string;
  name: string | null;
  role: UserRole;
  linkedEmployeeId: string | null;
}

export async function createUser(input: CreateUserInput, db: DbClient = prisma): Promise<User> {
  return db.user.create({
    data: {
      companyId: input.companyId,
      email: input.email,
      name: input.name,
      role: input.role,
      status: "ACTIVE",
      linkedEmployeeId: input.linkedEmployeeId,
    },
  });
}

export async function updateUser(
  id: string,
  data: Prisma.UserUncheckedUpdateInput,
  db: DbClient = prisma
): Promise<User> {
  return db.user.update({ where: { id }, data });
}

/**
 * Locks every currently-ACTIVE ADMIN row in the company for the rest of
 * the transaction — the mechanism last-admin protection relies on
 * (docs/adr's Phase 12 concurrency section, Step 19). Two concurrent
 * requests each trying to disable/demote a different admin (with only
 * two admins total) serialize behind this lock: the first to acquire it
 * sees both admins, proceeds, and the second — now blocked until the
 * first commits — re-reads the (now smaller) active-admin set and
 * correctly refuses if it would reach zero.
 */
export async function lockActiveAdmins(
  companyId: string,
  tx: Prisma.TransactionClient
): Promise<{ id: string }[]> {
  return tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "users"
    WHERE "companyId" = ${companyId}::uuid AND role = 'ADMIN' AND status = 'ACTIVE'
    FOR UPDATE
  `;
}

/** Deletes every Session row for a user — explicit, immediate revocation on disable (Step 13), on top of the database-session strategy's own "next request re-reads status" propagation (ADR-0012). */
export async function deleteUserSessions(userId: string, db: DbClient = prisma): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}
