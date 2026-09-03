import "server-only";
import type { Position, Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { normalizeCode } from "@/lib/domain/normalize";
import { calculateLevel, recalculateSubtreeLevels, wouldCreateCycle } from "@/lib/domain/hierarchy";
import {
  ConflictError,
  CrossCompanyError,
  CycleError,
  NotFoundError,
  UnsafeMutationError,
} from "@/lib/domain/errors";
import {
  countDirectReports,
  findPositionById,
  findRootPosition,
  getPositionAncestorChain,
  getPositionSubtree,
  lockPositionsForUpdate,
} from "@/lib/repositories/position.repository";
import { findDepartmentById } from "@/lib/repositories/department.repository";
import type { DbClient } from "@/lib/repositories/types";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const FOREIGN_KEY_VIOLATION = "P2003";

export interface CreatePositionInput {
  companyId: string;
  actor?: AuditActor;
  departmentId: string;
  jobGradeId?: string | null;
  title: string;
  positionCode: string;
  description?: string | null;
  location?: string | null;
  /** null creates the root position — only one is allowed per company (docs/DOMAIN_MODEL.md §1, enforced by a partial unique index). */
  primaryReportsToPositionId?: string | null;
  displayOrder?: number | null;
}

/**
 * Validates and creates a position. All company-scoping, cycle, and
 * level-calculation checks happen inside one transaction with the insert
 * (docs/adr/0005-transaction-strategy.md). The organizational level is
 * always computed here — it is never accepted as caller input.
 */
export async function createPosition(
  input: CreatePositionInput,
  db: DbClient = prisma
): Promise<Position> {
  const positionCode = normalizeCode(input.positionCode);

  return withTransaction(db, async (tx) => {
    const department = await findDepartmentById(input.departmentId, input.companyId, tx);
    if (!department) {
      throw new CrossCompanyError(
        `Department ${input.departmentId} does not exist in company ${input.companyId}.`
      );
    }

    let organizationalLevel: number;

    if (
      input.primaryReportsToPositionId === null ||
      input.primaryReportsToPositionId === undefined
    ) {
      organizationalLevel = calculateLevel(null);
    } else {
      const parent = await findPositionById(input.primaryReportsToPositionId, input.companyId, tx);
      if (!parent) {
        throw new CrossCompanyError(
          `Reports-to position ${input.primaryReportsToPositionId} does not exist in company ${input.companyId}.`
        );
      }
      organizationalLevel = calculateLevel(parent.organizationalLevel);
    }

    if (input.jobGradeId) {
      const jobGrade = await tx.jobGrade.findFirst({
        where: { id: input.jobGradeId, companyId: input.companyId },
      });
      if (!jobGrade) {
        throw new CrossCompanyError(
          `Job grade ${input.jobGradeId} does not exist in company ${input.companyId}.`
        );
      }
    }

    let created: Position;
    try {
      created = await tx.position.create({
        data: {
          companyId: input.companyId,
          departmentId: input.departmentId,
          jobGradeId: input.jobGradeId ?? null,
          title: input.title.trim(),
          positionCode,
          description: input.description?.trim() || null,
          location: input.location?.trim() || null,
          primaryReportsToPositionId: input.primaryReportsToPositionId ?? null,
          organizationalLevel,
          displayOrder: input.displayOrder ?? null,
        },
      });
    } catch (error) {
      throw translateWriteError(error, positionCode, input.primaryReportsToPositionId === null);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "CREATED",
        category: "POSITION",
        entityType: "Position",
        entityId: created.id,
        entityDisplayReference: created.positionCode,
        after: created,
      },
      tx
    );
    return created;
  });
}

export interface MovePositionInput {
  companyId: string;
  actor?: AuditActor;
  positionId: string;
  /** null moves the position to become the new root — rejected if a root already exists. */
  newParentPositionId: string | null;
}

/**
 * Moves a position to a new parent, recalculating the level of the moved
 * position and every descendant inside one transaction
 * (organogram-hierarchy-safety skill, invariants 8–10).
 */
export async function movePosition(
  input: MovePositionInput,
  db: DbClient = prisma
): Promise<Position> {
  return withTransaction(db, async (tx) => {
    // Lock the moved position and its proposed new parent BEFORE any
    // read that will inform the cycle-detection decision below — see
    // lockPositionsForUpdate's own doc comment for why this is required
    // to prevent two concurrent opposite moves (A under B, B under A at
    // the same instant) from both passing cycle detection and jointly
    // creating a real reporting cycle (Phase 13 hardening finding,
    // tests/integration/hierarchy-move-concurrency.integration.test.ts).
    await lockPositionsForUpdate(
      [input.positionId, input.newParentPositionId].filter((id): id is string => id !== null),
      input.companyId,
      tx
    );

    const position = await findPositionById(input.positionId, input.companyId, tx);
    if (!position) throw new NotFoundError("Position", input.positionId);

    let newParentLevel: number | null = null;

    if (input.newParentPositionId !== null) {
      if (input.newParentPositionId === input.positionId) {
        throw new CycleError("A position cannot report to itself.");
      }
      const newParent = await findPositionById(input.newParentPositionId, input.companyId, tx);
      if (!newParent) {
        throw new CrossCompanyError(
          `Reports-to position ${input.newParentPositionId} does not exist in company ${input.companyId}.`
        );
      }
      const ancestorChain = await getPositionAncestorChain(
        input.newParentPositionId,
        input.companyId,
        tx
      );
      if (
        wouldCreateCycle(
          input.positionId,
          ancestorChain.map((n) => n.id)
        )
      ) {
        throw new CycleError(
          `Moving position ${input.positionId} under ${input.newParentPositionId} would create a reporting cycle.`
        );
      }
      newParentLevel = newParent.organizationalLevel;
    }

    const subtree = await getPositionSubtree(input.positionId, input.companyId, tx);
    const newLevels = recalculateSubtreeLevels(
      input.positionId,
      newParentLevel,
      subtree.map((n) => ({ id: n.id, parentId: n.parentId, currentLevel: n.organizationalLevel }))
    );

    try {
      const movedPositionNewLevel = newLevels.get(input.positionId);
      if (movedPositionNewLevel === undefined) {
        throw new Error("Internal error: moved position missing from recalculated levels.");
      }

      const updated = await tx.position.update({
        where: { id: input.positionId },
        data: {
          primaryReportsToPositionId: input.newParentPositionId,
          organizationalLevel: movedPositionNewLevel,
        },
      });

      for (const [descendantId, level] of newLevels) {
        if (descendantId === input.positionId) continue;
        await tx.position.update({
          where: { id: descendantId },
          data: { organizationalLevel: level },
        });
      }

      await recordAuditEvent(
        {
          companyId: input.companyId,
          actor: input.actor ?? "SYSTEM",
          action: "UPDATED",
          category: "HIERARCHY",
          entityType: "Position",
          entityId: updated.id,
          entityDisplayReference: updated.positionCode,
          before: position,
          after: updated,
          metadata: { descendantCount: newLevels.size - 1 },
        },
        tx
      );
      return updated;
    } catch (error) {
      throw translateWriteError(error, position.positionCode, input.newParentPositionId === null);
    }
  });
}

export interface UpdatePositionInput {
  companyId: string;
  actor?: AuditActor;
  positionId: string;
  title?: string;
  positionCode?: string;
  description?: string | null;
  location?: string | null;
  departmentId?: string;
  jobGradeId?: string | null;
  displayOrder?: number | null;
}

/**
 * Updates a position's own fields — deliberately does NOT accept
 * `primaryReportsToPositionId`; use `movePosition` for that, which runs
 * the cycle check and descendant-level recalculation every reporting
 * change needs. Changing `departmentId` here is a plain field update
 * (Department and reporting hierarchy are separate concepts —
 * docs/DOMAIN_MODEL.md §1 principle 10) and never touches
 * `organizationalLevel`.
 */
export async function updatePosition(
  input: UpdatePositionInput,
  db: DbClient = prisma
): Promise<Position> {
  const positionCode =
    input.positionCode !== undefined ? normalizeCode(input.positionCode) : undefined;

  return withTransaction(db, async (tx) => {
    const existing = await findPositionById(input.positionId, input.companyId, tx);
    if (!existing) throw new NotFoundError("Position", input.positionId);

    if (input.departmentId !== undefined) {
      const department = await findDepartmentById(input.departmentId, input.companyId, tx);
      if (!department) {
        throw new CrossCompanyError(
          `Department ${input.departmentId} does not exist in company ${input.companyId}.`
        );
      }
    }

    if (input.jobGradeId) {
      const jobGrade = await tx.jobGrade.findFirst({
        where: { id: input.jobGradeId, companyId: input.companyId },
      });
      if (!jobGrade) {
        throw new CrossCompanyError(
          `Job grade ${input.jobGradeId} does not exist in company ${input.companyId}.`
        );
      }
    }

    let updated: Position;
    try {
      updated = await tx.position.update({
        where: { id: input.positionId },
        data: {
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(positionCode !== undefined ? { positionCode } : {}),
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.location !== undefined ? { location: input.location?.trim() || null } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.jobGradeId !== undefined ? { jobGradeId: input.jobGradeId } : {}),
          ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        },
      });
    } catch (error) {
      throw translateWriteError(error, positionCode ?? existing.positionCode, false);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "UPDATED",
        category: "POSITION",
        entityType: "Position",
        entityId: updated.id,
        entityDisplayReference: updated.positionCode,
        before: existing,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

/** Sets status = INACTIVE. Safe with children present — the row persists, so the hierarchy stays structurally valid (docs/DOMAIN_MODEL.md §7). */
export async function archivePosition(
  id: string,
  companyId: string,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<Position> {
  return withTransaction(db, async (tx) => {
    const position = await findPositionById(id, companyId, tx);
    if (!position) throw new NotFoundError("Position", id);

    const updated = await tx.position.update({ where: { id }, data: { status: "INACTIVE" } });

    await recordAuditEvent(
      {
        companyId,
        actor,
        action: "ARCHIVED",
        category: "POSITION",
        entityType: "Position",
        entityId: updated.id,
        entityDisplayReference: updated.positionCode,
        before: position,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export async function activatePosition(
  id: string,
  companyId: string,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<Position> {
  return withTransaction(db, async (tx) => {
    const position = await findPositionById(id, companyId, tx);
    if (!position) throw new NotFoundError("Position", id);

    const updated = await tx.position.update({ where: { id }, data: { status: "ACTIVE" } });

    await recordAuditEvent(
      {
        companyId,
        actor,
        action: "REACTIVATED",
        category: "POSITION",
        entityType: "Position",
        entityId: updated.id,
        entityDisplayReference: updated.positionCode,
        before: position,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

/**
 * Hard delete — never exposed through normal HR workflow. Rejected by
 * the database's ON DELETE RESTRICT the moment direct reports or
 * assignments reference this position; this function only pre-checks
 * direct reports for a clean error and otherwise relies on that DB
 * constraint as the real enforcement.
 */
export async function deletePosition(id: string, companyId: string): Promise<void> {
  const position = await findPositionById(id, companyId);
  if (!position) throw new NotFoundError("Position", id);

  const directReportCount = await countDirectReports(id, companyId);
  if (directReportCount > 0) {
    throw new UnsafeMutationError(
      `Cannot delete position ${id}: ${directReportCount} position(s) directly report to it. Archive it instead.`
    );
  }

  try {
    await prisma.position.delete({ where: { id } });
  } catch (error) {
    throw translateWriteError(error, position.positionCode, false);
  }
}

export async function getRootPosition(
  companyId: string,
  db: DbClient = prisma
): Promise<Position | null> {
  return findRootPosition(companyId, db);
}

/** Exported for reuse by lib/services/import.service.ts's bulk-create path (Phase 13.1), which triggers the same DB-level constraint violations via `createManyAndReturn` instead of this file's own `tx.position.create`. */
export function translateWriteError(
  error: unknown,
  positionCode: string,
  isRootAttempt: boolean
): Error {
  if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      // Prisma reports hand-authored partial-unique-index violations
      // (docs/adr/0009-phase2-domain-model.md — these indexes have no
      // Prisma-schema `@@unique` equivalent) via `meta.target`'s COLUMN
      // LIST, never the constraint's own SQL name — so a check like
      // `target.includes("one_root_per_company")` never matches; Postgres
      // never surfaces that name to the JS layer at all. The column list
      // alone is still enough to distinguish the cases: the root-position
      // index is on `companyId` alone (`target: ["companyId"]`), which is
      // structurally different from the ordinary
      // `@@unique([companyId, positionCode])` violation (`target:
      // ["companyId", "positionCode"]`) — confirmed empirically against a
      // real conflict of each kind, not assumed.
      const target = (error.meta?.target as string[] | undefined) ?? [];
      if (isRootAttempt && target.length === 1 && target[0] === "companyId") {
        return new ConflictError("This company already has a root position — only one is allowed.");
      }
      if (target.includes("positionCode")) {
        return new ConflictError(
          `Position code "${positionCode}" is already in use in this company.`
        );
      }
      // Assignment-table partial-unique-index violations reach this
      // function only via lib/services/assignment.service.ts's own
      // translateAssignmentWriteError, not this one — Position has no
      // assignment-uniqueness conflict of its own to translate here.
      return new ConflictError(
        `Position code "${positionCode}" is already in use in this company.`
      );
    }
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return new UnsafeMutationError(
        "Cannot complete this position operation: it is still referenced by other records."
      );
    }
  }
  return error instanceof Error ? error : new Error("Unexpected database error.");
}

// Re-exported for callers that need the transaction-client type for composition.
export type { Prisma };
