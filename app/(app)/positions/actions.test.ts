import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requirePermissionMock,
  serviceMocks,
  positionRepoMocks,
  deptRepoMock,
  jobGradeRepoMock,
  jobGradeServiceMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMocks: {
    createPosition: vi.fn(),
    updatePosition: vi.fn(),
    movePosition: vi.fn(),
    archivePosition: vi.fn(),
    activatePosition: vi.fn(),
    deletePosition: vi.fn(),
  },
  positionRepoMocks: {
    searchPositions: vi.fn(),
    listAllPositionsForCompany: vi.fn(),
    listOccupiedPositionIds: vi.fn(),
    getPositionSubtree: vi.fn(),
  },
  deptRepoMock: { listDepartmentsForCompany: vi.fn() },
  jobGradeRepoMock: { listJobGradesForCompany: vi.fn() },
  jobGradeServiceMock: { ensureJobGradeByCode: vi.fn() },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/hierarchy.service", () => serviceMocks);
vi.mock("@/lib/repositories/position.repository", () => positionRepoMocks);
vi.mock("@/lib/repositories/department.repository", () => deptRepoMock);
vi.mock("@/lib/repositories/job-grade.repository", () => jobGradeRepoMock);
vi.mock("@/lib/services/job-grade.service", () => jobGradeServiceMock);

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import {
  activatePositionAction,
  archivePositionAction,
  createPositionAction,
  deletePositionAction,
  getSubtreeSizeAction,
  listAllPositionsAction,
  listDepartmentOptionsAction,
  listJobGradeOptionsAction,
  listPositionsAction,
  movePositionAction,
  updatePositionAction,
} from "./actions";

const ADMIN_USER = { id: "u_1", role: "ADMIN", companyId: "company-trusted", status: "ACTIVE" };
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("position actions — server-side authorization", () => {
  afterEach(() => vi.clearAllMocks());

  it.each([
    ["listPositionsAction", () => listPositionsAction({ page: 1, pageSize: 20 })],
    ["listAllPositionsAction", () => listAllPositionsAction()],
    ["listDepartmentOptionsAction", () => listDepartmentOptionsAction()],
    ["listJobGradeOptionsAction", () => listJobGradeOptionsAction()],
    ["getSubtreeSizeAction", () => getSubtreeSizeAction(VALID_UUID)],
  ])("%s requires positions:view", async (_name, invoke) => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    positionRepoMocks.searchPositions.mockResolvedValue({ items: [], totalCount: 0 });
    positionRepoMocks.listAllPositionsForCompany.mockResolvedValue([]);
    positionRepoMocks.listOccupiedPositionIds.mockResolvedValue(new Set());
    positionRepoMocks.getPositionSubtree.mockResolvedValue([]);
    deptRepoMock.listDepartmentsForCompany.mockResolvedValue([]);
    jobGradeRepoMock.listJobGradesForCompany.mockResolvedValue([]);

    await invoke();

    expect(requirePermissionMock).toHaveBeenCalledWith("positions:view");
  });

  it.each([
    [
      "createPositionAction",
      () =>
        createPositionAction({ title: "Eng", positionCode: "POS-ENG", departmentId: VALID_UUID }),
    ],
    ["updatePositionAction", () => updatePositionAction({ positionId: VALID_UUID, title: "New" })],
    [
      "movePositionAction",
      () => movePositionAction({ positionId: VALID_UUID, newParentPositionId: null }),
    ],
    ["archivePositionAction", () => archivePositionAction({ positionId: VALID_UUID })],
    ["activatePositionAction", () => activatePositionAction({ positionId: VALID_UUID })],
  ])("%s requires positions:manage", async (_name, invoke) => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.createPosition.mockResolvedValue({});
    serviceMocks.updatePosition.mockResolvedValue({});
    serviceMocks.movePosition.mockResolvedValue({});
    serviceMocks.archivePosition.mockResolvedValue({});
    serviceMocks.activatePosition.mockResolvedValue({});

    await invoke();

    expect(requirePermissionMock).toHaveBeenCalledWith("positions:manage");
  });

  it("a VIEWER-role rejection blocks the mutation before the service layer ever runs", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const result = await createPositionAction({
      title: "Eng",
      positionCode: "POS-ENG",
      departmentId: VALID_UUID,
    });

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
      authRedirect: "/access-denied",
    });
    expect(serviceMocks.createPosition).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is blocked before the repository layer ever runs", async () => {
    requirePermissionMock.mockRejectedValue(new UnauthenticatedError());

    const result = await listPositionsAction({ page: 1, pageSize: 20 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
    expect(positionRepoMocks.searchPositions).not.toHaveBeenCalled();
  });

  it("companyId always comes from the authenticated session, never from the input payload", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.createPosition.mockResolvedValue({});

    await createPositionAction({
      title: "Eng",
      positionCode: "POS-ENG",
      departmentId: VALID_UUID,
      companyId: "attacker-company",
    });

    if (serviceMocks.createPosition.mock.calls.length > 0) {
      expect(serviceMocks.createPosition.mock.calls[0]?.[0]?.companyId).toBe(ADMIN_USER.companyId);
    }
  });

  it("listPositionsAction computes occupancy against the returned page's items only", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const items = [{ id: "pos-1" }, { id: "pos-2" }];
    positionRepoMocks.searchPositions.mockResolvedValue({ items, totalCount: 2 });
    positionRepoMocks.listOccupiedPositionIds.mockResolvedValue(new Set(["pos-1"]));

    const result = await listPositionsAction({ page: 1, pageSize: 20 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.occupiedPositionIds).toEqual(["pos-1"]);
    }
    expect(positionRepoMocks.listOccupiedPositionIds).toHaveBeenCalledWith(
      ["pos-1", "pos-2"],
      ADMIN_USER.companyId,
      expect.any(Date)
    );
  });
});

describe("createPositionAction — level (jobGradeCode) resolution", () => {
  afterEach(() => vi.clearAllMocks());

  it("resolves a chosen level code to a grade id, creating the grade on first use", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    jobGradeServiceMock.ensureJobGradeByCode.mockResolvedValue({ id: "grade-l7" });
    serviceMocks.createPosition.mockResolvedValue({});

    await createPositionAction({
      title: "Principal Engineer",
      positionCode: "POS-PE",
      departmentId: VALID_UUID,
      jobGradeCode: "L7",
    });

    // The form's level code is resolved with the SESSION's company, never
    // anything from the payload.
    expect(jobGradeServiceMock.ensureJobGradeByCode).toHaveBeenCalledWith(
      ADMIN_USER.companyId,
      "L7"
    );
    // The service is handed the resolved id, not the code.
    expect(serviceMocks.createPosition.mock.calls[0]?.[0]?.jobGradeId).toBe("grade-l7");
  });

  it("auto-generates a position code when the form sends none", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.createPosition.mockResolvedValue({});

    await createPositionAction({
      title: "Coordinator",
      departmentId: VALID_UUID,
    });

    const passed = serviceMocks.createPosition.mock.calls[0]?.[0]?.positionCode;
    expect(passed).toMatch(/^POS-[0-9A-F]+$/);
  });

  it("passes no grade when no level is chosen, without touching the resolver", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.createPosition.mockResolvedValue({});

    await createPositionAction({
      title: "Coordinator",
      positionCode: "POS-CO",
      departmentId: VALID_UUID,
      jobGradeCode: null,
    });

    expect(jobGradeServiceMock.ensureJobGradeByCode).not.toHaveBeenCalled();
    expect(serviceMocks.createPosition.mock.calls[0]?.[0]?.jobGradeId).toBeNull();
  });
});

describe("deletePositionAction — authorization and validation", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires positions:manage and passes the session company, never the payload's", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.deletePosition.mockResolvedValue(undefined);

    await deletePositionAction({ positionId: VALID_UUID, companyId: "attacker-co" });

    expect(requirePermissionMock).toHaveBeenCalledWith("positions:manage");
    if (serviceMocks.deletePosition.mock.calls.length > 0) {
      expect(serviceMocks.deletePosition.mock.calls[0]?.[1]).toBe(ADMIN_USER.companyId);
    }
  });

  it("a VIEWER cannot delete — the service is never reached", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const result = await deletePositionAction({ positionId: VALID_UUID });

    expect(result.ok).toBe(false);
    expect(serviceMocks.deletePosition).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before calling the service", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);

    const result = await deletePositionAction({ positionId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    expect(serviceMocks.deletePosition).not.toHaveBeenCalled();
  });
});
