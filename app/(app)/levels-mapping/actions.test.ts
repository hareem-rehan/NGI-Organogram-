import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, serviceMock, familyServiceMock, repoMock, familyRepoMock } =
  vi.hoisted(() => ({
    requirePermissionMock: vi.fn(),
    serviceMock: {
      createDepartmentLevelTitle: vi.fn(),
      updateDepartmentLevelTitle: vi.fn(),
      deleteDepartmentLevelTitle: vi.fn(),
    },
    familyServiceMock: {
      createJobFamilyLevelTitle: vi.fn(),
      updateJobFamilyLevelTitle: vi.fn(),
      deleteJobFamilyLevelTitle: vi.fn(),
      setLevelsMappingColumnVisibility: vi.fn(),
    },
    repoMock: { listDepartmentLevelTitlesForCompany: vi.fn() },
    familyRepoMock: { listJobFamilyLevelTitlesForCompany: vi.fn() },
  }));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/department-level-title.service", () => serviceMock);
vi.mock("@/lib/repositories/department-level-title.repository", () => repoMock);
vi.mock("@/lib/services/job-family-level-title.service", () => familyServiceMock);
vi.mock("@/lib/repositories/job-family-level-title.repository", () => familyRepoMock);
vi.mock("@/lib/server/audit-actor", () => ({ toAuditActor: () => ({ userId: "u_1" }) }));

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import {
  createDepartmentLevelTitleAction,
  createJobFamilyLevelTitleAction,
  deleteDepartmentLevelTitleAction,
  deleteJobFamilyLevelTitleAction,
  getLevelsMappingAction,
  setLevelsMappingColumnAction,
  updateDepartmentLevelTitleAction,
  updateJobFamilyLevelTitleAction,
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
  it("getLevelsMappingAction requires career:view and returns both title lists", async () => {
    requirePermissionMock.mockResolvedValue(USER);
    repoMock.listDepartmentLevelTitlesForCompany.mockResolvedValue([{ id: "d" }]);
    familyRepoMock.listJobFamilyLevelTitlesForCompany.mockResolvedValue([{ id: "f" }]);
    const result = await getLevelsMappingAction();
    expect(requirePermissionMock).toHaveBeenCalledWith("career:view");
    expect(result).toEqual({
      ok: true,
      data: { departmentTitles: [{ id: "d" }], subDivisionTitles: [{ id: "f" }] },
    });
    expect(familyRepoMock.listJobFamilyLevelTitlesForCompany).toHaveBeenCalledWith(
      "company-trusted"
    );
  });

  const allServices = { ...serviceMock, ...familyServiceMock };
  const writes: [string, () => Promise<unknown>, keyof typeof allServices][] = [
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
    [
      "createJobFamilyLevelTitleAction",
      () =>
        createJobFamilyLevelTitleAction({
          jobFamilyId: DEPT_ID,
          jobGradeCode: "L3",
          kind: "IC",
          title: "QA Engineer",
        }),
      "createJobFamilyLevelTitle",
    ],
    [
      "updateJobFamilyLevelTitleAction",
      () => updateJobFamilyLevelTitleAction({ id: ROW_ID, title: "New" }),
      "updateJobFamilyLevelTitle",
    ],
    [
      "deleteJobFamilyLevelTitleAction",
      () => deleteJobFamilyLevelTitleAction({ id: ROW_ID }),
      "deleteJobFamilyLevelTitle",
    ],
    [
      "setLevelsMappingColumnAction",
      () => setLevelsMappingColumnAction({ target: "DEPARTMENT", id: DEPT_ID, visible: true }),
      "setLevelsMappingColumnVisibility",
    ],
  ];

  for (const [name, invoke, serviceKey] of writes) {
    it(`${name} requires career:manage and never reaches the service on a forbidden caller`, async () => {
      requirePermissionMock.mockRejectedValue(new ForbiddenError());
      const result = (await invoke()) as { ok: boolean };
      expect(result.ok).toBe(false);
      expect(allServices[serviceKey]).not.toHaveBeenCalled();
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

  it("column visibility injects companyId from the session", async () => {
    requirePermissionMock.mockResolvedValue(USER);
    familyServiceMock.setLevelsMappingColumnVisibility.mockResolvedValue({ id: DEPT_ID });
    await setLevelsMappingColumnAction({ target: "SUB_DIVISION", id: DEPT_ID, visible: false });
    expect(requirePermissionMock).toHaveBeenCalledWith("career:manage");
    expect(familyServiceMock.setLevelsMappingColumnVisibility).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-trusted",
        target: "SUB_DIVISION",
        id: DEPT_ID,
        visible: false,
      })
    );
  });

  it.each([
    ["an unknown target", { target: "COMPANY", id: DEPT_ID, visible: true }],
    ["a malformed id", { target: "DEPARTMENT", id: "not-a-uuid", visible: true }],
    ["a non-boolean flag", { target: "DEPARTMENT", id: DEPT_ID, visible: "yes" }],
    [
      "a client-supplied companyId",
      { target: "DEPARTMENT", id: DEPT_ID, visible: true, companyId: "x" },
    ],
  ])("column visibility rejects %s before the service runs", async (_label, input) => {
    requirePermissionMock.mockResolvedValue(USER);
    const result = await setLevelsMappingColumnAction(input);
    expect(result.ok).toBe(false);
    expect(familyServiceMock.setLevelsMappingColumnVisibility).not.toHaveBeenCalled();
  });

  it("sub-division title create rejects a client-supplied companyId", async () => {
    requirePermissionMock.mockResolvedValue(USER);
    const result = await createJobFamilyLevelTitleAction({
      jobFamilyId: DEPT_ID,
      jobGradeCode: "L3",
      kind: "IC",
      title: "X",
      companyId: "attacker-company",
    });
    expect(result.ok).toBe(false);
    expect(familyServiceMock.createJobFamilyLevelTitle).not.toHaveBeenCalled();
  });
});
