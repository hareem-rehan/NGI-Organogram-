import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requirePermissionMock,
  serviceMocks,
  companyRepoMock,
  jobGradeServiceMock,
  jobGradeRepoMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMocks: {
    getAuthDisplaySettings: vi.fn(),
    getOrCreateSettings: vi.fn(),
    updateCompanyProfile: vi.fn(),
    updateSettings: vi.fn(),
  },
  companyRepoMock: { findCompanyById: vi.fn() },
  jobGradeServiceMock: {
    deleteLevelByCode: vi.fn(),
    provisionStandardLevel: vi.fn(),
    provisionStandardLevels: vi.fn(),
    removeUnusedLevels: vi.fn(),
  },
  jobGradeRepoMock: {
    getJobGradeUsageCounts: vi.fn(),
    listJobGradesForCompany: vi.fn(),
  },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/settings.service", () => serviceMocks);
vi.mock("@/lib/repositories/company.repository", () => companyRepoMock);
// Level management now lives in Settings; stub the server-only job-grade
// modules so this client-side test never loads them.
vi.mock("@/lib/services/job-grade.service", () => jobGradeServiceMock);
vi.mock("@/lib/repositories/job-grade.repository", () => jobGradeRepoMock);

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import {
  addLevelAction,
  deleteLevelAction,
  getCompanyLevelsAction,
  getSettingsAction,
  provisionStandardLevelsAction,
  removeUnusedLevelsAction,
  updateCompanyProfileAction,
  updateSettingsAction,
} from "./actions";

const VALID_LEVEL = "L7";

const ADMIN_USER = {
  id: "u_1",
  name: "Admin User",
  email: "admin@northwind-example.test",
  role: "ADMIN",
  companyId: "company-trusted",
  status: "ACTIVE",
};

afterEach(() => vi.clearAllMocks());

describe("settings server actions — authorization", () => {
  const invocations: [string, () => Promise<unknown>, keyof typeof serviceMocks][] = [
    ["getSettingsAction", () => getSettingsAction(), "getOrCreateSettings"],
    [
      "updateCompanyProfileAction",
      () => updateCompanyProfileAction({ name: "New Name" }),
      "updateCompanyProfile",
    ],
    [
      "updateSettingsAction",
      () => updateSettingsAction({ defaultExpansionDepth: 3 }),
      "updateSettings",
    ],
  ];

  for (const [name, invoke, serviceKey] of invocations) {
    it(`${name} requires settings:manage and never reaches the service layer for an HR_EDITOR-role rejection`, async () => {
      requirePermissionMock.mockRejectedValue(new ForbiddenError());
      const result = await invoke();
      expect(result).toEqual({
        ok: false,
        error: "You don't have permission to do that.",
        authRedirect: "/access-denied",
      });
      expect(serviceMocks[serviceKey]).not.toHaveBeenCalled();
    });

    it(`${name} blocks an unauthenticated caller`, async () => {
      requirePermissionMock.mockRejectedValue(new UnauthenticatedError());
      const result = (await invoke()) as { ok: boolean; authRedirect?: string };
      expect(result.ok).toBe(false);
      expect(result.authRedirect).toBe("/sign-in");
    });
  }

  it("getSettingsAction checks settings:manage specifically", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    companyRepoMock.findCompanyById.mockResolvedValue({ id: "company-trusted" });
    serviceMocks.getOrCreateSettings.mockResolvedValue({ id: "s1" });
    serviceMocks.getAuthDisplaySettings.mockReturnValue({
      providerName: "Company Account",
      allowedDomains: ["northwind-example.test"],
      autoProvisionViewersEnabled: false,
    });

    await getSettingsAction();

    expect(requirePermissionMock).toHaveBeenCalledWith("settings:manage");
  });

  it("updateSettingsAction rejects a client-supplied secret-shaped field before the service layer ever runs", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const result = await updateSettingsAction({ clientSecret: "leak-me" });
    expect(result.ok).toBe(false);
    expect(serviceMocks.updateSettings).not.toHaveBeenCalled();
  });

  it("updateCompanyProfileAction never accepts a client-supplied companyId — the schema rejects the unknown field", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const result = await updateCompanyProfileAction({
      name: "New Name",
      companyId: "attacker-company",
    });
    expect(result.ok).toBe(false);
    expect(serviceMocks.updateCompanyProfile).not.toHaveBeenCalled();
  });
});

describe("settings level actions — authorization (settings:manage / ADMIN-only)", () => {
  const invocations: [string, () => Promise<unknown>][] = [
    ["getCompanyLevelsAction", () => getCompanyLevelsAction()],
    ["provisionStandardLevelsAction", () => provisionStandardLevelsAction()],
    ["addLevelAction", () => addLevelAction({ code: VALID_LEVEL })],
    ["deleteLevelAction", () => deleteLevelAction({ code: VALID_LEVEL })],
    ["removeUnusedLevelsAction", () => removeUnusedLevelsAction()],
  ];

  for (const [name, invoke] of invocations) {
    it(`${name} is refused for a caller lacking settings:manage`, async () => {
      requirePermissionMock.mockRejectedValue(new ForbiddenError());
      const result = (await invoke()) as { ok: boolean };
      expect(result.ok).toBe(false);
      expect(requirePermissionMock).toHaveBeenCalledWith("settings:manage");
      // No level mutation reached the service layer.
      expect(jobGradeServiceMock.provisionStandardLevel).not.toHaveBeenCalled();
      expect(jobGradeServiceMock.deleteLevelByCode).not.toHaveBeenCalled();
      expect(jobGradeServiceMock.removeUnusedLevels).not.toHaveBeenCalled();
    });
  }

  it("deleteLevelAction passes the session company and validated code to the service", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    jobGradeServiceMock.deleteLevelByCode.mockResolvedValue({ deletedCount: 1 });

    const result = await deleteLevelAction({ code: "L9" });

    expect(result.ok).toBe(true);
    expect(jobGradeServiceMock.deleteLevelByCode).toHaveBeenCalledWith(
      ADMIN_USER.companyId,
      "L9",
      expect.anything()
    );
  });

  it("addLevelAction rejects a malformed payload before the service runs", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const result = await addLevelAction({ notCode: "x" });
    expect(result.ok).toBe(false);
    expect(jobGradeServiceMock.provisionStandardLevel).not.toHaveBeenCalled();
  });
});
