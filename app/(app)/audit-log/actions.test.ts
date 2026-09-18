import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, serviceMocks } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMocks: {
    queryAuditEvents: vi.fn(),
    getAuditEvent: vi.fn(),
  },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/audit.service", () => serviceMocks);

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import { getAuditEventAction, listAuditEventsAction } from "./actions";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_USER = { id: "u_1", role: "ADMIN", companyId: "company-trusted", status: "ACTIVE" };

afterEach(() => vi.clearAllMocks());

describe("audit-log server actions — authorization", () => {
  it("listAuditEventsAction requires audit:view and never reaches the service for a VIEWER-role rejection", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());
    const result = await listAuditEventsAction({});
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
      authRedirect: "/access-denied",
    });
    expect(serviceMocks.queryAuditEvents).not.toHaveBeenCalled();
  });

  it("getAuditEventAction blocks an unauthenticated caller", async () => {
    requirePermissionMock.mockRejectedValue(new UnauthenticatedError());
    const result = await getAuditEventAction({ eventId: EVENT_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
    expect(serviceMocks.getAuditEvent).not.toHaveBeenCalled();
  });

  it("listAuditEventsAction derives companyId/role only from the session, passing them to the query service", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.queryAuditEvents.mockResolvedValue({
      events: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });

    await listAuditEventsAction({ category: "DEPARTMENT" });

    expect(requirePermissionMock).toHaveBeenCalledWith("audit:view");
    expect(serviceMocks.queryAuditEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-trusted",
        role: "ADMIN",
        category: "DEPARTMENT",
      })
    );
  });

  it("rejects an unknown filter field before the service layer ever runs", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const result = await listAuditEventsAction({ notAField: true });
    expect(result.ok).toBe(false);
    expect(serviceMocks.queryAuditEvents).not.toHaveBeenCalled();
  });

  it("getAuditEventAction re-checks company scope/role via the service on every call", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.getAuditEvent.mockResolvedValue({ id: EVENT_ID });
    await getAuditEventAction({ eventId: EVENT_ID });
    expect(serviceMocks.getAuditEvent).toHaveBeenCalledWith(EVENT_ID, "company-trusted", "ADMIN");
  });
});
