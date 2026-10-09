import "server-only";
import type { Department, Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { normalizeCode } from "@/lib/domain/normalize";
import { departmentCodeFromName, firstFreeCode } from "@/lib/domain/department-code";
import { departmentNameKey } from "@/lib/domain/import/department-import";
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
  /** Omitted → generated from the name, unique in the company (D51). */
  code?: string;
  description?: string | null;
  color?: string | null;
  hasIcLadder?: boolean;
  hasManagerLadder?: boolean;
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
  return withTransaction(db, async (tx) => {
    await assertDepartmentNameFree(input.name, input.companyId, null, tx);
    const code = input.code
      ? normalizeCode(input.code)
      : await generateDepartmentCode(input.name, input.companyId, tx);
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
          ...(input.hasIcLadder !== undefined ? { hasIcLadder: input.hasIcLadder } : {}),
          ...(input.hasManagerLadder !== undefined
            ? { hasManagerLadder: input.hasManagerLadder }
            : {}),
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
        entityDisplayReference: created.name,
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
        entityDisplayReference: updated.name,
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
  hasIcLadder?: boolean;
  hasManagerLadder?: boolean;
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
    if (input.name !== undefined) {
      await assertDepartmentNameFree(input.name, input.companyId, existing.id, tx);
    }

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
          ...(input.hasIcLadder !== undefined ? { hasIcLadder: input.hasIcLadder } : {}),
          ...(input.hasManagerLadder !== undefined
            ? { hasManagerLadder: input.hasManagerLadder }
            : {}),
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
        entityDisplayReference: updated.name,
        before: existing,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

/** Sets status = INACTIVE. Safe by construction — the row persists, so no reference is ever orphaned. Never blocked by children/positions (see docs/DOMAIN_MODEL.md §7 for why archive and hard-delete have different safety rules). */
export interface ReorderDepartmentsInput {
  companyId: string;
  actor?: AuditActor;
  /** Departments in their new left-to-right order on the organogram. */
  orderedDepartmentIds: readonly string[];
}

/**
 * Saves the organogram's left-to-right department order (docs/DECISIONS.md
 * D33): each listed department's `displayOrder` becomes its position in the
 * list (1, 2, 3…). Departments not listed keep theirs. Every id must belong
 * to the company; one transaction, one audit event per department whose
 * order actually changed.
 */
export async function reorderDepartments(
  input: ReorderDepartmentsInput,
  db: DbClient = prisma
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const existing = await tx.department.findMany({
      where: { companyId: input.companyId, id: { in: [...input.orderedDepartmentIds] } },
    });
    if (existing.length !== input.orderedDepartmentIds.length) {
      throw new NotFoundError("Department", "one or more of the reordered departments");
    }
    const byId = new Map(existing.map((d) => [d.id, d]));
    for (const [index, departmentId] of input.orderedDepartmentIds.entries()) {
      const before = byId.get(departmentId)!;
      const displayOrder = index + 1;
      if (before.displayOrder === displayOrder) continue;
      const after = await tx.department.update({
        where: { id: departmentId },
        data: { displayOrder },
      });
      await recordAuditEvent(
        {
          companyId: input.companyId,
          actor: input.actor ?? "SYSTEM",
          action: "UPDATED",
          category: "DEPARTMENT",
          entityType: "Department",
          entityId: departmentId,
          entityDisplayReference: after.name,
          before,
          after,
          metadata: { reordered: true },
        },
        tx
      );
    }
  });
}

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
        entityDisplayReference: updated.name,
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
        entityDisplayReference: updated.name,
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
 * no positions, child departments or sub-divisions (its own unused levels
 * are removed with it) — which is the business rule "a
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

    const subDivisions = await tx.jobFamily.findMany({
      where: { departmentId: id, companyId },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    if (subDivisions.length > 0) {
      throw new UnsafeMutationError(
        `${department.name} still has ${subDivisions.length === 1 ? "the sub-division" : `${subDivisions.length} sub-divisions:`} ${subDivisions.map((f) => f.name).join(", ")}, so it cannot be deleted. Delete or move those first, or deactivate this department instead.`
      );
    }

    // Levels that belong only to this department are created automatically
    // when a position is added at a level (ensureJobGradeByCode) and stay
    // behind after its positions are moved or deleted. Unused ones mean
    // nothing without the department, so they go with it; one still in use
    // blocks the delete with its code named, never a vague database error.
    await tx.jobGrade.deleteMany({
      where: {
        departmentId: id,
        companyId,
        positions: { none: {} },
        levelMappingEntries: { none: {} },
      },
    });
    const levelsInUse = await tx.jobGrade.findMany({
      where: { departmentId: id, companyId },
      select: { code: true },
      orderBy: { code: "asc" },
    });
    if (levelsInUse.length > 0) {
      throw new UnsafeMutationError(
        `${department.name}'s level${levelsInUse.length === 1 ? "" : "s"} ${levelsInUse.map((g) => g.code).join(", ")} ${levelsInUse.length === 1 ? "is" : "are"} still used by positions or the career framework, so it cannot be deleted. Deactivate this department instead.`
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
        entityDisplayReference: department.name,
        before: department,
        // No `after`: the row is gone. The before-snapshot is the only
        // record left of what was removed, which is exactly why it is
        // written inside the same transaction as the delete.
      },
      tx
    );
  });
}

/**
 * Department names are unique in a company, ignoring case and extra spaces
 * (D52): CSV imports identify departments by name, so two with the same name
 * would be ambiguous. `exceptId` is the department being renamed.
 */
async function assertDepartmentNameFree(
  name: string,
  companyId: string,
  exceptId: string | null,
  tx: Prisma.TransactionClient
): Promise<void> {
  const key = departmentNameKey(name);
  const sameName = await tx.department.findMany({
    where: {
      companyId,
      name: { equals: name.trim(), mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { name: true },
  });
  const clash = sameName.find((d) => departmentNameKey(d.name) === key);
  if (clash) {
    throw new ConflictError(`A department called "${clash.name}" already exists.`);
  }
}

/**
 * A code for a new department built from its name (D51): its initials, or the
 * first free numbered variant ("HR", "HR2", …) in this company. A rare race
 * between two creates is still caught by the unique constraint, and reported
 * as a friendly conflict.
 */
async function generateDepartmentCode(
  name: string,
  companyId: string,
  tx: Prisma.TransactionClient
): Promise<string> {
  const base = departmentCodeFromName(name);
  const existing = await tx.department.findMany({
    where: { companyId, code: { startsWith: base, mode: "insensitive" } },
    select: { code: true },
  });
  return firstFreeCode(base, new Set(existing.map((d) => d.code.toUpperCase())));
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
