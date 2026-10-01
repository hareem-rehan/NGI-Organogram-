import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, getOrganogramChartDataMock, layoutMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  getOrganogramChartDataMock: vi.fn(),
  layoutMock: {
    saveCardOffset: vi.fn(),
    clearCardOffsets: vi.fn(),
    resetCardOffsets: vi.fn(),
    saveTextStyle: vi.fn(),
  },
}));

vi.mock("@/lib/auth/current-user", () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock("@/lib/services/organogram.service", () => ({
  getOrganogramChartData: getOrganogramChartDataMock,
}));
vi.mock("@/lib/services/organogram-layout.service", () => layoutMock);
vi.mock("@/lib/server/audit-actor", () => ({ toAuditActor: () => ({ userId: "u_1" }) }));

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import {
  clearCardPositionsAction,
  clearTextStyleAction,
  getOrganogramAction,
  resetCardPositionsAction,
  saveCardPositionAction,
  saveTextStyleAction,
} from "./actions";

const ADMIN_USER = { id: "u_1", role: "ADMIN", companyId: "company-trusted", status: "ACTIVE" };

describe("getOrganogramAction — server-side authorization", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires organogram:view", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    getOrganogramChartDataMock.mockResolvedValue({});

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
    expect(getOrganogramChartDataMock).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is blocked before the service layer ever runs", async () => {
    requirePermissionMock.mockRejectedValue(new UnauthenticatedError());

    const result = await getOrganogramAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
    expect(getOrganogramChartDataMock).not.toHaveBeenCalled();
  });

  it("companyId always comes from the authenticated session, never from any input (the action takes none)", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    getOrganogramChartDataMock.mockResolvedValue({});

    await getOrganogramAction();

    expect(getOrganogramChartDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: ADMIN_USER.companyId })
    );
  });

  it("an unexpected service failure never leaks a raw error — returns the generic safe fallback message", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    getOrganogramChartDataMock.mockRejectedValue(
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

describe("card placement actions (D38)", () => {
  afterEach(() => vi.clearAllMocks());
  const POS = "11111111-1111-4111-8111-111111111111";

  it("saving a position needs positions:manage and takes companyId from the session", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const result = await saveCardPositionAction({ nodeKey: `dept:${POS}`, dx: 120, dy: -40 });
    expect(result).toEqual({ ok: true, data: null });
    expect(requirePermissionMock).toHaveBeenCalledWith("positions:manage");
    expect(layoutMock.saveCardOffset).toHaveBeenCalledWith({
      companyId: "company-trusted",
      nodeKey: `dept:${POS}`,
      dx: 120,
      dy: -40,
    });
  });

  it.each([
    ["a viewer", () => saveCardPositionAction({ nodeKey: POS, dx: 1, dy: 1 }), "saveCardOffset"],
    ["a viewer", () => clearCardPositionsAction({ nodeKeys: [POS] }), "clearCardOffsets"],
    ["a viewer", () => resetCardPositionsAction(), "resetCardOffsets"],
  ] as const)("%s cannot change card positions (%s)", async (_who, invoke, serviceKey) => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());
    const result = (await invoke()) as { ok: boolean };
    expect(result.ok).toBe(false);
    expect(layoutMock[serviceKey]).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown card key", { nodeKey: "ceo", dx: 1, dy: 1 }],
    ["a non-finite offset", { nodeKey: POS, dx: Number.POSITIVE_INFINITY, dy: 1 }],
    ["an absurd offset", { nodeKey: POS, dx: 9_999_999, dy: 1 }],
    ["a client-supplied companyId", { nodeKey: POS, dx: 1, dy: 1, companyId: "x" }],
  ])("rejects %s before the service runs", async (_label, input) => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const result = await saveCardPositionAction(input);
    expect(result.ok).toBe(false);
    expect(layoutMock.saveCardOffset).not.toHaveBeenCalled();
  });

  it("reset is passed the acting user for the audit trail", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    layoutMock.resetCardOffsets.mockResolvedValue(3);
    const result = await resetCardPositionsAction();
    expect(result).toEqual({ ok: true, data: { cleared: 3 } });
    expect(layoutMock.resetCardOffsets).toHaveBeenCalledWith({
      companyId: "company-trusted",
      actor: { userId: "u_1" },
    });
  });
});

describe("text style actions (D41)", () => {
  afterEach(() => vi.clearAllMocks());
  const POS = "11111111-1111-4111-8111-111111111111";

  it("saves the chart-wide style with the session's company and the acting user", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const result = await saveTextStyleAction({
      nodeKey: "chart",
      style: { fontFamily: "georgia", fontSize: 15, bold: true, color: "#1e3a8a" },
    });
    expect(result).toEqual({ ok: true, data: null });
    expect(requirePermissionMock).toHaveBeenCalledWith("positions:manage");
    expect(layoutMock.saveTextStyle).toHaveBeenCalledWith({
      companyId: "company-trusted",
      actor: { userId: "u_1" },
      nodeKey: "chart",
      style: { fontFamily: "georgia", fontSize: 15, bold: true, color: "#1e3a8a" },
    });
  });

  it("clearing a card's style saves an empty style for that card", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    await clearTextStyleAction({ nodeKey: `dept:${POS}` });
    expect(layoutMock.saveTextStyle).toHaveBeenCalledWith(
      expect.objectContaining({ nodeKey: `dept:${POS}`, style: {} })
    );
  });

  it("a viewer cannot change text styles", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());
    expect((await saveTextStyleAction({ nodeKey: "chart", style: {} })).ok).toBe(false);
    expect((await clearTextStyleAction({ nodeKey: "chart" })).ok).toBe(false);
    expect(layoutMock.saveTextStyle).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown font", { nodeKey: "chart", style: { fontFamily: "comic-sans" } }],
    ["a size above 20", { nodeKey: "chart", style: { fontSize: 72 } }],
    ["a size below 9", { nodeKey: "chart", style: { fontSize: 4 } }],
    ["a non-hex colour", { nodeKey: "chart", style: { color: "red; background:url(x)" } }],
    ["an unknown field", { nodeKey: "chart", style: { fontVariant: "small-caps" } }],
    ["a bad card key", { nodeKey: "ceo", style: {} }],
    ["a client-supplied companyId", { nodeKey: "chart", style: {}, companyId: "x" }],
  ])("rejects %s before the service runs", async (_label, input) => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    expect((await saveTextStyleAction(input)).ok).toBe(false);
    expect(layoutMock.saveTextStyle).not.toHaveBeenCalled();
  });
});
