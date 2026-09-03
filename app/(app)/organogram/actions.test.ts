import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, getOrganogramDataMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  getOrganogramDataMock: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock("@/lib/services/organogram.service", () => ({
  getOrganogramData: getOrganogramDataMock,
}));

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import { getOrganogramAction } from "./actions";

const ADMIN_USER = { id: "u_1", role: "ADMIN", companyId: "company-trusted", status: "ACTIVE" };

describe("getOrganogramAction — server-side authorization", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires organogram:view", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    getOrganogramDataMock.mockResolvedValue({});

    await getOrganogramAction();

    expect(requirePermissionMock).toHaveBeenCalledWith("organogram:view");
  });

  it("a role-permission rejection blocks the service layer entirely", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const result = await getOrganogramAction();

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
      authRedirect: "/access-denied",
    });
    expect(getOrganogramDataMock).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is blocked before the service layer ever runs", async () => {
    requirePermissionMock.mockRejectedValue(new UnauthenticatedError());

    const result = await getOrganogramAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
    expect(getOrganogramDataMock).not.toHaveBeenCalled();
  });

  it("companyId always comes from the authenticated session, never from any input (the action takes none)", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    getOrganogramDataMock.mockResolvedValue({});

    await getOrganogramAction();

    expect(getOrganogramDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: ADMIN_USER.companyId })
    );
  });

  it("an unexpected service failure never leaks a raw error — returns the generic safe fallback message", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    getOrganogramDataMock.mockRejectedValue(
      new Error("connection to server at ... failed: password=hunter2")
    );

    const result = await getOrganogramAction();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("hunter2");
      expect(result.error).not.toContain("connection to server");
      expect(result.error).toMatch(/something went wrong/i);
    }
  });
});
