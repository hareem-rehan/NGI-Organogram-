"use server";

import type { Department, JobGrade, Position } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import {
  archivePosition,
  activatePosition,
  createPosition,
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

export async function createPositionAction(input: unknown): Promise<ActionResult<Position>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const values = createPositionSchema.parse(input);
    return createPosition({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function updatePositionAction(input: unknown): Promise<ActionResult<Position>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const values = updatePositionSchema.parse(input);
    return updatePosition({ companyId: user.companyId, actor: toAuditActor(user), ...values });
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
