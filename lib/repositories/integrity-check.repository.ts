// Deliberately no `import "server-only"` here (unlike every other file in
// lib/repositories/) — this module is consumed directly by
// scripts/check-domain-integrity.ts, a plain Node/tsx CLI process, not
// only from Next.js server components/actions. `server-only`'s guard
// throws unconditionally outside a bundler context (confirmed by
// running the script), so it cannot be used in a module a CLI script
// imports.
import type { PrismaClient } from "@prisma/client";

import type {
  IntegrityAssignmentRow,
  IntegrityAuditEventRow,
  IntegrityCheckInput,
  IntegrityEmployeeRow,
  IntegrityPositionRow,
  IntegritySessionRow,
  IntegrityUserRow,
} from "@/lib/domain/integrity-check";

/**
 * Fetches every row the domain-integrity checks need, across ALL
 * companies — this is a system-wide release diagnostic
 * (scripts/check-domain-integrity.ts), not a company-scoped feature, so
 * unlike every other repository in this app it does not take a
 * `companyId` filter. Read-only: never writes, never repairs.
 */
export async function fetchIntegrityCheckInput(db: PrismaClient): Promise<IntegrityCheckInput> {
  const [positions, employees, assignments, users, sessions, auditEvents] = await Promise.all([
    db.position.findMany({
      select: {
        id: true,
        companyId: true,
        positionCode: true,
        primaryReportsToPositionId: true,
        organizationalLevel: true,
      },
    }),
    db.employee.findMany({
      select: { id: true, companyId: true, employeeCode: true },
    }),
    db.positionAssignment.findMany({
      select: {
        id: true,
        companyId: true,
        employeeId: true,
        positionId: true,
        isPrimary: true,
        startDate: true,
        endDate: true,
        employee: { select: { companyId: true } },
        position: { select: { companyId: true } },
      },
    }),
    db.user.findMany({
      select: {
        id: true,
        companyId: true,
        role: true,
        status: true,
        linkedEmployeeId: true,
        linkedEmployee: { select: { companyId: true } },
      },
    }),
    db.session.findMany({
      select: { id: true, userId: true, user: { select: { status: true } } },
    }),
    db.auditEvent.findMany({
      select: {
        id: true,
        companyId: true,
        actorUserId: true,
        actor: { select: { companyId: true } },
        importJobId: true,
        importJob: { select: { companyId: true } },
        exportJobId: true,
        exportJob: { select: { companyId: true } },
      },
    }),
  ]);

  const positionRows: IntegrityPositionRow[] = positions;

  const employeeRows: IntegrityEmployeeRow[] = employees;

  const assignmentRows: IntegrityAssignmentRow[] = assignments.map((a) => ({
    id: a.id,
    companyId: a.companyId,
    employeeId: a.employeeId,
    positionId: a.positionId,
    isPrimary: a.isPrimary,
    startDate: a.startDate,
    endDate: a.endDate,
    employeeCompanyId: a.employee.companyId,
    positionCompanyId: a.position.companyId,
  }));

  const userRows: IntegrityUserRow[] = users.map((u) => ({
    id: u.id,
    companyId: u.companyId,
    role: u.role,
    status: u.status,
    linkedEmployeeId: u.linkedEmployeeId,
    linkedEmployeeCompanyId: u.linkedEmployee?.companyId ?? null,
  }));

  const sessionRows: IntegritySessionRow[] = sessions.map((s) => ({
    id: s.id,
    userId: s.userId,
    userStatus: s.user.status,
  }));

  const auditEventRows: IntegrityAuditEventRow[] = auditEvents.map((e) => ({
    id: e.id,
    companyId: e.companyId,
    actorUserId: e.actorUserId,
    actorUserCompanyId: e.actor?.companyId ?? null,
    importJobId: e.importJobId,
    importJobCompanyId: e.importJob?.companyId ?? null,
    exportJobId: e.exportJobId,
    exportJobCompanyId: e.exportJob?.companyId ?? null,
  }));

  return {
    positions: positionRows,
    employees: employeeRows,
    assignments: assignmentRows,
    users: userRows,
    sessions: sessionRows,
    auditEvents: auditEventRows,
  };
}
