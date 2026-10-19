import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, serviceMocks } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMocks: {
    createShareLink: vi.fn(),
    listShareLinks: vi.fn(),
    revokeShareLink: vi.fn(),
  },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/share-link.service", () => serviceMocks);

import { ForbiddenError } from "@/lib/auth/errors";
import {
  createShareLinkAction,
  listShareLinksAction,
  revokeShareLinkAction,
} from "./share-actions";

const HR_USER = { id: "u_1", role: "HR_EDITOR", companyId: "company-trusted", status: "ACTIVE" };
const LINK_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => vi.clearAllMocks());

describe("share-link management actions (D60)", () => {
  it("every action requires organogram:share and uses the caller's company", async () => {
    requirePermissionMock.mockResolvedValue(HR_USER);
    serviceMocks.listShareLinks.mockResolvedValue([]);
    serviceMocks.createShareLink.mockResolvedValue({ id: LINK_ID });
    serviceMocks.revokeShareLink.mockResolvedValue({ id: LINK_ID });

    await listShareLinksAction();
    await createShareLinkAction({ label: " Board ", expiresInDays: 7 });
    await revokeShareLinkAction({ shareLinkId: LINK_ID });

    expect(requirePermissionMock).toHaveBeenCalledTimes(3);
    for (const call of requirePermissionMock.mock.calls) expect(call[0]).toBe("organogram:share");
    expect(serviceMocks.listShareLinks).toHaveBeenCalledWith("company-trusted");
    expect(serviceMocks.createShareLink).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-trusted",
        createdByUserId: "u_1",
        label: "Board",
        expiresInDays: 7,
      })
    );
    expect(serviceMocks.revokeShareLink).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "company-trusted", shareLinkId: LINK_ID })
    );
  });

  it("a VIEWER (no organogram:share) can't list, create or turn off links", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const results = await Promise.all([
      listShareLinksAction(),
      createShareLinkAction({ expiresInDays: 7 }),
      revokeShareLinkAction({ shareLinkId: LINK_ID }),
    ]);

    expect(results.every((r) => !r.ok)).toBe(true);
    expect(serviceMocks.listShareLinks).not.toHaveBeenCalled();
    expect(serviceMocks.createShareLink).not.toHaveBeenCalled();
    expect(serviceMocks.revokeShareLink).not.toHaveBeenCalled();
  });

  it("only 7 days, 30 days or 'until turned off' are accepted", async () => {
    requirePermissionMock.mockResolvedValue(HR_USER);
    for (const expiresInDays of [1, 365, "7", undefined]) {
      expect((await createShareLinkAction({ expiresInDays })).ok).toBe(false);
    }
    expect((await createShareLinkAction({ expiresInDays: null, extra: 1 })).ok).toBe(false);
    expect(serviceMocks.createShareLink).not.toHaveBeenCalled();
  });
});
