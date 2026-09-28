import "server-only";
import type { CareerTrackKind, Position, Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { normalizeCode } from "@/lib/domain/normalize";
import {
  calculateLevelFromHeads,
  HeadGraphCycleError,
  recalculateDagLevels,
  wouldCreateCycle,
} from "@/lib/domain/hierarchy";
import {
  ConflictError,
  CrossCompanyError,
  CycleError,
  DomainValidationError,
  NotFoundError,
  UnsafeMutationError,
} from "@/lib/domain/errors";
import {
  countDirectReports,
  findPositionById,
  findRootPosition,
  getPositionAncestorIds,
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
  /** Career-framework classification (optional; never affects the reporting tree). */
  jobFamilyId?: string | null;
  careerTrackId?: string | null;
  /** IC/Manager ladder captured directly on the position (optional; presentational). */
  ladderKind?: CareerTrackKind | null;
  title: string;
  positionCode: string;
  description?: string | null;
  location?: string | null;
  /** null creates the root position — only one is allowed per company (docs/DOMAIN_MODEL.md §1, enforced by a partial unique index). */
  primaryReportsToPositionId?: string | null;
  /** Optional second head (docs/DECISIONS.md D27). Requires a head 1 and must differ from it. */
  coReportsToPositionId?: string | null;
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

    const headIds = [input.primaryReportsToPositionId, input.coReportsToPositionId].filter(
      (id): id is string => id !== null && id !== undefined
    );
    if (input.coReportsToPositionId) {
      assertValidCoHeadShape(input.primaryReportsToPositionId ?? null, input.coReportsToPositionId);
    }

    // Level = deepest head + 1, root = 1 (docs/DECISIONS.md D27). A brand-new
    // position has no descendants, so neither head can create a cycle here.
    const headLevels: number[] = [];
    for (const headId of headIds) {
      const head = await findPositionById(headId, input.companyId, tx);
      if (!head) {
        throw new CrossCompanyError(
          `Reports-to position ${headId} does not exist in company ${input.companyId}.`
        );
      }
      headLevels.push(head.organizationalLevel);
    }
    const organizationalLevel = calculateLevelFromHeads(headLevels);

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
          jobFamilyId: input.jobFamilyId ?? null,
          careerTrackId: input.careerTrackId ?? null,
          ladderKind: input.ladderKind ?? null,
          title: input.title.trim(),
          positionCode,
          description: input.description?.trim() || null,
          location: input.location?.trim() || null,
          primaryReportsToPositionId: input.primaryReportsToPositionId ?? null,
          coReportsToPositionId: input.coReportsToPositionId ?? null,
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

    if (input.newParentPositionId !== null) {
      if (input.newParentPositionId === input.positionId) {
        throw new CycleError("A position cannot report to itself.");
      }
      if (input.newParentPositionId === position.coReportsToPositionId) {
        throw new DomainValidationError(
          "That position is already this position's other head — a position cannot report to the same head twice."
        );
      }
      const newParent = await findPositionById(input.newParentPositionId, input.companyId, tx);
      if (!newParent) {
        throw new CrossCompanyError(
          `Reports-to position ${input.newParentPositionId} does not exist in company ${input.companyId}.`
        );
      }
      const ancestors = await getPositionAncestorIds(
        input.newParentPositionId,
        input.companyId,
        tx
      );
      if (wouldCreateCycle(input.positionId, [...ancestors])) {
        throw new CycleError(
          `Moving position ${input.positionId} under ${input.newParentPositionId} would create a reporting cycle.`
        );
      }
    } else if (position.coReportsToPositionId !== null) {
      throw new DomainValidationError(
        "A position with a second head cannot become the root. Remove its second head first."
      );
    }

    const newLevels = await recalculateLevelsBelow(tx, input.companyId, input.positionId, [
      input.newParentPositionId,
      position.coReportsToPositionId,
    ]);

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

      await writeDescendantLevels(tx, input.positionId, newLevels);

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

/**
 * Recalculates the level of `positionId` (given its NEW head ids) and of
 * every descendant reachable through either head link, using the DAG rule
 * "deepest head + 1" (docs/DECISIONS.md D27). Heads outside that set keep
 * their stored levels. Pure calculation — the caller writes the result.
 */
async function recalculateLevelsBelow(
  tx: DbClient,
  companyId: string,
  positionId: string,
  newHeadIds: readonly (string | null)[]
): Promise<Map<string, number>> {
  const descendants = await getPositionSubtree(positionId, companyId, tx);
  const affected = [
    { id: positionId, headIds: newHeadIds.filter((h): h is string => h !== null) },
    ...descendants.map((d) => ({ id: d.id, headIds: d.headIds })),
  ];
  const affectedIds = new Set(affected.map((n) => n.id));
  const externalHeadIds = [
    ...new Set(affected.flatMap((n) => n.headIds).filter((h) => !affectedIds.has(h))),
  ];
  const externalHeads =
    externalHeadIds.length === 0
      ? []
      : await tx.position.findMany({
          where: { id: { in: externalHeadIds }, companyId },
          select: { id: true, organizationalLevel: true },
        });
  const fixedLevelOf = new Map(externalHeads.map((h) => [h.id, h.organizationalLevel]));

  try {
    return recalculateDagLevels(affected, fixedLevelOf);
  } catch (error) {
    if (error instanceof HeadGraphCycleError) {
      throw new CycleError("This change would create a reporting cycle.");
    }
    throw error;
  }
}

/** Writes recalculated levels for every descendant (not `positionId` itself), skipping unchanged rows. */
async function writeDescendantLevels(
  tx: DbClient,
  positionId: string,
  newLevels: ReadonlyMap<string, number>
): Promise<void> {
  const ids = [...newLevels.keys()].filter((id) => id !== positionId);
  if (ids.length === 0) return;
  const current = await tx.position.findMany({
    where: { id: { in: ids } },
    select: { id: true, organizationalLevel: true },
  });
  for (const row of current) {
    const level = newLevels.get(row.id);
    if (level !== undefined && level !== row.organizationalLevel) {
      await tx.position.update({ where: { id: row.id }, data: { organizationalLevel: level } });
    }
  }
}

/** Shape rules for a second head that need no database read. */
function assertValidCoHeadShape(primaryHeadId: string | null, coHeadId: string): void {
  if (primaryHeadId === null) {
    throw new DomainValidationError(
      "The top (root) position cannot have a second head. Choose its first head instead."
    );
  }
  if (coHeadId === primaryHeadId) {
    throw new DomainValidationError(
      "The second head must be a different position from the first head."
    );
  }
}

export interface SetCoReportsToInput {
  companyId: string;
  actor?: AuditActor;
  positionId: string;
  /** The second head to set, or null to remove it. */
  coReportsToPositionId: string | null;
}

/**
 * Sets, changes or removes a position's SECOND head (docs/DECISIONS.md D27).
 * Same guarantees as `movePosition`: rows locked before the cycle read, the
 * position and every descendant re-levelled ("deepest head + 1"), and the
 * audit event written, all in one transaction with full rollback.
 */
export async function setCoReportsTo(
  input: SetCoReportsToInput,
  db: DbClient = prisma
): Promise<Position> {
  return withTransaction(db, async (tx) => {
    await lockPositionsForUpdate(
      [input.positionId, input.coReportsToPositionId].filter((id): id is string => id !== null),
      input.companyId,
      tx
    );

    const position = await findPositionById(input.positionId, input.companyId, tx);
    if (!position) throw new NotFoundError("Position", input.positionId);

    if (input.coReportsToPositionId === position.coReportsToPositionId) {
      return position; // unchanged
    }

    if (input.coReportsToPositionId !== null) {
      if (input.coReportsToPositionId === input.positionId) {
        throw new CycleError("A position cannot report to itself.");
      }
      assertValidCoHeadShape(position.primaryReportsToPositionId, input.coReportsToPositionId);
      const coHead = await findPositionById(input.coReportsToPositionId, input.companyId, tx);
      if (!coHead) {
        throw new CrossCompanyError(
          `Reports-to position ${input.coReportsToPositionId} does not exist in company ${input.companyId}.`
        );
      }
      const ancestors = await getPositionAncestorIds(
        input.coReportsToPositionId,
        input.companyId,
        tx
      );
      if (wouldCreateCycle(input.positionId, [...ancestors])) {
        throw new CycleError(
          `${coHead.title} reports (directly or indirectly) to ${position.title}, so it cannot also be its head.`
        );
      }
    }

    const newLevels = await recalculateLevelsBelow(tx, input.companyId, input.positionId, [
      position.primaryReportsToPositionId,
      input.coReportsToPositionId,
    ]);
    const newLevel = newLevels.get(input.positionId);
    if (newLevel === undefined) {
      throw new Error("Internal error: position missing from recalculated levels.");
    }

    let updated: Position;
    try {
      updated = await tx.position.update({
        where: { id: input.positionId },
        data: {
          coReportsToPositionId: input.coReportsToPositionId,
          organizationalLevel: newLevel,
        },
      });
      await writeDescendantLevels(tx, input.positionId, newLevels);
    } catch (error) {
      throw translateWriteError(error, position.positionCode, false);
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
        metadata: { descendantCount: newLevels.size - 1, coHeadChange: true },
      },
      tx
    );
    return updated;
  });
}

export interface ChangeReportsToInput {
  companyId: string;
  actor?: AuditActor;
  positionId: string;
  /** New head 1, or null to make the position the root. */
  newParentPositionId: string | null;
  /** New head 2, or null for none. */
  coReportsToPositionId: string | null;
}

/**
 * Changes BOTH reporting lines of a position in one transaction — the
 * "Change Reports-To" dialog's single save (docs/DECISIONS.md D27). Composes
 * `setCoReportsTo` and `movePosition` (each re-validating every rule) so
 * that a swap of heads, or a head-2 change alongside a move, is all-or-
 * nothing: head 2 is cleared first when it is changing, then head 1 moves,
 * then the new head 2 is set.
 */
export async function changeReportsTo(
  input: ChangeReportsToInput,
  db: DbClient = prisma
): Promise<Position> {
  return withTransaction(db, async (tx) => {
    const position = await findPositionById(input.positionId, input.companyId, tx);
    if (!position) throw new NotFoundError("Position", input.positionId);
    const base = { companyId: input.companyId, actor: input.actor, positionId: input.positionId };

    const coChanging = input.coReportsToPositionId !== position.coReportsToPositionId;
    let current = position;
    if (coChanging && position.coReportsToPositionId !== null) {
      current = await setCoReportsTo({ ...base, coReportsToPositionId: null }, tx);
    }
    if (input.newParentPositionId !== current.primaryReportsToPositionId) {
      current = await movePosition({ ...base, newParentPositionId: input.newParentPositionId }, tx);
    }
    if (coChanging && input.coReportsToPositionId !== null) {
      current = await setCoReportsTo(
        { ...base, coReportsToPositionId: input.coReportsToPositionId },
        tx
      );
    }
    return current;
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
  jobFamilyId?: string | null;
  careerTrackId?: string | null;
  ladderKind?: CareerTrackKind | null;
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
          ...(input.jobFamilyId !== undefined ? { jobFamilyId: input.jobFamilyId } : {}),
          ...(input.careerTrackId !== undefined ? { careerTrackId: input.careerTrackId } : {}),
          ...(input.ladderKind !== undefined ? { ladderKind: input.ladderKind } : {}),
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
export async function deletePosition(
  id: string,
  companyId: string,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<void> {
  return withTransaction(db, async (tx) => {
    const position = await findPositionById(id, companyId, tx);
    if (!position) throw new NotFoundError("Position", id);

    // Two things must not be orphaned by a delete, and both are also
    // enforced by ON DELETE RESTRICT at the database — these checks exist
    // to turn the raw FK error into a message that names the blocker and
    // the way forward (deactivate instead), and to make the rules
    // testable without depending on Prisma's error text.
    const directReportCount = await countDirectReports(id, companyId, tx);
    if (directReportCount > 0) {
      throw new UnsafeMutationError(
        `${position.title} still has ${directReportCount} position${directReportCount === 1 ? "" : "s"} reporting to it, so it cannot be deleted. Move or delete those first, or deactivate this position instead.`
      );
    }

    // Any assignment — current OR historical — pins the position, because
    // assignment history is kept (PositionAssignment → Position is
    // RESTRICT). A position someone has ever held is deactivated, not
    // deleted, so that history stays resolvable.
    const assignmentCount = await tx.positionAssignment.count({ where: { positionId: id } });
    if (assignmentCount > 0) {
      throw new UnsafeMutationError(
        `${position.title} has employment history (someone is or was assigned to it), so it cannot be deleted. Deactivate this position instead.`
      );
    }

    try {
      await tx.position.delete({ where: { id } });
    } catch (error) {
      throw translateWriteError(error, position.positionCode, false);
    }

    await recordAuditEvent(
      {
        companyId,
        actor,
        action: "DELETED",
        category: "POSITION",
        entityType: "Position",
        entityId: position.id,
        entityDisplayReference: position.positionCode,
        before: position,
        // No `after`: the row is gone. The before-snapshot is the only
        // remaining record of the deleted position, which is why it is
        // written in the same transaction as the delete.
      },
      tx
    );
  });
}

export interface DeleteSubtreeResult {
  /** Total positions removed (the target plus every descendant). */
  deletedCount: number;
}

/**
 * Hard-deletes a position together with its ENTIRE subtree — every
 * descendant, in one transaction (CLAUDE.md §9). This is the organogram
 * card's "delete a wrong branch" action; a childless target simply deletes
 * itself. Distinct from `deletePosition`, which refuses any position that
 * still has direct reports.
 *
 * Non-destructive of employment history (docs/DECISIONS.md D20): if ANY
 * position anywhere in the subtree has a current or past assignment, the
 * whole delete is refused and nothing is removed — that branch must be
 * reassigned/deactivated first. So this can only ever remove planned/vacant
 * scaffolding, never a seat someone has held.
 *
 * Deletion runs deepest-first so the self-referencing
 * `primaryReportsToPositionId` FK (ON DELETE RESTRICT) is never violated
 * mid-transaction, and each removal writes its own DELETED audit event with
 * a before-snapshot (the only remaining record of the removed row).
 */
export async function deletePositionSubtree(
  id: string,
  companyId: string,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<DeleteSubtreeResult> {
  return withTransaction(db, async (tx) => {
    const root = await findPositionById(id, companyId, tx);
    if (!root) throw new NotFoundError("Position", id);

    // Descendants (root excluded), each with its level; add the root so the
    // whole branch is handled as one set.
    const descendants = await getPositionSubtree(id, companyId, tx);
    const members = [
      { id: root.id, organizationalLevel: root.organizationalLevel },
      ...descendants.map((d) => ({ id: d.id, organizationalLevel: d.organizationalLevel })),
    ];
    const memberIds = members.map((m) => m.id);
    const memberIdSet = new Set(memberIds);

    // Co-heads (docs/DECISIONS.md D27): a descendant that ALSO reports to a
    // head outside this branch would be left pointing at a deleted position.
    // Refuse rather than silently cut that reporting line.
    const sharedDescendant = descendants.find((d) =>
      d.headIds.some((headId) => !memberIdSet.has(headId))
    );
    if (sharedDescendant) {
      throw new UnsafeMutationError(
        `${root.title} cannot be deleted with its branch: a position in it also reports to someone outside this branch. Remove that second reporting line first.`
      );
    }

    // Refuse if anyone in the branch is or was assigned — assignment history
    // is kept (PositionAssignment → Position is RESTRICT). A held seat is
    // deactivated, not deleted, so the history stays resolvable.
    const assignmentCount = await tx.positionAssignment.count({
      where: { positionId: { in: memberIds } },
    });
    if (assignmentCount > 0) {
      throw new UnsafeMutationError(
        `${root.title} cannot be deleted: ${assignmentCount} position${assignmentCount === 1 ? "" : "s"} in this branch ${assignmentCount === 1 ? "has" : "have"} employment history (someone is or was assigned). Reassign or deactivate ${assignmentCount === 1 ? "it" : "them"} first, or deactivate this branch instead.`
      );
    }

    // Full rows for the before-snapshots, keyed for the audit loop.
    const rows = await tx.position.findMany({ where: { id: { in: memberIds }, companyId } });
    const rowById = new Map(rows.map((row) => [row.id, row]));

    // Deepest-first: a parent is never deleted while a child still points at
    // it, so the self-FK RESTRICT is satisfied every step.
    const orderedIds = [...members]
      .sort((a, b) => b.organizationalLevel - a.organizationalLevel)
      .map((m) => m.id);

    for (const memberId of orderedIds) {
      const before = rowById.get(memberId);
      try {
        await tx.position.delete({ where: { id: memberId } });
      } catch (error) {
        throw translateWriteError(error, before?.positionCode ?? memberId, false);
      }
      await recordAuditEvent(
        {
          companyId,
          actor,
          action: "DELETED",
          category: "POSITION",
          entityType: "Position",
          entityId: memberId,
          entityDisplayReference: before?.positionCode ?? memberId,
          before,
        },
        tx
      );
    }

    return { deletedCount: memberIds.length };
  });
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
