import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, serviceMocks, companyRepoMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMocks: {
    getAuthDisplaySettings: vi.fn(),
    getOrCreateSettings: vi.fn(),
    updateCompanyProfile: vi.fn(),
    updateSettings: vi.fn(),
  },
  companyRepoMock: { findCompanyById: vi.fn() },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/settings.service", () => serviceMocks);
vi.mock("@/lib/repositories/company.repository", () => companyRepoMock);

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import { getSettingsAction, updateCompanyProfileAction, updateSettingsAction } from "./actions";

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
