import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, hasPermissionMock, getDashboardSummaryMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  getDashboardSummaryMock: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requirePermission: requirePermissionMock,
  hasPermission: hasPermissionMock,
}));
vi.mock("@/lib/services/dashboard.service", () => ({
  getDashboardSummary: getDashboardSummaryMock,
}));

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import { getDashboardAction } from "./actions";

const ADMIN_USER = { id: "u_1", role: "ADMIN", companyId: "company-trusted", status: "ACTIVE" };
const VIEWER_USER = { id: "u_2", role: "VIEWER", companyId: "company-trusted", status: "ACTIVE" };

describe("getDashboardAction — server-side authorization", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires dashboard:view", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    hasPermissionMock.mockReturnValue(true);
    getDashboardSummaryMock.mockResolvedValue({});

    await getDashboardAction();

    expect(requirePermissionMock).toHaveBeenCalledWith("dashboard:view");
  });

  it("a VIEWER-role rejection blocks the service layer entirely (unauthenticated/wrong-role case)", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const result = await getDashboardAction();

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
      authRedirect: "/access-denied",
    });
    expect(getDashboardSummaryMock).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is blocked before the service layer ever runs", async () => {
    requirePermissionMock.mockRejectedValue(new UnauthenticatedError());

    const result = await getDashboardAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
    expect(getDashboardSummaryMock).not.toHaveBeenCalled();
  });

  it("companyId always comes from the authenticated session, never from any input (the action takes none)", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    hasPermissionMock.mockReturnValue(true);
    getDashboardSummaryMock.mockResolvedValue({});

    await getDashboardAction();

    expect(getDashboardSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: ADMIN_USER.companyId })
    );
  });

  it("passes canSeeManagementDetails=true only when the caller holds employees:manage", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    hasPermissionMock.mockReturnValue(true);
    getDashboardSummaryMock.mockResolvedValue({});

    await getDashboardAction();

    expect(hasPermissionMock).toHaveBeenCalledWith(ADMIN_USER, "employees:manage");
    expect(getDashboardSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ canSeeManagementDetails: true })
    );
  });

  it("passes canSeeManagementDetails=false for a VIEWER", async () => {
    requirePermissionMock.mockResolvedValue(VIEWER_USER);
    hasPermissionMock.mockReturnValue(false);
    getDashboardSummaryMock.mockResolvedValue({});

    await getDashboardAction();

    expect(getDashboardSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ canSeeManagementDetails: false })
    );
  });

  it("an unexpected service failure (e.g. the database is unavailable) never leaks a raw error — returns the generic safe fallback message", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    hasPermissionMock.mockReturnValue(true);
    getDashboardSummaryMock.mockRejectedValue(
      new Error("connection to server at ... failed: password=hunter2")
    );

    const result = await getDashboardAction();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("hunter2");
      expect(result.error).not.toContain("connection to server");
      expect(result.error).toMatch(/something went wrong/i);
    }
  });
});
