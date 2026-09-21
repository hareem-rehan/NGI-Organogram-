"use server";

import type { Department, Employee, EmploymentStatus, PositionAssignment } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import {
  changeEmployeeStatus,
  createEmployee,
  terminateEmployee,
  updateEmployee,
  type TerminateEmployeeResult,
} from "@/lib/services/employee.service";
import {
  createAssignment,
  endAssignment,
  transferEmployee,
} from "@/lib/services/assignment.service";
import {
  findEmployeeById,
  listCurrentAssignmentsForEmployees,
  searchEmployees,
  type CurrentAssignmentInfo,
  type EmployeeSearchResult,
} from "@/lib/repositories/employee.repository";
import {
  getPositionAncestorChain,
  searchEligiblePositions,
  type EligiblePosition,
} from "@/lib/repositories/position.repository";
import {
  listAssignmentHistoryWithPositionForEmployee,
  type AssignmentHistoryRow,
} from "@/lib/repositories/assignment.repository";
import { listDepartmentsForCompany } from "@/lib/repositories/department.repository";
import {
  assignEmployeeSchema,
  changeEmployeeStatusSchema,
  createEmployeeSchema,
  eligiblePositionSearchSchema,
  endAssignmentSchema,
  listEmployeesQuerySchema,
  terminateEmployeeSchema,
  transferEmployeeSchema,
  updateEmployeeSchema,
  type ListEmployeesQuery,
} from "@/lib/validation/employee";

export interface EmployeeListPayload extends EmployeeSearchResult {
  currentAssignments: Record<string, CurrentAssignmentInfo>;
}

export async function listEmployeesAction(
  input: ListEmployeesQuery
): Promise<ActionResult<EmployeeListPayload>> {
  return runAction(async () => {
    const user = await requirePermission("employees:view");
    const query = listEmployeesQuerySchema.parse(input);
    const result = await searchEmployees({ companyId: user.companyId, ...query });
    const map = await listCurrentAssignmentsForEmployees(
      result.items.map((e) => e.id),
      user.companyId,
      new Date()
    );
    return { ...result, currentAssignments: Object.fromEntries(map) };
  });
}

export async function listDepartmentOptionsAction(): Promise<ActionResult<Department[]>> {
  return runAction(async () => {
    const user = await requirePermission("employees:view");
    return listDepartmentsForCompany(user.companyId);
  });
}

export interface EmployeeDetailPayload {
  employee: Employee;
  currentAssignment: (CurrentAssignmentInfo & { department: Department | null }) | null;
  managerPositionTitle: string | null;
  history: AssignmentHistoryRow[];
}

export async function getEmployeeDetailAction(
  employeeId: string
): Promise<ActionResult<EmployeeDetailPayload>> {
  return runAction(async () => {
    const user = await requirePermission("employees:view");
    const employee = await findEmployeeById(employeeId, user.companyId);
    if (!employee) throw new Error("Employee not found.");

    const assignmentMap = await listCurrentAssignmentsForEmployees(
      [employeeId],
      user.companyId,
      new Date()
    );
    const currentAssignmentInfo = assignmentMap.get(employeeId) ?? null;

    let department: Department | null = null;
    let managerPositionTitle: string | null = null;
    if (currentAssignmentInfo) {
      const departments = await listDepartmentsForCompany(user.companyId);
      department =
        departments.find((d) => d.id === currentAssignmentInfo.position.departmentId) ?? null;

      if (currentAssignmentInfo.position.primaryReportsToPositionId) {
        const ancestorChain = await getPositionAncestorChain(
          currentAssignmentInfo.position.id,
          user.companyId
        );
        // ancestorChain[0] is the position itself; [1] is its manager, if any.
        managerPositionTitle = ancestorChain[1]?.title ?? null;
      }
    }

    const history = await listAssignmentHistoryWithPositionForEmployee(employeeId, user.companyId);

    return {
      employee,
      currentAssignment: currentAssignmentInfo ? { ...currentAssignmentInfo, department } : null,
      managerPositionTitle,
      history,
    };
  });
}

export async function listEligiblePositionsAction(
  input: unknown
): Promise<ActionResult<EligiblePosition[]>> {
  return runAction(async () => {
    const user = await requirePermission("employees:manage");
    const values = eligiblePositionSearchSchema.parse(input);
    return searchEligiblePositions(
      user.companyId,
      values.search,
      values.effectiveDate ?? new Date()
    );
  });
}

export async function createEmployeeAction(input: unknown): Promise<ActionResult<Employee>> {
  return runAction(async () => {
    const user = await requirePermission("employees:manage");
    const values = createEmployeeSchema.parse(input);
    return createEmployee({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function updateEmployeeAction(input: unknown): Promise<ActionResult<Employee>> {
  return runAction(async () => {
    const user = await requirePermission("employees:manage");
    const values = updateEmployeeSchema.parse(input);
    return updateEmployee({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function changeEmployeeStatusAction(input: unknown): Promise<ActionResult<Employee>> {
  return runAction(async () => {
    const user = await requirePermission("employees:manage");
    const { employeeId, status } = changeEmployeeStatusSchema.parse(input);
    return changeEmployeeStatus(
      employeeId,
      user.companyId,
      status as EmploymentStatus,
      toAuditActor(user)
    );
  });
}

export async function assignEmployeeAction(
  input: unknown
): Promise<ActionResult<PositionAssignment>> {
  return runAction(async () => {
    const user = await requirePermission("employees:manage");
    const values = assignEmployeeSchema.parse(input);
    return createAssignment({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function transferEmployeeAction(
  input: unknown
): Promise<ActionResult<{ ended: PositionAssignment; started: PositionAssignment }>> {
  return runAction(async () => {
    const user = await requirePermission("employees:manage");
    const values = transferEmployeeSchema.parse(input);
    return transferEmployee({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}

export async function endAssignmentAction(
  input: unknown
): Promise<ActionResult<PositionAssignment>> {
  return runAction(async () => {
    const user = await requirePermission("employees:manage");
    const { assignmentId, endDate } = endAssignmentSchema.parse(input);
    return endAssignment(assignmentId, user.companyId, endDate, toAuditActor(user));
  });
}

export async function terminateEmployeeAction(
  input: unknown
): Promise<ActionResult<TerminateEmployeeResult>> {
  return runAction(async () => {
    const user = await requirePermission("employees:manage");
    const values = terminateEmployeeSchema.parse(input);
    return terminateEmployee({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}
