import "server-only";
import type { Department, Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { normalizeCode } from "@/lib/domain/normalize";
import { wouldCreateCycle } from "@/lib/domain/hierarchy";
import {
  ConflictError,
  CrossCompanyError,
  CycleError,
  NotFoundError,
  UnsafeMutationError,
} from "@/lib/domain/errors";
import {
  countChildDepartments,
  countPositionsInDepartment,
  findDepartmentById,
  getDepartmentAncestorChain,
} from "@/lib/repositories/department.repository";
import type { DbClient } from "@/lib/repositories/types";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const FOREIGN_KEY_VIOLATION = "P2003";
const RECORD_NOT_FOUND = "P2025";

export interface CreateDepartmentInput {
  companyId: string;
  actor?: AuditActor;
  name: string;
  code: string;
  description?: string | null;
  color?: string | null;
  parentDepartmentId?: string | null;
  displayOrder?: number | null;
}

/**
 * Validates and creates a department. Parent-cycle/company checks and the
 * insert happen inside one transaction so a concurrent write can't slip a
 * cycle in between the check and the write (docs/DOMAIN_MODEL.md §7).
 *
 * `db` composes this call inside a caller's own outer transaction (e.g.
 * Phase 10's CSV import commit, which must apply many rows atomically) —
 * omit it for the default standalone-transaction behavior every existing
 * caller already relies on.
 */
export async function createDepartment(
  input: CreateDepartmentInput,
  db: DbClient = prisma
): Promise<Department> {
  const code = normalizeCode(input.code);

  return withTransaction(db, async (tx) => {
    if (input.parentDepartmentId) {
      await assertValidParentDepartment(input.companyId, input.parentDepartmentId, tx);
    }

    let created: Department;
    try {
      created = await tx.department.create({
        data: {
          companyId: input.companyId,
          name: input.name.trim(),
          code,
          description: input.description?.trim() || null,
          color: input.color ?? null,
          parentDepartmentId: input.parentDepartmentId ?? null,
          displayOrder: input.displayOrder ?? null,
        },
      });
    } catch (error) {
      throw translateWriteError(error, "Department", code);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "CREATED",
        category: "DEPARTMENT",
        entityType: "Department",
        entityId: created.id,
        entityDisplayReference: created.code,
        after: created,
      },
      tx
    );
    return created;
  });
}

/**
 * Validates a proposed new parent for a department that may already
 * exist (pass `movingDepartmentId` to also run the cycle check).
 */
async function assertValidParentDepartment(
  companyId: string,
  parentDepartmentId: string,
  tx: Prisma.TransactionClient,
  movingDepartmentId?: string
): Promise<void> {
  const parent = await findDepartmentById(parentDepartmentId, companyId, tx);
  if (!parent) {
    throw new CrossCompanyError(
      `Parent department ${parentDepartmentId} does not exist in company ${companyId}.`
    );
  }

  if (movingDepartmentId) {
    if (parentDepartmentId === movingDepartmentId) {
      throw new CycleError("A department cannot be its own parent.");
    }
    const ancestorChain = await getDepartmentAncestorChain(parentDepartmentId, companyId, tx);
    if (wouldCreateCycle(movingDepartmentId, ancestorChain)) {
      throw new CycleError(
        `Setting department ${movingDepartmentId}'s parent to ${parentDepartmentId} would create a reporting cycle.`
      );
    }
  }
}

export interface MoveDepartmentInput {
  companyId: string;
  actor?: AuditActor;
  departmentId: string;
  newParentDepartmentId: string | null;
}

/**
 * Changes a department's parent. Deliberately does NOT touch any
 * Position row — department hierarchy and position reporting hierarchy
 * are separate concepts (docs/DOMAIN_MODEL.md §1, principle 10).
 */
export async function moveDepartment(
  input: MoveDepartmentInput,
  db: DbClient = prisma
): Promise<Department> {
  return withTransaction(db, async (tx) => {
    const department = await findDepartmentById(input.departmentId, input.companyId, tx);
    if (!department) throw new NotFoundError("Department", input.departmentId);

    if (input.newParentDepartmentId) {
      await assertValidParentDepartment(
        input.companyId,
        input.newParentDepartmentId,
        tx,
        input.departmentId
      );
    }

    const updated = await tx.department.update({
      where: { id: input.departmentId },
      data: { parentDepartmentId: input.newParentDepartmentId },
    });

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "UPDATED",
        category: "DEPARTMENT",
        entityType: "Department",
        entityId: updated.id,
        entityDisplayReference: updated.code,
        before: department,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export interface UpdateDepartmentInput {
  companyId: string;
  actor?: AuditActor;
  departmentId: string;
  name?: string;
  code?: string;
  description?: string | null;
  color?: string | null;
  displayOrder?: number | null;
}

/**
 * Updates a department's own fields. Deliberately does NOT accept
 * `parentDepartmentId` — use `moveDepartment` for that, which runs the
 * cycle check every parent change needs. Keeping the two operations
 * separate means a plain rename can never accidentally skip the cycle
 * check by sharing a code path with a parent change.
 */
export async function updateDepartment(
  input: UpdateDepartmentInput,
  db: DbClient = prisma
): Promise<Department> {
  return withTransaction(db, async (tx) => {
    const existing = await findDepartmentById(input.departmentId, input.companyId, tx);
    if (!existing) throw new NotFoundError("Department", input.departmentId);

    const code = input.code !== undefined ? normalizeCode(input.code) : undefined;

    let updated: Department;
    try {
      updated = await tx.department.update({
        where: { id: input.departmentId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        },
      });
    } catch (error) {
      throw translateWriteError(error, "Department", code ?? input.departmentId);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "UPDATED",
        category: "DEPARTMENT",
        entityType: "Department",
        entityId: updated.id,
        entityDisplayReference: updated.code,
        before: existing,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

/** Sets status = INACTIVE. Safe by construction — the row persists, so no reference is ever orphaned. Never blocked by children/positions (see docs/DOMAIN_MODEL.md §7 for why archive and hard-delete have different safety rules). */
export async function archiveDepartment(
  id: string,
  companyId: string,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<Department> {
  return withTransaction(db, async (tx) => {
    const department = await findDepartmentById(id, companyId, tx);
    if (!department) throw new NotFoundError("Department", id);

    const updated = await tx.department.update({
      where: { id },
      data: { status: "INACTIVE" },
    });

    await recordAuditEvent(
      {
        companyId,
        actor,
        action: "ARCHIVED",
        category: "DEPARTMENT",
        entityType: "Department",
        entityId: updated.id,
        entityDisplayReference: updated.code,
        before: department,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export async function reactivateDepartment(
  id: string,
  companyId: string,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<Department> {
  return withTransaction(db, async (tx) => {
    const department = await findDepartmentById(id, companyId, tx);
    if (!department) throw new NotFoundError("Department", id);

    const updated = await tx.department.update({
      where: { id },
      data: { status: "ACTIVE" },
    });

    await recordAuditEvent(
      {
        companyId,
        actor,
        action: "REACTIVATED",
        category: "DEPARTMENT",
        entityType: "Department",
        entityId: updated.id,
        entityDisplayReference: updated.code,
        before: department,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

/**
 * Hard delete. Only ever possible for a department nothing references —
 * no positions, no child departments — which is the business rule "a
 * Department cannot be hard-deleted while any Position references it".
 * Archiving remains the normal way to retire a department that is still
 * in use, and the rejections below say so.
 *
 * The real enforcement is the database's ON DELETE RESTRICT constraint
 * (see the initial migration's SQL under prisma/migrations/); the two
 * checks here exist so a caller gets a clear, typed UnsafeMutationError
 * naming the blocker instead of a raw Prisma foreign-key error, and so
 * the rule is testable without relying on the error text Prisma happens
 * to produce.
 *
 * The count checks and the delete run in ONE transaction. Read-then-write
 * across two connections would let a position be created against this
 * department in the gap; inside a transaction the constraint still
 * catches that, but the caller would get the raw FK error instead of the
 * friendly one. The audit event is written in the same transaction, so a
 * committed delete can never be missing its record (CLAUDE.md §1.9).
 */
export async function deleteDepartment(
  id: string,
  companyId: string,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<void> {
  return withTransaction(db, async (tx) => {
    const department = await findDepartmentById(id, companyId, tx);
    if (!department) throw new NotFoundError("Department", id);

    const [positionCount, childCount] = await Promise.all([
      countPositionsInDepartment(id, companyId, tx),
      countChildDepartments(id, companyId, tx),
    ]);

    if (positionCount > 0) {
      throw new UnsafeMutationError(
        `${department.name} still has ${positionCount} position${positionCount === 1 ? "" : "s"} in it, so it cannot be deleted. Move or delete those positions first, or deactivate this department instead.`
      );
    }
    if (childCount > 0) {
      throw new UnsafeMutationError(
        `${department.name} still has ${childCount} sub-department${childCount === 1 ? "" : "s"} under it, so it cannot be deleted. Move or delete those first, or deactivate this department instead.`
      );
    }

    try {
      await tx.department.delete({ where: { id } });
    } catch (error) {
      throw translateWriteError(error, "Department", id);
    }

    await recordAuditEvent(
      {
        companyId,
        actor,
        action: "DELETED",
        category: "DEPARTMENT",
        entityType: "Department",
        entityId: department.id,
        entityDisplayReference: department.code,
        before: department,
        // No `after`: the row is gone. The before-snapshot is the only
        // record left of what was removed, which is exactly why it is
        // written inside the same transaction as the delete.
      },
      tx
    );
  });
}

/** Exported for reuse by lib/services/import.service.ts's bulk-create path (Phase 13.1). */
export function translateWriteError(error: unknown, entity: string, identifier: string): Error {
  if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      return new ConflictError(`${entity} code "${identifier}" is already in use in this company.`);
    }
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return new UnsafeMutationError(
        `Cannot complete this ${entity.toLowerCase()} operation: it is still referenced by other records.`
      );
    }
    if (error.code === RECORD_NOT_FOUND) {
      return new NotFoundError(entity, identifier);
    }
  }
  // Never let a raw Prisma/Postgres error (which can include connection
  // strings, table/column names) escape to a caller outside this module.
  return error instanceof Error ? error : new Error("Unexpected database error.");
}
