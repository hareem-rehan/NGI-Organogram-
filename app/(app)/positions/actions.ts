"use server";

import type {
  CareerTrack,
  Department,
  JobFamily,
  JobGrade,
  LevelMappingEntry,
  Position,
} from "@prisma/client";

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
  listCareerTracksForCompany,
  listJobFamiliesForCompany,
  listLevelMappingEntriesForCompany,
} from "@/lib/repositories/career-framework.repository";
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

export interface PositionCareerOptions {
  jobFamilies: JobFamily[];
  careerTracks: CareerTrack[];
  levelMappingEntries: LevelMappingEntry[];
}

/** Career-framework options for the Position form's Sub-division / Track dropdowns and title suggestions. Read-only, needs only positions:view. */
export async function listPositionCareerOptionsAction(): Promise<
  ActionResult<PositionCareerOptions>
> {
  return runAction(async () => {
    const user = await requirePermission("positions:view");
    const [jobFamilies, careerTracks, levelMappingEntries] = await Promise.all([
      listJobFamiliesForCompany(user.companyId),
      listCareerTracksForCompany(user.companyId),
      listLevelMappingEntriesForCompany(user.companyId),
    ]);
    return { jobFamilies, careerTracks, levelMappingEntries };
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
