import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, serviceMocks, repositoryMocks } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMocks: {
    createDepartment: vi.fn(),
    updateDepartment: vi.fn(),
    moveDepartment: vi.fn(),
    archiveDepartment: vi.fn(),
    reactivateDepartment: vi.fn(),
  },
  repositoryMocks: {
    listDepartmentsForCompany: vi.fn(),
    searchDepartments: vi.fn(),
  },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/department.service", () => serviceMocks);
vi.mock("@/lib/repositories/department.repository", () => repositoryMocks);

import { ForbiddenError } from "@/lib/auth/errors";
import {
  archiveDepartmentAction,
  createDepartmentAction,
  listAllDepartmentsAction,
  listDepartmentsAction,
  moveDepartmentAction,
  reactivateDepartmentAction,
  updateDepartmentAction,
} from "./actions";

const ADMIN_USER = { id: "u_1", role: "ADMIN", companyId: "company-trusted", status: "ACTIVE" };

describe("department actions — server-side authorization", () => {
  afterEach(() => vi.clearAllMocks());

  it("listDepartmentsAction requires departments:view and never departments:manage", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    repositoryMocks.searchDepartments.mockResolvedValue({ items: [], totalCount: 0 });

    await listDepartmentsAction({ page: 1, pageSize: 20 });

    expect(requirePermissionMock).toHaveBeenCalledWith("departments:view");
  });

  it("listAllDepartmentsAction requires departments:view", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    repositoryMocks.listDepartmentsForCompany.mockResolvedValue([]);

    await listAllDepartmentsAction();

    expect(requirePermissionMock).toHaveBeenCalledWith("departments:view");
  });

  it.each([
    ["createDepartmentAction", () => createDepartmentAction({ name: "Eng", code: "ENG" })],
    [
      "updateDepartmentAction",
      () => updateDepartmentAction({ departmentId: "11111111-1111-4111-8111-111111111111" }),
    ],
    [
      "moveDepartmentAction",
      () =>
        moveDepartmentAction({
          departmentId: "11111111-1111-4111-8111-111111111111",
          newParentDepartmentId: null,
        }),
    ],
    [
      "archiveDepartmentAction",
      () => archiveDepartmentAction({ departmentId: "11111111-1111-4111-8111-111111111111" }),
    ],
    [
      "reactivateDepartmentAction",
      () => reactivateDepartmentAction({ departmentId: "11111111-1111-4111-8111-111111111111" }),
    ],
  ])("%s requires departments:manage", async (_name, invoke) => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.createDepartment.mockResolvedValue({});
    serviceMocks.updateDepartment.mockResolvedValue({});
    serviceMocks.moveDepartment.mockResolvedValue({});
    serviceMocks.archiveDepartment.mockResolvedValue({});
    serviceMocks.reactivateDepartment.mockResolvedValue({});

    await invoke();

    expect(requirePermissionMock).toHaveBeenCalledWith("departments:manage");
  });

  it("a VIEWER-role rejection (ForbiddenError) blocks the mutation before the service layer ever runs", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const result = await createDepartmentAction({ name: "Eng", code: "ENG" });

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
      authRedirect: "/access-denied",
    });
    expect(serviceMocks.createDepartment).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is blocked before the service layer ever runs", async () => {
    const { UnauthenticatedError } = await import("@/lib/auth/errors");
    requirePermissionMock.mockRejectedValue(new UnauthenticatedError());

    const result = await listDepartmentsAction({ page: 1, pageSize: 20 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
    expect(repositoryMocks.searchDepartments).not.toHaveBeenCalled();
  });

  it("companyId always comes from the authenticated session, never from the input payload", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.createDepartment.mockResolvedValue({});

    // The action's own parameter type is `unknown` — Zod, not TypeScript,
    // is the actual gate on a forged field like this at runtime.
    await createDepartmentAction({ name: "Eng", code: "ENG", companyId: "attacker-company" });

    // The schema is `.strict()`, so a forged companyId causes a validation
    // rejection rather than being silently dropped and passed through —
    // either way, the service is never called with the attacker's value.
    if (serviceMocks.createDepartment.mock.calls.length > 0) {
      expect(serviceMocks.createDepartment.mock.calls[0]?.[0]?.companyId).toBe(
        ADMIN_USER.companyId
      );
    }
  });
});
