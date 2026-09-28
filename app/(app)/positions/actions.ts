"use server";

import type { CareerTrack, Department, JobFamily, JobGrade, Position } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { ensureJobGradeByCode } from "@/lib/services/job-grade.service";
import { ensureCareerTrackOfKind } from "@/lib/services/career-framework.service";
import { randomBytes } from "node:crypto";
import { toAuditActor } from "@/lib/server/audit-actor";
import {
  archivePosition,
  activatePosition,
  createPosition,
  deletePosition,
  deletePositionSubtree,
  movePosition,
  updatePosition,
  type DeleteSubtreeResult,
} from "@/lib/services/hierarchy.service";
import {
  getPositionSubtree,
  listAllPositionsForCompany,
  listOccupiedPositionIds,
  searchPositions,
  type PositionSearchResult,
} from "@/lib/repositories/position.repository";
import { listDepartmentsForCompany } from "@/lib/repositories/department.repository";
import { listJobGradesForCompany } from "@/lib/repositories/job-grade.repository";
import {
  listCareerTracksForCompany,
  listJobFamiliesForCompany,
} from "@/lib/repositories/career-framework.repository";
import {
  bulkMovePositionsSchema,
  bulkPositionIdsSchema,
  createPositionSchema,
  listPositionsQuerySchema,
  movePositionSchema,
  positionStatusChangeSchema,
  deletePositionSchema,
  updatePositionSchema,
  type ListPositionsQuery,
} from "@/lib/validation/position";
import { AppError } from "@/lib/errors";

export interface PositionListPayload extends PositionSearchResult {
  occupiedPositionIds: string[];
}

export async function listPositionsAction(
  input: ListPositionsQuery
): Promise<ActionResult<PositionListPayload>> {
  return runAction(async () => {
    const user = await requirePermission("positions:view");
    const query = listPositionsQuerySchema.parse(input);
    const result = await searchPositions({ companyId: user.companyId, ...query });
    const occupied = await listOccupiedPositionIds(
      result.items.map((p) => p.id),
      user.companyId,
      new Date()
    );
    return { ...result, occupiedPositionIds: [...occupied] };
  });
}

/** All positions for the current company, for the Reports-To combobox — unpaginated per docs/DECISIONS.md P7's ~2,000-position scale target. */
export async function listAllPositionsAction(): Promise<ActionResult<Position[]>> {
  return runAction(async () => {
    const user = await requirePermission("positions:view");
    return listAllPositionsForCompany(user.companyId);
  });
}

export async function listDepartmentOptionsAction(): Promise<ActionResult<Department[]>> {
  return runAction(async () => {
    const user = await requirePermission("positions:view");
    return listDepartmentsForCompany(user.companyId);
  });
}

export async function listJobGradeOptionsAction(): Promise<ActionResult<JobGrade[]>> {
  return runAction(async () => {
    const user = await requirePermission("positions:view");
    return listJobGradesForCompany(user.companyId);
  });
}

export interface PositionCareerOptions {
  jobFamilies: JobFamily[];
  careerTracks: CareerTrack[];
}

/** Career-framework options for the Position form's Sub-division / Career-track dropdowns. Read-only, needs only positions:view. */
export async function listPositionCareerOptionsAction(): Promise<
  ActionResult<PositionCareerOptions>
> {
  return runAction(async () => {
    const user = await requirePermission("positions:view");
    const [jobFamilies, careerTracks] = await Promise.all([
      listJobFamiliesForCompany(user.companyId),
      listCareerTracksForCompany(user.companyId),
    ]);
    return { jobFamilies, careerTracks };
  });
}

/** Number of descendants a move would recalculate — shown as a confirmation summary before the actual move (Phase 5 Step "move position flow with descendant-recalculation feedback"). */
export async function getSubtreeSizeAction(positionId: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    const user = await requirePermission("positions:view");
    const subtree = await getPositionSubtree(positionId, user.companyId);
    return subtree.length;
  });
}

/**
 * A short, unique-enough position code for a hand-created position. The
 * field was removed from the form (it is an internal import key, of no
 * use to a chart reader), so one is generated here. Uniqueness is
 * ultimately enforced by the DB's @@unique([companyId, positionCode]);
 * six random base36 characters make a collision astronomically unlikely,
 * and a rare one surfaces as the same friendly ConflictError any
 * duplicate would.
 */
function generatePositionCode(): string {
  return `POS-${randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`;
}

export async function createPositionAction(input: unknown): Promise<ActionResult<Position>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { jobGradeCode, jobGradeName, careerTrackKind, ...values } =
      createPositionSchema.parse(input);
    // A level chosen in the form (e.g. "L7") is resolved to the grade for
    // THIS position's department, creating it — with its per-department
    // name — on first use.
    const jobGradeId = jobGradeCode
      ? (
          await ensureJobGradeByCode(
            user.companyId,
            values.departmentId,
            jobGradeCode,
            jobGradeName
          )
        ).id
      : (values.jobGradeId ?? null);
    // A plain IC/Manager choice resolves to a career track for the chosen
    // sub-division, creating it on first use. Needs a sub-division; without
    // one there is nothing to attach a track to.
    const careerTrackId =
      careerTrackKind && values.jobFamilyId
        ? (
            await ensureCareerTrackOfKind(
              user.companyId,
              values.jobFamilyId,
              careerTrackKind,
              toAuditActor(user)
            )
          ).id
        : (values.careerTrackId ?? null);
    return createPosition({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
      positionCode: values.positionCode ?? generatePositionCode(),
      jobGradeId,
      careerTrackId,
      // Persist the IC/Manager choice directly on the position (independent of
      // any sub-division), so the position carries its own ladder context.
      ladderKind: careerTrackKind ?? null,
    });
  });
}

export async function updatePositionAction(input: unknown): Promise<ActionResult<Position>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { jobGradeCode, jobGradeName, careerTrackKind, ...values } =
      updatePositionSchema.parse(input);
    let jobGradeId = values.jobGradeId;
    if (jobGradeCode === null) {
      jobGradeId = null;
    } else if (jobGradeCode !== undefined) {
      // Resolve the level for the position's department. The edit form
      // always sends departmentId; without it we cannot scope the level,
      // so the grade is left unchanged.
      const departmentId = values.departmentId;
      if (departmentId) {
        jobGradeId = (
          await ensureJobGradeByCode(user.companyId, departmentId, jobGradeCode, jobGradeName)
        ).id;
      }
    }
    // Resolve a plain IC/Manager choice to a career track for the chosen
    // sub-division (created on first use). Null clears it; undefined leaves it.
    let careerTrackId = values.careerTrackId;
    if (careerTrackKind === null) {
      careerTrackId = null;
    } else if (careerTrackKind !== undefined && values.jobFamilyId) {
      careerTrackId = (
        await ensureCareerTrackOfKind(
          user.companyId,
          values.jobFamilyId,
          careerTrackKind,
          toAuditActor(user)
        )
      ).id;
    }
    return updatePosition({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
      jobGradeId,
      careerTrackId,
      // undefined leaves it unchanged; null clears it.
      ladderKind: careerTrackKind,
    });
  });
}

export async function movePositionAction(input: unknown): Promise<ActionResult<Position>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const values = movePositionSchema.parse(input);
    return movePosition({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function archivePositionAction(input: unknown): Promise<ActionResult<Position>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { positionId } = positionStatusChangeSchema.parse(input);
    return archivePosition(positionId, user.companyId, toAuditActor(user));
  });
}

export async function activatePositionAction(input: unknown): Promise<ActionResult<Position>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { positionId } = positionStatusChangeSchema.parse(input);
    return activatePosition(positionId, user.companyId, toAuditActor(user));
  });
}

/**
 * Permanently removes a position. Re-authorized and re-validated here
 * regardless of the client (CLAUDE.md §1.8); the service refuses any
 * position that still has direct reports or employment history, so this
 * can never orphan a report or lose an assignment record.
 */
export async function deletePositionAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { positionId } = deletePositionSchema.parse(input);
    await deletePosition(positionId, user.companyId, toAuditActor(user));
    return null;
  });
}

/**
 * Deletes a position AND its entire subtree (the organogram card's "delete
 * a wrong branch" action). Re-authorized and re-validated here regardless
 * of the client (CLAUDE.md §1.8); the service refuses the delete if any
 * position in the branch has employment history, and runs the whole removal
 * in one transaction, so it can never orphan a report or lose an assignment
 * record. The count is surfaced so the UI can confirm the blast radius.
 */
export async function deletePositionSubtreeAction(
  input: unknown
): Promise<ActionResult<DeleteSubtreeResult>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { positionId } = deletePositionSchema.parse(input);
    return deletePositionSubtree(positionId, user.companyId, toAuditActor(user));
  });
}

/**
 * Outcome of a bulk action: which positions were changed and which were
 * refused, each with the same user-facing reason a single-item action would
 * have surfaced. Bulk actions never partially corrupt data — each position is
 * processed by its own atomic service call (its own transaction), so a refusal
 * on one leaves the others exactly as the caller sees in `succeeded`/`failed`.
 */
export interface BulkActionResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

/** The reason a single item failed, mapped the same safe way as runAction. */
function bulkItemError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return "Something went wrong for this position.";
}

/**
 * Permanently removes several positions. Re-authorized and re-validated here
 * regardless of the client (CLAUDE.md §1.8). Each removal is the same atomic,
 * fully-validated `deletePosition` used by the single-item path, so a position
 * that still has reports or employment history is refused with its own reason
 * and never orphans anyone. Deletes are retried leaf-first: when the selection
 * covers a whole branch, a parent that was blocked only by a selected child
 * succeeds on a later pass once that child is gone.
 */
export async function bulkDeletePositionsAction(
  input: unknown
): Promise<ActionResult<BulkActionResult>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { positionIds } = bulkPositionIdsSchema.parse(input);
    const succeeded: string[] = [];
    const lastError = new Map<string, string>();
    let remaining = positionIds;
    // At most one pass per id: each pass either deletes something (making
    // progress) or the set is stable and we stop.
    for (let pass = 0; pass < positionIds.length && remaining.length > 0; pass++) {
      const stillFailing: string[] = [];
      let progressed = false;
      for (const id of remaining) {
        try {
          await deletePosition(id, user.companyId, toAuditActor(user));
          succeeded.push(id);
          lastError.delete(id);
          progressed = true;
        } catch (error) {
          lastError.set(id, bulkItemError(error));
          stillFailing.push(id);
        }
      }
      remaining = stillFailing;
      if (!progressed) break;
    }
    return {
      succeeded,
      failed: remaining.map((id) => ({ id, error: lastError.get(id) ?? bulkItemError(null) })),
    };
  });
}

/**
 * Deactivates several positions. Re-authorized and re-validated here regardless
 * of the client (CLAUDE.md §1.8). Each uses the same `archivePosition` service
 * as the single-item path; a position that cannot be archived is refused with
 * its own reason while the rest still apply.
 */
export async function bulkArchivePositionsAction(
  input: unknown
): Promise<ActionResult<BulkActionResult>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { positionIds } = bulkPositionIdsSchema.parse(input);
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of positionIds) {
      try {
        await archivePosition(id, user.companyId, toAuditActor(user));
        succeeded.push(id);
      } catch (error) {
        failed.push({ id, error: bulkItemError(error) });
      }
    }
    return { succeeded, failed };
  });
}

/**
 * Re-parents several positions under one new manager (bulk "Change
 * Reports-To"). Re-authorized and re-validated here regardless of the client
 * (CLAUDE.md §1.8). Each move is the same atomic `movePosition` used by the
 * single-item path — it recalculates levels and rejects any cycle inside its
 * own transaction — so a move that would create a cycle (e.g. moving a
 * position under its own descendant) is refused with its own reason while the
 * valid ones still apply.
 */
export async function bulkMovePositionsAction(
  input: unknown
): Promise<ActionResult<BulkActionResult>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { positionIds, newParentPositionId } = bulkMovePositionsSchema.parse(input);
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of positionIds) {
      try {
        await movePosition({
          companyId: user.companyId,
          actor: toAuditActor(user),
          positionId: id,
          newParentPositionId,
        });
        succeeded.push(id);
      } catch (error) {
        failed.push({ id, error: bulkItemError(error) });
      }
    }
    return { succeeded, failed };
  });
}
