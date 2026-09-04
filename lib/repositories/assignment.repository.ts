import "server-only";
import type { Position, PositionAssignment } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

/** The currently open-ended (endDate IS NULL) primary occupant of a position, if any. This IS the position's occupancy — see docs/DOMAIN_MODEL.md §4. */
export async function getActivePrimaryAssignmentForPosition(
  positionId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<PositionAssignment | null> {
  return db.positionAssignment.findFirst({
    where: { positionId, companyId, isPrimary: true, endDate: null },
  });
}

/** The employee's currently open-ended primary assignment, if any. */
export async function getActivePrimaryAssignmentForEmployee(
  employeeId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<PositionAssignment | null> {
  return db.positionAssignment.findFirst({
    where: { employeeId, companyId, isPrimary: true, endDate: null },
  });
}

/** Full assignment history for a position (all isPrimary rows), most recent start first — used for overlap validation and history display. */
export async function listPrimaryAssignmentsForPosition(
  positionId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<PositionAssignment[]> {
  return db.positionAssignment.findMany({
    where: { positionId, companyId, isPrimary: true },
    orderBy: { startDate: "desc" },
  });
}

/** Full assignment history for an employee (all isPrimary rows), most recent start first. */
export async function listPrimaryAssignmentsForEmployee(
  employeeId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<PositionAssignment[]> {
  return db.positionAssignment.findMany({
    where: { employeeId, companyId, isPrimary: true },
    orderBy: { startDate: "desc" },
  });
}

export interface AssignmentHistoryRow extends PositionAssignment {
  position: Position;
}

/**
 * Same as `listPrimaryAssignmentsForEmployee`, but with each row's
 * Position included — used only by the employee details page's history
 * table, which needs to show a position's title/code, not a raw id.
 * Deliberately a separate function rather than changing
 * `listPrimaryAssignmentsForEmployee`'s shape, since that one is also
 * used by overlap-validation code that only needs the plain assignment
 * fields.
 */
export async function listAssignmentHistoryWithPositionForEmployee(
  employeeId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<AssignmentHistoryRow[]> {
  return db.positionAssignment.findMany({
    where: { employeeId, companyId, isPrimary: true },
    orderBy: { startDate: "desc" },
    include: { position: true },
  });
}
