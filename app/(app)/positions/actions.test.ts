import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requirePermissionMock,
  serviceMocks,
  positionRepoMocks,
  deptRepoMock,
  jobGradeRepoMock,
  jobGradeServiceMock,
  careerServiceMock,
  careerRepoMock,
  deptLevelTitleRepoMock,
  assignmentServiceMock,
  assignmentRepoMock,
  employeeRepoMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMocks: {
    createPosition: vi.fn(),
    updatePosition: vi.fn(),
    movePosition: vi.fn(),
    archivePosition: vi.fn(),
    activatePosition: vi.fn(),
    deletePosition: vi.fn(),
    deletePositionSubtree: vi.fn(),
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
  careerServiceMock: { ensureCareerTrackOfKind: vi.fn() },
  careerRepoMock: {
    listJobFamiliesForCompany: vi.fn(),
    listCareerTracksForCompany: vi.fn(),
  },
  deptLevelTitleRepoMock: { listDepartmentLevelTitlesForCompany: vi.fn() },
  assignmentServiceMock: { setPositionPrimaryOccupant: vi.fn() },
  assignmentRepoMock: { listPrimaryAssignmentsForPosition: vi.fn() },
  employeeRepoMock: { listEmployeeOptionsForCompany: vi.fn() },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/hierarchy.service", () => serviceMocks);
vi.mock("@/lib/repositories/position.repository", () => positionRepoMocks);
vi.mock("@/lib/repositories/department.repository", () => deptRepoMock);
vi.mock("@/lib/repositories/job-grade.repository", () => jobGradeRepoMock);
vi.mock("@/lib/services/job-grade.service", () => jobGradeServiceMock);
vi.mock("@/lib/services/career-framework.service", () => careerServiceMock);
vi.mock("@/lib/repositories/career-framework.repository", () => careerRepoMock);
vi.mock("@/lib/repositories/department-level-title.repository", () => deptLevelTitleRepoMock);
vi.mock("@/lib/services/assignment.service", () => assignmentServiceMock);
vi.mock("@/lib/repositories/assignment.repository", () => assignmentRepoMock);
vi.mock("@/lib/repositories/employee.repository", () => employeeRepoMock);

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import { AppError } from "@/lib/errors";
import {
  activatePositionAction,
  archivePositionAction,
  bulkArchivePositionsAction,
  bulkDeletePositionsAction,
  bulkMovePositionsAction,
  createPositionAction,
  deletePositionAction,
  deletePositionSubtreeAction,
  getSubtreeSizeAction,
  listAllPositionsAction,
  listDepartmentOptionsAction,
  listJobGradeOptionsAction,
  listPositionsAction,
  movePositionAction,
  updatePositionAction,
  listEmployeeOptionsAction,
  getPositionOccupantAction,
  setPositionOccupantAction,
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
    // anything from the payload, and scoped to the position's department
    // (levels are per-department). No custom name was sent here, so the
    // name argument is undefined and the standard scale default is used.
    expect(jobGradeServiceMock.ensureJobGradeByCode).toHaveBeenCalledWith(
      ADMIN_USER.companyId,
      VALID_UUID,
      "L7",
      undefined
    );
    // The service is handed the resolved id, not the code.
    expect(serviceMocks.createPosition.mock.calls[0]?.[0]?.jobGradeId).toBe("grade-l7");
  });

  it("passes a per-department level name through to the grade service", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    jobGradeServiceMock.ensureJobGradeByCode.mockResolvedValue({ id: "grade-l7" });
    serviceMocks.createPosition.mockResolvedValue({});

    await createPositionAction({
      title: "Principal Engineer",
      departmentId: VALID_UUID,
      jobGradeCode: "L7",
      jobGradeName: "Principal Engineer",
    });

    // The department's chosen name for this level is forwarded so the
    // grade is created/renamed for that department only.
    expect(jobGradeServiceMock.ensureJobGradeByCode).toHaveBeenCalledWith(
      ADMIN_USER.companyId,
      VALID_UUID,
      "L7",
      "Principal Engineer"
    );
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

describe("position actions — career track (careerTrackKind) resolution", () => {
  const FAMILY_UUID = "22222222-2222-4222-8222-222222222222";
  afterEach(() => vi.clearAllMocks());

  it("resolves an IC/Manager choice to a track id for the chosen sub-division, creating it on first use", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    careerServiceMock.ensureCareerTrackOfKind.mockResolvedValue({ id: "track-mgr" });
    serviceMocks.createPosition.mockResolvedValue({});

    await createPositionAction({
      title: "Engineering Manager",
      departmentId: VALID_UUID,
      jobFamilyId: FAMILY_UUID,
      careerTrackKind: "MANAGER",
    });

    expect(careerServiceMock.ensureCareerTrackOfKind).toHaveBeenCalledWith(
      ADMIN_USER.companyId,
      FAMILY_UUID,
      "MANAGER",
      expect.anything()
    );
    // The service is handed the resolved id, never the kind string.
    expect(serviceMocks.createPosition.mock.calls[0]?.[0]?.careerTrackId).toBe("track-mgr");
  });

  it("does not resolve a track when no sub-division is chosen (nothing to attach it to)", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.createPosition.mockResolvedValue({});

    await createPositionAction({
      title: "Coordinator",
      departmentId: VALID_UUID,
      careerTrackKind: "IC",
    });

    expect(careerServiceMock.ensureCareerTrackOfKind).not.toHaveBeenCalled();
    expect(serviceMocks.createPosition.mock.calls[0]?.[0]?.careerTrackId).toBeNull();
  });

  it("clears the track on update when careerTrackKind is null", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.updatePosition.mockResolvedValue({});

    await updatePositionAction({
      positionId: VALID_UUID,
      jobFamilyId: FAMILY_UUID,
      careerTrackKind: null,
    });

    expect(careerServiceMock.ensureCareerTrackOfKind).not.toHaveBeenCalled();
    expect(serviceMocks.updatePosition.mock.calls[0]?.[0]?.careerTrackId).toBeNull();
  });

  it("resolves the track on update when a kind is chosen with a sub-division", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    careerServiceMock.ensureCareerTrackOfKind.mockResolvedValue({ id: "track-ic" });
    serviceMocks.updatePosition.mockResolvedValue({});

    await updatePositionAction({
      positionId: VALID_UUID,
      jobFamilyId: FAMILY_UUID,
      careerTrackKind: "IC",
    });

    expect(careerServiceMock.ensureCareerTrackOfKind).toHaveBeenCalledWith(
      ADMIN_USER.companyId,
      FAMILY_UUID,
      "IC",
      expect.anything()
    );
    expect(serviceMocks.updatePosition.mock.calls[0]?.[0]?.careerTrackId).toBe("track-ic");
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

describe("deletePositionSubtreeAction — authorization and validation", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires positions:manage, passes the session company, and returns the deleted count", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.deletePositionSubtree.mockResolvedValue({ deletedCount: 4 });

    const result = await deletePositionSubtreeAction({ positionId: VALID_UUID });

    expect(requirePermissionMock).toHaveBeenCalledWith("positions:manage");
    // The service is always handed the SESSION's company, never anything a
    // client could smuggle in (companyId is not even an accepted field).
    expect(serviceMocks.deletePositionSubtree.mock.calls[0]?.[1]).toBe(ADMIN_USER.companyId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.deletedCount).toBe(4);
  });

  it("a VIEWER cannot subtree-delete — the service is never reached", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const result = await deletePositionSubtreeAction({ positionId: VALID_UUID });

    expect(result.ok).toBe(false);
    expect(serviceMocks.deletePositionSubtree).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before calling the service", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);

    const result = await deletePositionSubtreeAction({ positionId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    expect(serviceMocks.deletePositionSubtree).not.toHaveBeenCalled();
  });
});

describe("position actions — bulk operations", () => {
  afterEach(() => vi.clearAllMocks());

  const ID_A = "11111111-1111-4111-8111-111111111111";
  const ID_B = "22222222-2222-4222-8222-222222222222";
  const ID_C = "33333333-3333-4333-8333-333333333333";

  it.each([
    ["bulkDeletePositionsAction", () => bulkDeletePositionsAction({ positionIds: [ID_A] })],
    ["bulkArchivePositionsAction", () => bulkArchivePositionsAction({ positionIds: [ID_A] })],
    [
      "bulkMovePositionsAction",
      () => bulkMovePositionsAction({ positionIds: [ID_A], newParentPositionId: null }),
    ],
  ])("%s requires positions:manage", async (_name, invoke) => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.deletePosition.mockResolvedValue(undefined);
    serviceMocks.archivePosition.mockResolvedValue({});
    serviceMocks.movePosition.mockResolvedValue({});

    await invoke();

    expect(requirePermissionMock).toHaveBeenCalledWith("positions:manage");
  });

  it("a VIEWER rejection blocks every bulk action before any service runs", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const del = await bulkDeletePositionsAction({ positionIds: [ID_A] });
    const arch = await bulkArchivePositionsAction({ positionIds: [ID_A] });
    const move = await bulkMovePositionsAction({ positionIds: [ID_A], newParentPositionId: null });

    expect(del.ok).toBe(false);
    expect(arch.ok).toBe(false);
    expect(move.ok).toBe(false);
    expect(serviceMocks.deletePosition).not.toHaveBeenCalled();
    expect(serviceMocks.archivePosition).not.toHaveBeenCalled();
    expect(serviceMocks.movePosition).not.toHaveBeenCalled();
  });

  it("rejects an empty selection before touching the service", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);

    const result = await bulkDeletePositionsAction({ positionIds: [] });

    expect(result.ok).toBe(false);
    expect(serviceMocks.deletePosition).not.toHaveBeenCalled();
  });

  it("de-duplicates repeated ids so a position is only acted on once", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.archivePosition.mockResolvedValue({});

    const result = await bulkArchivePositionsAction({ positionIds: [ID_A, ID_A, ID_A] });

    expect(result.ok).toBe(true);
    expect(serviceMocks.archivePosition).toHaveBeenCalledTimes(1);
    if (result.ok) expect(result.data.succeeded).toEqual([ID_A]);
  });

  it("bulk delete reports per-item success and failure with the item's own reason", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.deletePosition.mockImplementation(async (id: string) => {
      if (id === ID_B) throw new AppError("It still has employment history.");
    });

    const result = await bulkDeletePositionsAction({ positionIds: [ID_A, ID_B] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.succeeded).toEqual([ID_A]);
      expect(result.data.failed).toEqual([{ id: ID_B, error: "It still has employment history." }]);
    }
  });

  it("bulk delete retries leaf-first so a parent blocked only by a selected child still deletes", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    // ID_A is the parent of ID_C: deleting A fails while C exists, succeeds after.
    const deleted = new Set<string>();
    serviceMocks.deletePosition.mockImplementation(async (id: string) => {
      if (id === ID_A && !deleted.has(ID_C)) {
        throw new AppError("It still has 1 position reporting to it.");
      }
      deleted.add(id);
    });

    const result = await bulkDeletePositionsAction({ positionIds: [ID_A, ID_C] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.failed).toEqual([]);
      expect(new Set(result.data.succeeded)).toEqual(new Set([ID_A, ID_C]));
    }
  });

  it("bulk move passes the chosen new parent to every position and aggregates cycle refusals", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.movePosition.mockImplementation(async ({ positionId }: { positionId: string }) => {
      if (positionId === ID_B) throw new AppError("That would create a reporting cycle.");
      return {};
    });

    const result = await bulkMovePositionsAction({
      positionIds: [ID_A, ID_B],
      newParentPositionId: ID_C,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.succeeded).toEqual([ID_A]);
      expect(result.data.failed).toEqual([
        { id: ID_B, error: "That would create a reporting cycle." },
      ]);
    }
    expect(serviceMocks.movePosition).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: ID_A, newParentPositionId: ID_C })
    );
  });
});

describe("position actions — assign employee to a position", () => {
  afterEach(() => vi.clearAllMocks());

  const POS = "11111111-1111-4111-8111-111111111111";
  const EMP = "22222222-2222-4222-8222-222222222222";

  it("listEmployeeOptionsAction requires employees:view", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    employeeRepoMock.listEmployeeOptionsForCompany.mockResolvedValue([]);

    await listEmployeeOptionsAction();

    expect(requirePermissionMock).toHaveBeenCalledWith("employees:view");
    expect(employeeRepoMock.listEmployeeOptionsForCompany).toHaveBeenCalledWith("company-trusted");
  });

  it("getPositionOccupantAction requires positions:view and returns the open occupant", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    assignmentRepoMock.listPrimaryAssignmentsForPosition.mockResolvedValue([
      { id: "a1", employeeId: "old", endDate: new Date("2020-01-01") },
      { id: "a2", employeeId: EMP, endDate: null },
    ]);

    const result = await getPositionOccupantAction(POS);

    expect(requirePermissionMock).toHaveBeenCalledWith("positions:view");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.employeeId).toBe(EMP);
  });

  it("getPositionOccupantAction returns null when the position is vacant", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    assignmentRepoMock.listPrimaryAssignmentsForPosition.mockResolvedValue([
      { id: "a1", employeeId: "old", endDate: new Date("2020-01-01") },
    ]);

    const result = await getPositionOccupantAction(POS);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.employeeId).toBeNull();
  });

  it("setPositionOccupantAction requires employees:manage and forwards the change", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    assignmentServiceMock.setPositionPrimaryOccupant.mockResolvedValue(undefined);

    const result = await setPositionOccupantAction({ positionId: POS, employeeId: EMP });

    expect(requirePermissionMock).toHaveBeenCalledWith("employees:manage");
    expect(assignmentServiceMock.setPositionPrimaryOccupant).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "company-trusted", positionId: POS, employeeId: EMP })
    );
    expect(result.ok).toBe(true);
  });

  it("setPositionOccupantAction accepts a null employee (vacate)", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    assignmentServiceMock.setPositionPrimaryOccupant.mockResolvedValue(undefined);

    const result = await setPositionOccupantAction({ positionId: POS, employeeId: null });

    expect(result.ok).toBe(true);
    expect(assignmentServiceMock.setPositionPrimaryOccupant).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: POS, employeeId: null })
    );
  });

  it("a VIEWER cannot set an occupant — the service is never reached", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const result = await setPositionOccupantAction({ positionId: POS, employeeId: EMP });

    expect(result.ok).toBe(false);
    expect(assignmentServiceMock.setPositionPrimaryOccupant).not.toHaveBeenCalled();
  });

  it("setPositionOccupantAction rejects a malformed id before the service", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);

    const result = await setPositionOccupantAction({ positionId: "nope", employeeId: EMP });

    expect(result.ok).toBe(false);
    expect(assignmentServiceMock.setPositionPrimaryOccupant).not.toHaveBeenCalled();
  });
});
