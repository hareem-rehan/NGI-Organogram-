import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, redirectMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { requirePagePermission } from "./require-page-permission";
import { ForbiddenError, InactiveUserError, UnauthenticatedError } from "./errors";

describe("requirePagePermission", () => {
  afterEach(() => vi.clearAllMocks());

  it("does nothing when the permission check succeeds", async () => {
    requirePermissionMock.mockResolvedValue({ id: "u_1" });
    await expect(requirePagePermission("dashboard:view")).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /sign-in when unauthenticated", async () => {
    requirePermissionMock.mockRejectedValue(new UnauthenticatedError());
    await expect(requirePagePermission("dashboard:view")).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(redirectMock).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects to /sign-in when the user is inactive/disabled", async () => {
    requirePermissionMock.mockRejectedValue(new InactiveUserError());
    await expect(requirePagePermission("dashboard:view")).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("redirects to /access-denied when authenticated but lacking the permission", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());
    await expect(requirePagePermission("departments:manage")).rejects.toThrow(
      "NEXT_REDIRECT:/access-denied"
    );
    expect(redirectMock).toHaveBeenCalledWith("/access-denied");
  });

  it("rethrows an unexpected error rather than swallowing it", async () => {
    requirePermissionMock.mockRejectedValue(new Error("database exploded"));
    await expect(requirePagePermission("dashboard:view")).rejects.toThrow("database exploded");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
