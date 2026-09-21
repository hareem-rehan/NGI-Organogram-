import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, serviceMocks, employeeRepoMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMocks: {
    listUsers: vi.fn(),
    getUser: vi.fn(),
    provisionUser: vi.fn(),
    changeUserRole: vi.fn(),
    disableUser: vi.fn(),
    reactivateUser: vi.fn(),
    linkEmployee: vi.fn(),
    unlinkEmployee: vi.fn(),
  },
  employeeRepoMock: { searchEmployees: vi.fn() },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/user-admin.service", () => serviceMocks);
vi.mock("@/lib/repositories/employee.repository", () => employeeRepoMock);

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import {
  changeUserRoleAction,
  disableUserAction,
  getUserAction,
  linkEmployeeAction,
  listUsersAction,
  provisionUserAction,
  reactivateUserAction,
  searchEmployeesForLinkingAction,
  unlinkEmployeeAction,
} from "./actions";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_USER = {
  id: "u_1",
  name: "Admin User",
  email: "admin@northwind-example.test",
  role: "ADMIN",
  companyId: "company-trusted",
  status: "ACTIVE",
};

afterEach(() => vi.clearAllMocks());

const invocations: [
  string,
  () => Promise<unknown>,
  keyof typeof serviceMocks | "searchEmployees",
][] = [
  ["listUsersAction", () => listUsersAction({}), "listUsers"],
  ["getUserAction", () => getUserAction({ userId: USER_ID }), "getUser"],
  [
    "searchEmployeesForLinkingAction",
    () => searchEmployeesForLinkingAction(undefined),
    "searchEmployees",
  ],
  [
    "provisionUserAction",
    () => provisionUserAction({ email: "new@northwind-example.test", role: "VIEWER" }),
    "provisionUser",
  ],
  [
    "changeUserRoleAction",
    () => changeUserRoleAction({ userId: USER_ID, newRole: "HR_EDITOR" }),
    "changeUserRole",
  ],
  ["disableUserAction", () => disableUserAction({ userId: USER_ID }), "disableUser"],
  ["reactivateUserAction", () => reactivateUserAction({ userId: USER_ID }), "reactivateUser"],
  [
    "linkEmployeeAction",
    () => linkEmployeeAction({ userId: USER_ID, employeeId: EMPLOYEE_ID }),
    "linkEmployee",
  ],
  ["unlinkEmployeeAction", () => unlinkEmployeeAction({ userId: USER_ID }), "unlinkEmployee"],
];

describe("users server actions — authorization", () => {
  for (const [name, invoke, serviceKey] of invocations) {
    it(`${name} requires users:manage and never reaches the service layer for a VIEWER-role rejection`, async () => {
      requirePermissionMock.mockRejectedValue(new ForbiddenError());
      const result = await invoke();
      expect(result).toEqual({
        ok: false,
        error: "You don't have permission to do that.",
        authRedirect: "/access-denied",
      });
      const mockFn =
        serviceKey === "searchEmployees"
          ? employeeRepoMock.searchEmployees
          : serviceMocks[serviceKey];
      expect(mockFn).not.toHaveBeenCalled();
    });

    it(`${name} blocks an unauthenticated caller`, async () => {
      requirePermissionMock.mockRejectedValue(new UnauthenticatedError());
      const result = (await invoke()) as { ok: boolean; authRedirect?: string };
      expect(result.ok).toBe(false);
      expect(result.authRedirect).toBe("/sign-in");
    });

    it(`${name} checks users:manage specifically`, async () => {
      requirePermissionMock.mockResolvedValue(ADMIN_USER);
      const mockFn =
        serviceKey === "searchEmployees"
          ? employeeRepoMock.searchEmployees
          : serviceMocks[serviceKey];
      mockFn.mockResolvedValue({});
      await invoke();
      expect(requirePermissionMock).toHaveBeenCalledWith("users:manage");
    });
  }

  it("provisionUserAction derives actor from the session, never from client input", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.provisionUser.mockResolvedValue({ id: USER_ID });

    await provisionUserAction({
      email: "new@northwind-example.test",
      role: "VIEWER",
      companyId: "attacker-company",
    });

    expect(serviceMocks.provisionUser).not.toHaveBeenCalled();
  });

  it("changeUserRoleAction rejects an unsupported role value before the service layer ever runs", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const result = await changeUserRoleAction({ userId: USER_ID, newRole: "SUPER_ADMIN" });
    expect(result.ok).toBe(false);
    expect(serviceMocks.changeUserRole).not.toHaveBeenCalled();
  });
});
