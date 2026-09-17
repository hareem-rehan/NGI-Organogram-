"use server";

import type { Department, JobGrade, Position } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { ensureJobGradeByCode } from "@/lib/services/job-grade.service";
import { randomBytes } from "node:crypto";
import { toAuditActor } from "@/lib/server/audit-actor";
import {
  archivePosition,
  activatePosition,
  createPosition,
  deletePosition,
  movePosition,
  updatePosition,
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
  createPositionSchema,
  listPositionsQuerySchema,
  movePositionSchema,
  positionStatusChangeSchema,
  deletePositionSchema,
  updatePositionSchema,
  type ListPositionsQuery,
} from "@/lib/validation/position";

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
    const { jobGradeCode, ...values } = createPositionSchema.parse(input);
    // A level chosen in the form (e.g. "L7") is resolved to a grade id
    // here, creating the grade from the standard scale on first use.
    const jobGradeId = jobGradeCode
      ? (await ensureJobGradeByCode(user.companyId, jobGradeCode)).id
      : (values.jobGradeId ?? null);
    return createPosition({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
      positionCode: values.positionCode ?? generatePositionCode(),
      jobGradeId,
    });
  });
}

export async function updatePositionAction(input: unknown): Promise<ActionResult<Position>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { jobGradeCode, ...values } = updatePositionSchema.parse(input);
    const jobGradeId =
      jobGradeCode === undefined
        ? values.jobGradeId
        : jobGradeCode === null
          ? null
          : (await ensureJobGradeByCode(user.companyId, jobGradeCode)).id;
    return updatePosition({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
      jobGradeId,
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
