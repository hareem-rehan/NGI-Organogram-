import "server-only";
import type { Employee, Position, PositionAssignment } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { dateRangesOverlap, validateAssignmentDateRange } from "@/lib/domain/assignment";
import {
  ConflictError,
  CrossCompanyError,
  DomainValidationError,
  NotFoundError,
  UnsafeMutationError,
} from "@/lib/domain/errors";
import { findEmployeeById } from "@/lib/repositories/employee.repository";
import { findPositionById } from "@/lib/repositories/position.repository";
import { listPrimaryAssignmentsForPosition } from "@/lib/repositories/assignment.repository";
import type { DbClient } from "@/lib/repositories/types";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export interface CreateAssignmentInput {
  companyId: string;
  actor?: AuditActor;
  employeeId: string;
  positionId: string;
  startDate: Date;
  endDate?: Date | null;
}

/**
 * Creates a primary position assignment.
 *
 * Concurrency protection is layered (docs/DOMAIN_MODEL.md §7):
 * - Application/transaction level: `SELECT ... FOR UPDATE` on the target
 *   position row serializes concurrent assignment attempts for the same
 *   position, closing the check-then-insert race for the general
 *   overlapping-date-range check below.
 * - Database level (the authoritative guarantee for the common case): a
 *   partial unique index rejects a second open-ended (endDate IS NULL)
 *   primary assignment for the same position/employee even if the
 *   application-level lock were somehow bypassed.
 */
export async function createAssignment(
  input: CreateAssignmentInput,
  db: DbClient = prisma
): Promise<PositionAssignment> {
  const dateRange = { startDate: input.startDate, endDate: input.endDate ?? null };
  validateAssignmentDateRange(dateRange);

  return withTransaction(db, async (tx) => {
    const [employee, position] = await Promise.all([
      findEmployeeById(input.employeeId, input.companyId, tx),
      findPositionById(input.positionId, input.companyId, tx),
    ]);
    if (!employee)
      throw new CrossCompanyError(
        `Employee ${input.employeeId} does not exist in company ${input.companyId}.`
      );
    if (!position)
      throw new CrossCompanyError(
        `Position ${input.positionId} does not exist in company ${input.companyId}.`
      );
    assertEmployeeEligibleForAssignment(employee);
    assertPositionAcceptsAssignment(position);

    // Row lock: serializes concurrent createAssignment calls targeting
    // the same position for the remainder of this transaction.
    await tx.$queryRaw`SELECT id FROM "positions" WHERE id = ${input.positionId}::uuid FOR UPDATE`;

    const existingForPosition = await listPrimaryAssignmentsForPosition(
      input.positionId,
      input.companyId,
      tx
    );
    const overlapping = existingForPosition.find((existing) =>
      dateRangesOverlap({ startDate: existing.startDate, endDate: existing.endDate }, dateRange)
    );
    if (overlapping) {
      throw new ConflictError(
        `Position ${input.positionId} already has a primary assignment (${overlapping.id}) overlapping this date range.`
      );
    }

    let created: PositionAssignment;
    try {
      created = await tx.positionAssignment.create({
        data: {
          companyId: input.companyId,
          employeeId: input.employeeId,
          positionId: input.positionId,
          isPrimary: true,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
        },
      });
    } catch (error) {
      throw translateAssignmentWriteError(error);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "ASSIGNED",
        category: "ASSIGNMENT",
        entityType: "PositionAssignment",
        entityId: created.id,
        after: created,
      },
      tx
    );
    return created;
  });
}

/** Ends an assignment on `endDate` (position becomes vacant / employee's slot frees up from that date forward). */
export async function endAssignment(
  assignmentId: string,
  companyId: string,
  endDate: Date,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<PositionAssignment> {
  return withTransaction(db, async (tx) => {
    const assignment = await tx.positionAssignment.findFirst({
      where: { id: assignmentId, companyId },
    });
    if (!assignment) throw new NotFoundError("PositionAssignment", assignmentId);

    validateAssignmentDateRange({ startDate: assignment.startDate, endDate });

    const updated = await tx.positionAssignment.update({
      where: { id: assignmentId },
      data: { endDate },
    });

    await recordAuditEvent(
      {
        companyId,
        actor,
        action: "ASSIGNMENT_ENDED",
        category: "ASSIGNMENT",
        entityType: "PositionAssignment",
        entityId: updated.id,
        before: assignment,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export interface TransferEmployeeInput {
  companyId: string;
  actor?: AuditActor;
  employeeId: string;
  fromAssignmentId: string;
  toPositionId: string;
  transferDate: Date;
}

/**
 * Ends the employee's current assignment and creates a new one on the
 * new position, atomically. If the new assignment fails validation (e.g.
 * the target position already has an active occupant), the whole
 * transaction rolls back — the original assignment is NOT ended, so the
 * employee never ends up with zero active assignments due to a failed
 * transfer (docs/NEGATIVE_SCENARIOS.md "Failed employee transfer
 * requiring rollback").
 */
export async function transferEmployee(
  input: TransferEmployeeInput,
  db: DbClient = prisma
): Promise<{
  ended: PositionAssignment;
  started: PositionAssignment;
}> {
  return withTransaction(db, async (tx) => {
    const current = await tx.positionAssignment.findFirst({
      where: {
        id: input.fromAssignmentId,
        companyId: input.companyId,
        employeeId: input.employeeId,
      },
    });
    if (!current) throw new NotFoundError("PositionAssignment", input.fromAssignmentId);
    if (current.endDate !== null) {
      throw new DomainValidationError(
        `Assignment ${input.fromAssignmentId} is already ended and cannot be the source of a transfer.`
      );
    }

    // Re-check eligibility inside the transaction: guards against a
    // concurrent termination racing this transfer (docs/NEGATIVE_SCENARIOS.md
    // "simultaneous transfer and termination").
    const employee = await findEmployeeById(input.employeeId, input.companyId, tx);
    if (!employee) {
      throw new CrossCompanyError(
        `Employee ${input.employeeId} does not exist in company ${input.companyId}.`
      );
    }
    assertEmployeeEligibleForAssignment(employee);

    validateAssignmentDateRange({ startDate: current.startDate, endDate: input.transferDate });

    const toPosition = await findPositionById(input.toPositionId, input.companyId, tx);
    if (!toPosition) {
      throw new CrossCompanyError(
        `Position ${input.toPositionId} does not exist in company ${input.companyId}.`
      );
    }
    assertPositionAcceptsAssignment(toPosition);

    await tx.$queryRaw`SELECT id FROM "positions" WHERE id = ${input.toPositionId}::uuid FOR UPDATE`;

    const existingForNewPosition = await listPrimaryAssignmentsForPosition(
      input.toPositionId,
      input.companyId,
      tx
    );
    const newRange = { startDate: input.transferDate, endDate: null };
    const overlapping = existingForNewPosition.find((existing) =>
      dateRangesOverlap({ startDate: existing.startDate, endDate: existing.endDate }, newRange)
    );
    if (overlapping) {
      throw new ConflictError(
        `Position ${input.toPositionId} already has an active primary assignment (${overlapping.id}) — cannot transfer into it.`
      );
    }

    const ended = await tx.positionAssignment.update({
      where: { id: input.fromAssignmentId },
      data: { endDate: input.transferDate },
    });

    let started: PositionAssignment;
    try {
      started = await tx.positionAssignment.create({
        data: {
          companyId: input.companyId,
          employeeId: input.employeeId,
          positionId: input.toPositionId,
          isPrimary: true,
          startDate: input.transferDate,
          endDate: null,
        },
      });
    } catch (error) {
      throw translateAssignmentWriteError(error);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "TRANSFERRED",
        category: "ASSIGNMENT",
        entityType: "PositionAssignment",
        entityId: started.id,
        before: current,
        after: started,
        metadata: { fromAssignmentId: ended.id, toPositionId: input.toPositionId },
      },
      tx
    );
    return { ended, started };
  });
}

/**
 * A TERMINATED or TRANSFERRED employee can never receive a new
 * assignment — docs/DATA_DICTIONARY.md's two "deactivate via" statuses.
 * Only ACTIVE employees are eligible. Checked inside the same
 * transaction as the write, not just at the UI layer.
 */
function assertEmployeeEligibleForAssignment(employee: Employee): void {
  if (employee.employmentStatus !== "ACTIVE") {
    throw new UnsafeMutationError(
      `Employee ${employee.id} has status ${employee.employmentStatus} and cannot receive a new assignment.`
    );
  }
}

/** An INACTIVE (archived) position can never receive a new assignment. PLANNED positions can — a future-dated hire against a not-yet-live position is a legitimate HR planning use case (docs/DECISIONS.md P3/P7-style safe default). */
function assertPositionAcceptsAssignment(position: Position): void {
  if (position.status === "INACTIVE") {
    throw new UnsafeMutationError(
      `Position ${position.id} is inactive and cannot receive a new assignment.`
    );
  }
}

function translateAssignmentWriteError(error: unknown): Error {
  if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      return new ConflictError(
        "This position or employee already has an active primary assignment (concurrent request detected)."
      );
    }
  }
  return error instanceof Error ? error : new Error("Unexpected database error.");
}
