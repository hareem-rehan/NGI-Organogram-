import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, serviceMock, repoMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMock: {
    createDepartmentLevelTitle: vi.fn(),
    updateDepartmentLevelTitle: vi.fn(),
    deleteDepartmentLevelTitle: vi.fn(),
  },
  repoMock: { listDepartmentLevelTitlesForCompany: vi.fn() },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/department-level-title.service", () => serviceMock);
vi.mock("@/lib/repositories/department-level-title.repository", () => repoMock);
vi.mock("@/lib/server/audit-actor", () => ({ toAuditActor: () => ({ userId: "u_1" }) }));

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import {
  createDepartmentLevelTitleAction,
  deleteDepartmentLevelTitleAction,
  getLevelsMappingAction,
  updateDepartmentLevelTitleAction,
} from "./actions";

const USER = {
  id: "u_1",
  name: "HR Editor",
  email: "hr@northwind-example.test",
  role: "HR_EDITOR",
  companyId: "company-trusted",
  status: "ACTIVE",
};

const DEPT_ID = "11111111-1111-4111-8111-111111111111";
const ROW_ID = "22222222-2222-4222-8222-222222222222";

afterEach(() => vi.clearAllMocks());

describe("levels-mapping server actions — authorization", () => {
  it("getLevelsMappingAction requires career:view", async () => {
    requirePermissionMock.mockResolvedValue(USER);
    repoMock.listDepartmentLevelTitlesForCompany.mockResolvedValue([]);
    await getLevelsMappingAction();
    expect(requirePermissionMock).toHaveBeenCalledWith("career:view");
  });

  const writes: [string, () => Promise<unknown>, keyof typeof serviceMock][] = [
    [
      "createDepartmentLevelTitleAction",
      () =>
        createDepartmentLevelTitleAction({
          departmentId: DEPT_ID,
          jobGradeCode: "L7",
          kind: "IC",
          title: "Principal Software Engineer",
        }),
      "createDepartmentLevelTitle",
    ],
    [
      "updateDepartmentLevelTitleAction",
      () => updateDepartmentLevelTitleAction({ id: ROW_ID, title: "New" }),
      "updateDepartmentLevelTitle",
    ],
    [
      "deleteDepartmentLevelTitleAction",
      () => deleteDepartmentLevelTitleAction({ id: ROW_ID }),
      "deleteDepartmentLevelTitle",
    ],
  ];

  for (const [name, invoke, serviceKey] of writes) {
    it(`${name} requires career:manage and never reaches the service on a forbidden caller`, async () => {
      requirePermissionMock.mockRejectedValue(new ForbiddenError());
      const result = (await invoke()) as { ok: boolean };
      expect(result.ok).toBe(false);
      expect(serviceMock[serviceKey]).not.toHaveBeenCalled();
    });

    it(`${name} blocks an unauthenticated caller`, async () => {
      requirePermissionMock.mockRejectedValue(new UnauthenticatedError());
      const result = (await invoke()) as { ok: boolean; authRedirect?: string };
      expect(result.ok).toBe(false);
      expect(result.authRedirect).toBe("/sign-in");
    });
  }

  it("create checks career:manage specifically and injects companyId from the session", async () => {
    requirePermissionMock.mockResolvedValue(USER);
    serviceMock.createDepartmentLevelTitle.mockResolvedValue({ id: ROW_ID });
    await createDepartmentLevelTitleAction({
      departmentId: DEPT_ID,
      jobGradeCode: "L7",
      kind: "IC",
      title: "Principal Software Engineer",
    });
    expect(requirePermissionMock).toHaveBeenCalledWith("career:manage");
    expect(serviceMock.createDepartmentLevelTitle).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "company-trusted", departmentId: DEPT_ID })
    );
  });

  it("never accepts a client-supplied companyId — the strict schema rejects the unknown field", async () => {
    requirePermissionMock.mockResolvedValue(USER);
    const result = await createDepartmentLevelTitleAction({
      departmentId: DEPT_ID,
      jobGradeCode: "L7",
      kind: "IC",
      title: "X",
      companyId: "attacker-company",
    });
    expect(result.ok).toBe(false);
    expect(serviceMock.createDepartmentLevelTitle).not.toHaveBeenCalled();
  });

  it("rejects an unknown level code before the service runs", async () => {
    requirePermissionMock.mockResolvedValue(USER);
    const result = await createDepartmentLevelTitleAction({
      departmentId: DEPT_ID,
      jobGradeCode: "L99",
      kind: "IC",
      title: "X",
    });
    expect(result.ok).toBe(false);
    expect(serviceMock.createDepartmentLevelTitle).not.toHaveBeenCalled();
  });
});
