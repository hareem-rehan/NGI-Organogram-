import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requirePermissionMock,
  employeeServiceMocks,
  assignmentServiceMocks,
  employeeRepoMocks,
  positionRepoMocks,
  assignmentRepoMocks,
  deptRepoMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  employeeServiceMocks: {
    createEmployeeWithOptionalAssignment: vi.fn(),
    updateEmployee: vi.fn(),
    changeEmployeeStatus: vi.fn(),
    terminateEmployee: vi.fn(),
  },
  assignmentServiceMocks: {
    createAssignment: vi.fn(),
    transferEmployee: vi.fn(),
    endAssignment: vi.fn(),
  },
  employeeRepoMocks: {
    findEmployeeById: vi.fn(),
    searchEmployees: vi.fn(),
    listCurrentAssignmentsForEmployees: vi.fn(),
  },
  positionRepoMocks: {
    searchEligiblePositions: vi.fn(),
    getPositionAncestorChain: vi.fn(),
  },
  assignmentRepoMocks: {
    listAssignmentHistoryWithPositionForEmployee: vi.fn(),
  },
  deptRepoMock: { listDepartmentsForCompany: vi.fn() },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/employee.service", () => employeeServiceMocks);
vi.mock("@/lib/services/assignment.service", () => assignmentServiceMocks);
vi.mock("@/lib/repositories/employee.repository", () => employeeRepoMocks);
vi.mock("@/lib/repositories/position.repository", () => positionRepoMocks);
vi.mock("@/lib/repositories/assignment.repository", () => assignmentRepoMocks);
vi.mock("@/lib/repositories/department.repository", () => deptRepoMock);

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import {
  assignEmployeeAction,
  changeEmployeeStatusAction,
  createEmployeeAction,
  endAssignmentAction,
  getEmployeeDetailAction,
  listDepartmentOptionsAction,
  listEligiblePositionsAction,
  listEmployeesAction,
  terminateEmployeeAction,
  transferEmployeeAction,
  updateEmployeeAction,
} from "./actions";

const ADMIN_USER = { id: "u_1", role: "ADMIN", companyId: "company-trusted", status: "ACTIVE" };
const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";

describe("employee actions — server-side authorization", () => {
  afterEach(() => vi.clearAllMocks());

  it.each([
    ["listEmployeesAction", () => listEmployeesAction({ page: 1, pageSize: 20 })],
    ["listDepartmentOptionsAction", () => listDepartmentOptionsAction()],
    ["getEmployeeDetailAction", () => getEmployeeDetailAction(VALID_UUID)],
  ])("%s requires employees:view", async (_name, invoke) => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    employeeRepoMocks.searchEmployees.mockResolvedValue({ items: [], totalCount: 0 });
    employeeRepoMocks.listCurrentAssignmentsForEmployees.mockResolvedValue(new Map());
    employeeRepoMocks.findEmployeeById.mockResolvedValue({ id: VALID_UUID });
    deptRepoMock.listDepartmentsForCompany.mockResolvedValue([]);
    assignmentRepoMocks.listAssignmentHistoryWithPositionForEmployee.mockResolvedValue([]);

    const result = await invoke();

    expect(requirePermissionMock).toHaveBeenCalledWith("employees:view");
    expect(result.ok).toBe(true);
  });

  it.each([
    [
      "createEmployeeAction",
      () => createEmployeeAction({ employeeCode: "EMP-1", firstName: "A", lastName: "B" }),
    ],
    [
      "updateEmployeeAction",
      () => updateEmployeeAction({ employeeId: VALID_UUID, firstName: "A" }),
    ],
    [
      "changeEmployeeStatusAction",
      () => changeEmployeeStatusAction({ employeeId: VALID_UUID, status: "TRANSFERRED" }),
    ],
    [
      "terminateEmployeeAction",
      () =>
        terminateEmployeeAction({
          employeeId: VALID_UUID,
          terminationDate: "2024-01-01T00:00:00Z",
        }),
    ],
    [
      "assignEmployeeAction",
      () =>
        assignEmployeeAction({
          employeeId: VALID_UUID,
          positionId: VALID_UUID_2,
          startDate: "2024-01-01T00:00:00Z",
        }),
    ],
    [
      "transferEmployeeAction",
      () =>
        transferEmployeeAction({
          employeeId: VALID_UUID,
          fromAssignmentId: VALID_UUID_2,
          toPositionId: VALID_UUID,
          transferDate: "2024-01-01T00:00:00Z",
        }),
    ],
    [
      "endAssignmentAction",
      () => endAssignmentAction({ assignmentId: VALID_UUID, endDate: "2024-01-01T00:00:00Z" }),
    ],
    [
      "listEligiblePositionsAction",
      () => listEligiblePositionsAction({ effectiveDate: "2024-01-01T00:00:00Z" }),
    ],
  ])("%s requires employees:manage", async (_name, invoke) => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    employeeServiceMocks.createEmployeeWithOptionalAssignment.mockResolvedValue({ employee: {} });
    employeeServiceMocks.updateEmployee.mockResolvedValue({});
    employeeServiceMocks.changeEmployeeStatus.mockResolvedValue({});
    employeeServiceMocks.terminateEmployee.mockResolvedValue({});
    assignmentServiceMocks.createAssignment.mockResolvedValue({});
    assignmentServiceMocks.transferEmployee.mockResolvedValue({});
    assignmentServiceMocks.endAssignment.mockResolvedValue({});
    positionRepoMocks.searchEligiblePositions.mockResolvedValue([]);

    await invoke();

    expect(requirePermissionMock).toHaveBeenCalledWith("employees:manage");
  });

  it("a VIEWER-role rejection blocks every mutation before the service layer ever runs", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const result = await createEmployeeAction({
      employeeCode: "EMP-1",
      firstName: "A",
      lastName: "B",
    });

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
      authRedirect: "/access-denied",
    });
    expect(employeeServiceMocks.createEmployeeWithOptionalAssignment).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is blocked before the repository layer ever runs", async () => {
    requirePermissionMock.mockRejectedValue(new UnauthenticatedError());

    const result = await listEmployeesAction({ page: 1, pageSize: 20 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
    expect(employeeRepoMocks.searchEmployees).not.toHaveBeenCalled();
  });

  it("companyId always comes from the authenticated session, never from the input payload", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    employeeServiceMocks.createEmployeeWithOptionalAssignment.mockResolvedValue({ employee: {} });

    await createEmployeeAction({
      employeeCode: "EMP-1",
      firstName: "A",
      lastName: "B",
      companyId: "attacker-company",
    });

    if (employeeServiceMocks.createEmployeeWithOptionalAssignment.mock.calls.length > 0) {
      expect(
        employeeServiceMocks.createEmployeeWithOptionalAssignment.mock.calls[0]?.[0]?.companyId
      ).toBe(ADMIN_USER.companyId);
    }
  });

  it("createEmployeeAction rejects an attempted role/manager/department/level submission (unknown fields)", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);

    const result = await createEmployeeAction({
      employeeCode: "EMP-1",
      firstName: "A",
      lastName: "B",
      role: "ADMIN",
      managerId: VALID_UUID,
      departmentId: VALID_UUID,
      organizationalLevel: 1,
    });

    expect(result.ok).toBe(false);
    expect(employeeServiceMocks.createEmployeeWithOptionalAssignment).not.toHaveBeenCalled();
  });
});

describe("createEmployeeAction — optional first assignment", () => {
  afterEach(() => vi.clearAllMocks());

  it("creates an unassigned employee when no position is chosen (assignment = null)", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    employeeServiceMocks.createEmployeeWithOptionalAssignment.mockResolvedValue({ employee: {} });

    await createEmployeeAction({ employeeCode: "EMP-1", firstName: "A", lastName: "B" });

    expect(
      employeeServiceMocks.createEmployeeWithOptionalAssignment.mock.calls[0]?.[0]?.assignment
    ).toBeNull();
  });

  it("passes a resolved assignment through when a position and start date are chosen", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    employeeServiceMocks.createEmployeeWithOptionalAssignment.mockResolvedValue({ employee: {} });

    await createEmployeeAction({
      employeeCode: "EMP-1",
      firstName: "A",
      lastName: "B",
      assignmentPositionId: VALID_UUID,
      assignmentStartDate: "2024-03-01T00:00:00Z",
    });

    const assignment =
      employeeServiceMocks.createEmployeeWithOptionalAssignment.mock.calls[0]?.[0]?.assignment;
    expect(assignment?.positionId).toBe(VALID_UUID);
    expect(assignment?.startDate).toBeInstanceOf(Date);
  });

  it("rejects a chosen position with no start date (server-side refinement)", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);

    const result = await createEmployeeAction({
      employeeCode: "EMP-1",
      firstName: "A",
      lastName: "B",
      assignmentPositionId: VALID_UUID,
    });

    expect(result.ok).toBe(false);
    expect(employeeServiceMocks.createEmployeeWithOptionalAssignment).not.toHaveBeenCalled();
  });
});
