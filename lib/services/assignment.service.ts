import "server-only";
import type { Employee, Position, PositionAssignment } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import {
  dateRangesOverlap,
  rangeCoversDate,
  validateAssignmentDateRange,
} from "@/lib/domain/assignment";
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

const day = (date: Date) => date.toISOString().slice(0, 10);
const nameOf = (employee: Pick<Employee, "firstName" | "lastName">) =>
  `${employee.firstName} ${employee.lastName}`;

/**
 * The refusal shown when a new assignment would overlap an existing one
 * for the same employee and position (client report, 2026-11-11, D70): who,
 * which position and which dates, and what to do instead — never raw ids.
 */
function overlapMessage(
  employee: Pick<Employee, "firstName" | "lastName">,
  positionTitle: string,
  existing: { startDate: Date; endDate: Date | null }
): string {
  const held = existing.endDate
    ? `already held ${positionTitle} from ${day(existing.startDate)} to ${day(existing.endDate)}`
    : `already holds ${positionTitle} since ${day(existing.startDate)}`;
  const next = existing.endDate
    ? ` A new assignment there can't start before ${day(existing.endDate)}.`
    : "";
  return `${nameOf(employee)} ${held}, which overlaps these dates.${next} To change when an assignment started, use Edit Start Date; to correct a history row entered by mistake, remove it from the assignment history.`;
}

export interface CreateAssignmentInput {
  companyId: string;
  actor?: AuditActor;
  employeeId: string;
  positionId: string;
  startDate: Date;
  endDate?: Date | null;
}

/**
 * Creates a primary position assignment. A position may hold several
 * employees at once (docs/DECISIONS.md D56); an employee still holds only
 * one open primary position.
 *
 * Concurrency protection is layered (docs/DOMAIN_MODEL.md §7):
 * - Application/transaction level: `SELECT ... FOR UPDATE` on the target
 *   position row serializes concurrent assignment attempts for the same
 *   position, closing the check-then-insert race for the "same employee
 *   twice on this position" check below.
 * - Database level (the authoritative guarantee): a partial unique index
 *   rejects a second open-ended (endDate IS NULL) primary assignment for
 *   the same employee even if the application-level lock were bypassed.
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
    const overlapping = existingForPosition.find(
      (existing) =>
        existing.employeeId === input.employeeId &&
        dateRangesOverlap({ startDate: existing.startDate, endDate: existing.endDate }, dateRange)
    );
    if (overlapping) {
      throw new ConflictError(overlapMessage(employee, position.title, overlapping));
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

/**
 * Corrects an assignment's start date (client request, 2026-11-11, D69) —
 * e.g. it was entered as the day it was keyed in rather than the day the
 * person actually started. The new date is checked like a new assignment:
 * it may not fall after the assignment's end date, and the new range may
 * not overlap any of the employee's other primary assignments (moving a
 * start earlier than the end of the previous position would put them in
 * two positions at once). Changes the date only; the position and the
 * reporting structure are untouched.
 */
export async function changeAssignmentStartDate(
  assignmentId: string,
  companyId: string,
  startDate: Date,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<PositionAssignment> {
  return withTransaction(db, async (tx) => {
    const assignment = await tx.positionAssignment.findFirst({
      where: { id: assignmentId, companyId },
    });
    if (!assignment) throw new NotFoundError("PositionAssignment", assignmentId);

    const dateRange = { startDate, endDate: assignment.endDate };
    if (assignment.endDate && startDate > assignment.endDate) {
      throw new DomainValidationError(
        `The start date can't be after this assignment's end date (${assignment.endDate
          .toISOString()
          .slice(0, 10)}).`
      );
    }
    validateAssignmentDateRange(dateRange);

    // Serializes with any other assignment change for this employee.
    await tx.$queryRaw`SELECT id FROM "employees" WHERE id = ${assignment.employeeId}::uuid FOR UPDATE`;

    const others = await tx.positionAssignment.findMany({
      where: {
        companyId,
        employeeId: assignment.employeeId,
        isPrimary: true,
        id: { not: assignmentId },
      },
      include: { position: { select: { title: true } } },
    });
    const overlapping = others.find((other) =>
      dateRangesOverlap({ startDate: other.startDate, endDate: other.endDate }, dateRange)
    );
    if (overlapping) {
      throw new ConflictError(
        `That start date overlaps the employee's assignment to ${overlapping.position.title} (${day(
          overlapping.startDate
        )} to ${overlapping.endDate ? day(overlapping.endDate) : "now"}). Choose a date on or after that assignment ends, or remove that row from the assignment history if it was entered by mistake.`
      );
    }

    const updated = await tx.positionAssignment.update({
      where: { id: assignmentId },
      data: { startDate },
    });

    await recordAuditEvent(
      {
        companyId,
        actor,
        action: "UPDATED",
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

/**
 * Removes an assignment that was entered by mistake (client request,
 * 2026-11-11, D70), e.g. a duplicate left behind while correcting a start
 * date. Deletes only that one employee-position link: the position, its
 * place in the hierarchy and the employee record are untouched (CLAUDE.md
 * hierarchy invariant 11). The assignment the employee holds TODAY can't be
 * removed this way — End Assignment is the way to stop a real one. Audited
 * as DELETED with the full row, in the same transaction.
 */
export async function removeAssignment(
  assignmentId: string,
  companyId: string,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<PositionAssignment> {
  return withTransaction(db, async (tx) => {
    const assignment = await tx.positionAssignment.findFirst({
      where: { id: assignmentId, companyId },
    });
    if (!assignment) throw new NotFoundError("PositionAssignment", assignmentId);

    // Serializes with any other assignment change for this employee.
    await tx.$queryRaw`SELECT id FROM "employees" WHERE id = ${assignment.employeeId}::uuid FOR UPDATE`;

    if (rangeCoversDate(assignment, new Date())) {
      throw new UnsafeMutationError(
        "This is the employee's current assignment and can't be removed. Use End Assignment to end it, or Edit Start Date to correct when it started."
      );
    }

    await tx.positionAssignment.delete({ where: { id: assignmentId } });

    await recordAuditEvent(
      {
        companyId,
        actor,
        action: "DELETED",
        category: "ASSIGNMENT",
        entityType: "PositionAssignment",
        entityId: assignment.id,
        before: assignment,
      },
      tx
    );
    return assignment;
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
 * the target position is inactive), the whole
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

    // A position may already hold other employees (D56); only moving the
    // employee onto the position they already hold is refused.
    if (current.positionId === input.toPositionId) {
      throw new DomainValidationError(
        `Employee ${input.employeeId} already holds position ${input.toPositionId}.`
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
      `${nameOf(employee)} is ${employee.employmentStatus.toLowerCase()} and can't be given a new position.`
    );
  }
}

/** An INACTIVE (archived) position can never receive a new assignment. PLANNED positions can — a future-dated hire against a not-yet-live position is a legitimate HR planning use case (docs/DECISIONS.md P3/P7-style safe default). */
function assertPositionAcceptsAssignment(position: Position): void {
  if (position.status === "INACTIVE") {
    throw new UnsafeMutationError(`${position.title} is inactive and can't take new assignments.`);
  }
}

function translateAssignmentWriteError(error: unknown): Error {
  if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      return new ConflictError(
        "This employee already holds an active position (concurrent request detected)."
      );
    }
  }
  return error instanceof Error ? error : new Error("Unexpected database error.");
}

/**
 * Sets the employees currently holding a position (docs/DECISIONS.md D56) —
 * the "Assigned employees" field on the Position form. One transaction
 * (docs/DOMAIN_MODEL.md §7, CLAUDE.md §9), with the position row locked so
 * two concurrent saves of the same position cannot interleave:
 *
 * - Employees already holding the position and still listed are untouched.
 * - Employees no longer listed are taken off: their open assignment is ended
 *   today (history preserved), unless it also started today — a same-day
 *   correction that cannot be end-dated (endDate must be after startDate), so
 *   that row is removed instead.
 * - Newly listed employees get a fresh primary assignment starting today,
 *   through `createAssignment` so all its guards apply (an employee who
 *   already holds another position is refused as a conflict).
 * - An empty list leaves the position vacant. The position itself is never
 *   changed (hierarchy-safety invariant 11).
 */
export async function setPositionOccupants(
  input: {
    companyId: string;
    actor?: AuditActor;
    positionId: string;
    employeeIds: readonly string[];
  },
  db: DbClient = prisma
): Promise<void> {
  const actor = input.actor ?? "SYSTEM";
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const wanted = [...new Set(input.employeeIds)];

  await withTransaction(db, async (tx) => {
    const position = await findPositionById(input.positionId, input.companyId, tx);
    if (!position) {
      throw new CrossCompanyError(
        `Position ${input.positionId} does not exist in company ${input.companyId}.`
      );
    }
    await tx.$queryRaw`SELECT id FROM "positions" WHERE id = ${input.positionId}::uuid FOR UPDATE`;

    const current = (
      await listPrimaryAssignmentsForPosition(input.positionId, input.companyId, tx)
    ).filter((assignment) => assignment.endDate === null);
    const currentIds = new Set(current.map((a) => a.employeeId));

    for (const assignment of current) {
      if (wanted.includes(assignment.employeeId)) continue;
      const startedToday = assignment.startDate.getTime() >= today.getTime();
      if (startedToday) {
        await recordAuditEvent(
          {
            companyId: input.companyId,
            actor,
            action: "ASSIGNMENT_ENDED",
            category: "ASSIGNMENT",
            entityType: "PositionAssignment",
            entityId: assignment.id,
            before: assignment,
          },
          tx
        );
        await tx.positionAssignment.delete({ where: { id: assignment.id } });
      } else {
        await endAssignment(assignment.id, input.companyId, today, actor, tx);
      }
    }

    for (const employeeId of wanted) {
      if (currentIds.has(employeeId)) continue;
      await createAssignment(
        {
          companyId: input.companyId,
          actor,
          employeeId,
          positionId: input.positionId,
          startDate: today,
        },
        tx
      );
    }
  });
}
