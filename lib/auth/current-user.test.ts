import { afterEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock("@/lib/auth/config", () => ({
  auth: authMock,
}));

import {
  getAuthorizedCompanyContext,
  getCurrentUser,
  hasPermission,
  requireActiveUser,
  requireAuthenticatedUser,
  requirePermission,
} from "./current-user";
import { ForbiddenError, InactiveUserError, UnauthenticatedError } from "./errors";

function mockSession(
  overrides: Partial<{
    id: string;
    role: string;
    status: string;
    companyId: string;
    email: string;
    name: string;
  }> = {}
) {
  authMock.mockResolvedValue({
    user: {
      id: "u_1",
      role: "VIEWER",
      status: "ACTIVE",
      companyId: "c_1",
      email: "jane@example.test",
      name: "Jane Doe",
      ...overrides,
    },
  });
}

describe("getCurrentUser", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there is no session", async () => {
    authMock.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it("maps a real session to a CurrentUser", async () => {
    mockSession();
    const user = await getCurrentUser();
    expect(user).toEqual({
      id: "u_1",
      role: "VIEWER",
      status: "ACTIVE",
      companyId: "c_1",
      email: "jane@example.test",
      name: "Jane Doe",
    });
  });
});

describe("requireAuthenticatedUser", () => {
  afterEach(() => vi.clearAllMocks());

  it("throws UnauthenticatedError when there is no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireAuthenticatedUser()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("returns the user when authenticated", async () => {
    mockSession();
    await expect(requireAuthenticatedUser()).resolves.toMatchObject({ id: "u_1" });
  });
});

describe("requireActiveUser", () => {
  afterEach(() => vi.clearAllMocks());

  it("throws InactiveUserError for a disabled user", async () => {
    mockSession({ status: "DISABLED" });
    await expect(requireActiveUser()).rejects.toBeInstanceOf(InactiveUserError);
  });

  it("returns the user when active", async () => {
    mockSession({ status: "ACTIVE" });
    await expect(requireActiveUser()).resolves.toMatchObject({ status: "ACTIVE" });
  });
});

describe("hasPermission", () => {
  it("checks the granted permission set for the role", () => {
    expect(hasPermission({ role: "ADMIN" as never }, "users:manage")).toBe(true);
    expect(hasPermission({ role: "VIEWER" as never }, "users:manage")).toBe(false);
  });
});

describe("requirePermission", () => {
  afterEach(() => vi.clearAllMocks());

  it("throws ForbiddenError when the active user lacks the permission", async () => {
    mockSession({ role: "VIEWER" });
    await expect(requirePermission("departments:manage")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns the user when the permission is granted", async () => {
    mockSession({ role: "HR_EDITOR" });
    await expect(requirePermission("departments:manage")).resolves.toMatchObject({
      role: "HR_EDITOR",
    });
  });

  it("still throws UnauthenticatedError before ever checking permission, when there is no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requirePermission("dashboard:view")).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("getAuthorizedCompanyContext", () => {
  afterEach(() => vi.clearAllMocks());

  it("derives companyId/userId/role from the session only — never from caller input", async () => {
    mockSession({ companyId: "trusted-company", id: "u_9", role: "ADMIN" });
    const context = await getAuthorizedCompanyContext();
    expect(context).toEqual({ companyId: "trusted-company", userId: "u_9", role: "ADMIN" });
  });
});
