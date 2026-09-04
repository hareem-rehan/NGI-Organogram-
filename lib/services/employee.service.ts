import "server-only";
import type { Employee, EmploymentStatus, Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { normalizeCode, normalizeWorkEmail } from "@/lib/domain/normalize";
import { validateAssignmentDateRange } from "@/lib/domain/assignment";
import { ConflictError, DomainValidationError, NotFoundError } from "@/lib/domain/errors";
import { findEmployeeById } from "@/lib/repositories/employee.repository";
import { getActivePrimaryAssignmentForEmployee } from "@/lib/repositories/assignment.repository";
import type { DbClient } from "@/lib/repositories/types";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export interface CreateEmployeeInput {
  companyId: string;
  actor?: AuditActor;
  employeeCode: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  workEmail?: string | null;
  joiningDate?: Date | null;
}

/**
 * Creates an Employee record only — never touches Position or
 * PositionAssignment (business rule 2: Employee and Position are
 * separate entities). An employee created this way starts unassigned;
 * assigning them to a position is a separate operation
 * (lib/services/assignment.service.ts's `createAssignment`).
 *
 * Deliberately does NOT create or link an Auth.js `User` row — creating
 * an Employee never grants application access (docs/AUTHORIZATION_MATRIX.md,
 * docs/DECISIONS.md "Employee/User separation").
 */
export async function createEmployee(
  input: CreateEmployeeInput,
  db: DbClient = prisma
): Promise<Employee> {
  const employeeCode = normalizeCode(input.employeeCode);
  const workEmail = normalizeWorkEmail(input.workEmail);

  return withTransaction(db, async (tx) => {
    let created: Employee;
    try {
      created = await tx.employee.create({
        data: {
          companyId: input.companyId,
          employeeCode,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          preferredName: input.preferredName?.trim() || null,
          workEmail,
          joiningDate: input.joiningDate ?? null,
        },
      });
    } catch (error) {
      throw translateWriteError(error, employeeCode, workEmail);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "CREATED",
        category: "EMPLOYEE",
        entityType: "Employee",
        entityId: created.id,
        entityDisplayReference: created.employeeCode,
        after: created,
      },
      tx
    );
    return created;
  });
}

export interface UpdateEmployeeInput {
  companyId: string;
  actor?: AuditActor;
  employeeId: string;
  employeeCode?: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string | null;
  workEmail?: string | null;
  joiningDate?: Date | null;
  leavingDate?: Date | null;
}

/**
 * Updates an employee's own fields. Deliberately does NOT accept
 * `employmentStatus` — use `changeEmployeeStatus`/`terminateEmployee` for
 * that, so a plain detail correction can never accidentally also change
 * lifecycle state. Never accepts department/manager/organizational
 * level/job grade — those are always derived from the employee's active
 * position (docs/DOMAIN_MODEL.md), never stored on Employee, so there is
 * no field here for a caller to even attempt to set them.
 */
export async function updateEmployee(
  input: UpdateEmployeeInput,
  db: DbClient = prisma
): Promise<Employee> {
  return withTransaction(db, async (tx) => {
    const existing = await findEmployeeById(input.employeeId, input.companyId, tx);
    if (!existing) throw new NotFoundError("Employee", input.employeeId);

    const employeeCode =
      input.employeeCode !== undefined ? normalizeCode(input.employeeCode) : undefined;
    const workEmail =
      input.workEmail !== undefined ? normalizeWorkEmail(input.workEmail) : undefined;

    let updated: Employee;
    try {
      updated = await tx.employee.update({
        where: { id: input.employeeId },
        data: {
          ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
          ...(input.preferredName !== undefined
            ? { preferredName: input.preferredName?.trim() || null }
            : {}),
          ...(employeeCode !== undefined ? { employeeCode } : {}),
          ...(workEmail !== undefined ? { workEmail } : {}),
          ...(input.joiningDate !== undefined ? { joiningDate: input.joiningDate } : {}),
          ...(input.leavingDate !== undefined ? { leavingDate: input.leavingDate } : {}),
        },
      });
    } catch (error) {
      throw translateWriteError(error, employeeCode ?? existing.employeeCode, workEmail ?? null);
    }

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "UPDATED",
        category: "EMPLOYEE",
        entityType: "Employee",
        entityId: updated.id,
        entityDisplayReference: updated.employeeCode,
        before: existing,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

/**
 * Sets `employmentStatus` directly — the general-purpose status
 * control (e.g. correcting a mistake, or recording an employee as
 * TRANSFERRED to a different legal entity outside this org chart,
 * docs/DATA_DICTIONARY.md's "Deactivate via employmentStatus =
 * TERMINATED/TRANSFERRED"). For the guided termination workflow (ends
 * the active assignment, requires a termination date, requires
 * confirmation), use `terminateEmployee` instead — it wraps this
 * function inside the same transaction as ending the assignment.
 */
export async function changeEmployeeStatus(
  employeeId: string,
  companyId: string,
  status: EmploymentStatus,
  actor: AuditActor = "SYSTEM",
  db: DbClient = prisma
): Promise<Employee> {
  return withTransaction(db, async (tx) => {
    const existing = await findEmployeeById(employeeId, companyId, tx);
    if (!existing) throw new NotFoundError("Employee", employeeId);

    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { employmentStatus: status },
    });

    await recordAuditEvent(
      {
        companyId,
        actor,
        action: "UPDATED",
        category: "EMPLOYEE",
        entityType: "Employee",
        entityId: updated.id,
        entityDisplayReference: updated.employeeCode,
        before: existing,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export interface TerminateEmployeeInput {
  companyId: string;
  actor?: AuditActor;
  employeeId: string;
  terminationDate: Date;
}

export interface TerminateEmployeeResult {
  employee: Employee;
  endedAssignmentId: string | null;
}

/**
 * The guided termination workflow: ends the employee's currently open
 * primary assignment (if any) on `terminationDate`, sets
 * `employmentStatus = TERMINATED` and `leavingDate = terminationDate`,
 * all inside one transaction. An employee with no active assignment can
 * still be terminated (nothing to end). Never touches the Position row
 * — it persists, unaffected, and becomes vacant only because its
 * assignment ended, not because anything about the position itself
 * changed (docs/DOMAIN_MODEL.md, business rule 4 — employee departure
 * must not delete the position).
 */
export async function terminateEmployee(
  input: TerminateEmployeeInput,
  db: DbClient = prisma
): Promise<TerminateEmployeeResult> {
  return withTransaction(db, async (tx) => {
    const existing = await findEmployeeById(input.employeeId, input.companyId, tx);
    if (!existing) throw new NotFoundError("Employee", input.employeeId);
    if (existing.employmentStatus === "TERMINATED") {
      throw new DomainValidationError(`Employee ${input.employeeId} is already terminated.`);
    }

    const activeAssignment = await getActivePrimaryAssignmentForEmployee(
      input.employeeId,
      input.companyId,
      tx
    );

    let endedAssignmentId: string | null = null;
    if (activeAssignment) {
      validateAssignmentDateRange({
        startDate: activeAssignment.startDate,
        endDate: input.terminationDate,
      });
      const endedAssignment = await tx.positionAssignment.update({
        where: { id: activeAssignment.id },
        data: { endDate: input.terminationDate },
      });
      endedAssignmentId = endedAssignment.id;

      await recordAuditEvent(
        {
          companyId: input.companyId,
          actor: input.actor ?? "SYSTEM",
          action: "ASSIGNMENT_ENDED",
          category: "ASSIGNMENT",
          entityType: "PositionAssignment",
          entityId: endedAssignment.id,
          before: activeAssignment,
          after: endedAssignment,
          metadata: { reason: "employee terminated" },
        },
        tx
      );
    }

    const employee = await tx.employee.update({
      where: { id: input.employeeId },
      data: { employmentStatus: "TERMINATED", leavingDate: input.terminationDate },
    });

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "TERMINATED",
        category: "EMPLOYEE",
        entityType: "Employee",
        entityId: employee.id,
        entityDisplayReference: employee.employeeCode,
        before: existing,
        after: employee,
      },
      tx
    );

    return { employee, endedAssignmentId };
  });
}

/** Exported for reuse by lib/services/import.service.ts's bulk-create path (Phase 13.1). */
export function translateWriteError(
  error: unknown,
  employeeCode: string,
  workEmail: string | null
): Error {
  if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      const target = (error.meta?.target as string[] | undefined) ?? [];
      if (target.includes("workEmail") && workEmail) {
        return new ConflictError(`Work email "${workEmail}" is already in use in this company.`);
      }
      return new ConflictError(
        `Employee code "${employeeCode}" is already in use in this company.`
      );
    }
  }
  return error instanceof Error ? error : new Error("Unexpected database error.");
}

// Re-exported for callers that need the transaction-client type for composition.
export type { Prisma };
