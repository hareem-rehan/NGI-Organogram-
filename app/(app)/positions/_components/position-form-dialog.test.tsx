import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  CareerTrack,
  Department,
  JobFamily,
  JobGrade,
  LevelMappingEntry,
  Position,
} from "@prisma/client";

const { createPositionActionMock, updatePositionActionMock } = vi.hoisted(() => ({
  createPositionActionMock: vi.fn(),
  updatePositionActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/positions/actions", () => ({
  createPositionAction: createPositionActionMock,
  updatePositionAction: updatePositionActionMock,
}));

import { PositionFormDialog, scopeReportsToOptions } from "./position-form-dialog";

const DEPARTMENT_ID = "11111111-1111-4111-8111-111111111111";
const JOB_GRADE_ID = "22222222-2222-4222-8222-222222222222";
const POSITION_ID = "33333333-3333-4333-8333-333333333333";
const FAMILY_ID = "55555555-5555-4555-8555-555555555555";
const TRACK_ID = "66666666-6666-4666-8666-666666666666";
const L7_ID = "77777777-7777-4777-8777-777777777777";

const DEPARTMENT: Department = {
  id: DEPARTMENT_ID,
  companyId: "company-1",
  name: "Engineering",
  code: "ENG",
  description: null,
  color: null,
  parentDepartmentId: null,
  status: "ACTIVE",
  displayOrder: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const JOB_GRADE: JobGrade = {
  id: JOB_GRADE_ID,
  companyId: "company-1",
  departmentId: null,
  name: "L5",
  code: "L5",
  description: null,
  displayOrder: 5,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const L7_GRADE: JobGrade = {
  ...JOB_GRADE,
  id: L7_ID,
  name: "Lead / Principal",
  code: "L7",
  displayOrder: 7,
};

const SWE_FAMILY: JobFamily = {
  id: FAMILY_ID,
  companyId: "company-1",
  departmentId: DEPARTMENT_ID,
  name: "Software Engineering",
  code: "SWE",
  description: null,
  displayOrder: null,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const IC_TRACK: CareerTrack = {
  id: TRACK_ID,
  companyId: "company-1",
  jobFamilyId: FAMILY_ID,
  kind: "IC",
  name: "Individual Contributor",
  displayOrder: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MGR_TRACK_ID = "77777777-7777-4777-8777-777777777777";
const MGR_TRACK: CareerTrack = {
  id: MGR_TRACK_ID,
  companyId: "company-1",
  jobFamilyId: FAMILY_ID,
  kind: "MANAGER",
  name: "Manager",
  displayOrder: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const L7_IC_ENTRY: LevelMappingEntry = {
  id: "88888888-8888-4888-8888-888888888888",
  companyId: "company-1",
  jobFamilyId: FAMILY_ID,
  careerTrackId: TRACK_ID,
  jobGradeId: L7_ID,
  title: "Principal Software Engineer",
  displayOrder: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: POSITION_ID,
    companyId: "company-1",
    departmentId: DEPARTMENT_ID,
    jobGradeId: null,
    jobFamilyId: null,
    careerTrackId: null,
    title: "Engineering Manager",
    positionCode: "POS-ENGMGR",
    description: null,
    location: null,
    status: "ACTIVE",
    primaryReportsToPositionId: null,
    organizationalLevel: 1,
    displayOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

type FormProps = Parameters<typeof PositionFormDialog>[0];

function renderForm(overrides: Partial<FormProps> = {}) {
  const props: FormProps = {
    open: true,
    onOpenChange: () => {},
    position: null,
    departments: [DEPARTMENT],
    jobGrades: [],
    jobFamilies: [],
    careerTracks: [],
    levelMappingEntries: [],
    allPositions: [],
    onSaved: () => {},
    ...overrides,
  };
  return render(<PositionFormDialog {...props} />);
}

describe("PositionFormDialog", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders a create form with a Reports-To picker when position is null", () => {
    renderForm({ jobGrades: [JOB_GRADE] });
    expect(screen.getByRole("heading", { name: "Add Position" })).toBeInTheDocument();
    expect(screen.getByLabelText(/reports to/i)).toBeInTheDocument();
  });

  it("does not show a Reports-To picker when editing (that's a separate dedicated flow)", () => {
    const position = makePosition();
    renderForm({ position, jobGrades: [JOB_GRADE], allPositions: [position] });
    expect(screen.getByText(/change reports-to.*instead/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^reports to$/i)).not.toBeInTheDocument();
  });

  it("prefills the edit form with the position's current values", () => {
    const position = makePosition({ title: "VP Engineering", positionCode: "POS-VPENG" });
    renderForm({ position, jobGrades: [JOB_GRADE], allPositions: [position] });
    expect(screen.getByLabelText(/title/i)).toHaveValue("VP Engineering");
    expect(screen.queryByLabelText(/^code$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/location/i)).not.toBeInTheDocument();
  });

  it("shows a validation error and never calls the server action for a missing title", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: /create position/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(createPositionActionMock).not.toHaveBeenCalled();
  });

  it("submits create with entered values and no positionCode (the action generates it)", async () => {
    createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition() });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderForm({ onSaved });

    await user.type(screen.getByLabelText(/title/i), "Engineering Manager");
    await user.click(screen.getByRole("button", { name: /create position/i }));

    await waitFor(() => expect(createPositionActionMock).toHaveBeenCalled());
    expect(createPositionActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Engineering Manager", departmentId: DEPARTMENT_ID })
    );
    expect(createPositionActionMock.mock.calls[0]?.[0]).not.toHaveProperty("positionCode");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("shows each Level as its code plus the level's role name", () => {
    renderForm({ jobGrades: [L7_GRADE] });
    const levelSelect = screen.getByLabelText(/^level$/i);
    // The option reads "L7 — Lead / Principal", not the bare code.
    expect(
      within(levelSelect).getByRole("option", { name: /L7\s*—\s*Lead \/ Principal/ })
    ).toBeInTheDocument();
  });

  it("single-ladder family: hides the track picker and auto-classifies onto the base ladder", async () => {
    createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition() });
    const user = userEvent.setup();
    renderForm({
      jobGrades: [L7_GRADE],
      jobFamilies: [SWE_FAMILY],
      careerTracks: [IC_TRACK], // one ladder only
      levelMappingEntries: [L7_IC_ENTRY],
    });

    await user.selectOptions(screen.getByLabelText(/job family/i), FAMILY_ID);
    // No ladder to choose in single-ladder mode.
    expect(screen.queryByLabelText(/career track/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^level$/i), L7_ID);
    // The cell title is still suggested, because the position is auto-pinned
    // to the family's base (IC) ladder behind the scenes.
    const suggestion = document.querySelector(
      '#position-title-suggestions option[value="Principal Software Engineer"]'
    );
    expect(suggestion).not.toBeNull();

    await user.type(screen.getByLabelText(/title/i), "Principal Software Engineer");
    await user.click(screen.getByRole("button", { name: /create position/i }));

    await waitFor(() => expect(createPositionActionMock).toHaveBeenCalled());
    expect(createPositionActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Principal Software Engineer",
        departmentId: DEPARTMENT_ID,
        jobFamilyId: FAMILY_ID,
        careerTrackId: TRACK_ID, // auto-selected base ladder
        jobGradeId: L7_ID,
      })
    );
  });

  it("dual-ladder family: shows the track picker and submits the chosen ladder", async () => {
    createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition() });
    const user = userEvent.setup();
    renderForm({
      jobGrades: [L7_GRADE],
      jobFamilies: [SWE_FAMILY],
      careerTracks: [IC_TRACK, MGR_TRACK], // parallel ladders
      levelMappingEntries: [L7_IC_ENTRY],
    });

    await user.selectOptions(screen.getByLabelText(/job family/i), FAMILY_ID);
    // The picker appears only once a parallel ladder exists.
    await user.selectOptions(screen.getByLabelText(/career track/i), MGR_TRACK_ID);
    expect(screen.getByLabelText(/career track/i)).toHaveValue(MGR_TRACK_ID);
    await user.selectOptions(screen.getByLabelText(/^level$/i), L7_ID);

    await user.type(screen.getByLabelText(/title/i), "Engineering Manager");
    await user.click(screen.getByRole("button", { name: /create position/i }));

    await waitFor(() => expect(createPositionActionMock).toHaveBeenCalled());
    expect(createPositionActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Engineering Manager",
        departmentId: DEPARTMENT_ID,
        jobFamilyId: FAMILY_ID,
        careerTrackId: MGR_TRACK_ID,
        jobGradeId: L7_ID,
      })
    );
  });

  it("scopes job families to the selected department", () => {
    const otherFamily: JobFamily = { ...SWE_FAMILY, id: "other", departmentId: "other-dept" };
    renderForm({ jobFamilies: [SWE_FAMILY, otherFamily] });
    const familySelect = screen.getByLabelText(/job family/i);
    expect(
      within(familySelect).getByRole("option", { name: "Software Engineering" })
    ).toBeInTheDocument();
    // The family from another department is not offered.
    expect(within(familySelect).getAllByRole("option")).toHaveLength(2); // "None" + SWE only
  });

  it("no longer renders a per-department Level name field", async () => {
    const user = userEvent.setup();
    renderForm({ jobGrades: [L7_GRADE] });
    await user.selectOptions(screen.getByLabelText(/^level$/i), L7_ID);
    expect(screen.queryByLabelText(/level name/i)).not.toBeInTheDocument();
  });

  it("shows a server error and keeps the dialog open", async () => {
    createPositionActionMock.mockResolvedValue({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderForm({ onOpenChange });

    await user.type(screen.getByLabelText(/title/i), "Engineering Manager");
    await user.click(screen.getByRole("button", { name: /create position/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("edit submission never includes primaryReportsToPositionId in the update payload", async () => {
    const position = makePosition();
    updatePositionActionMock.mockResolvedValue({ ok: true, data: position });
    const user = userEvent.setup();
    renderForm({ position, allPositions: [position] });

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updatePositionActionMock).toHaveBeenCalled());
    const payload = updatePositionActionMock.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("primaryReportsToPositionId");
  });
});

describe("scopeReportsToOptions", () => {
  const ceo = makePosition({
    id: "ceo",
    title: "CEO",
    positionCode: "POS-CEO",
    departmentId: "exec-dept",
    primaryReportsToPositionId: null,
  });
  const engManager = makePosition({
    id: "eng1",
    title: "CTO",
    positionCode: "POS-ENG",
    departmentId: DEPARTMENT_ID,
    primaryReportsToPositionId: "ceo",
  });
  const hrManager = makePosition({
    id: "hr1",
    title: "VP HR",
    positionCode: "POS-HR",
    departmentId: "hr-dept",
    primaryReportsToPositionId: "ceo",
  });
  const all = [ceo, engManager, hrManager];

  it("offers only same-department positions, hiding other departments (incl. a cross-department root)", () => {
    const ids = scopeReportsToOptions(all, DEPARTMENT_ID, "").map((o) => o.value);
    expect(ids).toEqual(["eng1"]);
    // The root CEO lives in another department, so it is no longer offered.
    expect(ids).not.toContain("ceo");
    expect(ids).not.toContain("hr1");
  });

  it("offers nothing for a department that has no positions of its own", () => {
    expect(scopeReportsToOptions(all, "client-delivery-dept", "")).toHaveLength(0);
  });

  it("applies no department scope when none is selected", () => {
    const ids = scopeReportsToOptions(all, "", "").map((o) => o.value);
    expect(ids).toEqual(["ceo", "eng1", "hr1"]);
  });

  it("filters the scoped set by title or code query", () => {
    expect(scopeReportsToOptions(all, DEPARTMENT_ID, "cto").map((o) => o.value)).toEqual(["eng1"]);
    // A same-department code matches; the cross-department root does not.
    expect(scopeReportsToOptions(all, DEPARTMENT_ID, "POS-ENG").map((o) => o.value)).toEqual([
      "eng1",
    ]);
    expect(scopeReportsToOptions(all, DEPARTMENT_ID, "POS-CEO")).toHaveLength(0);
    expect(scopeReportsToOptions(all, DEPARTMENT_ID, "zzz")).toHaveLength(0);
  });

  it("describes each option by job family only — never the level or position code", () => {
    const positions = [
      makePosition({
        id: "eng1",
        title: "CTO",
        positionCode: "POS-ENG",
        departmentId: DEPARTMENT_ID,
        organizationalLevel: 2,
        jobFamilyId: FAMILY_ID,
        primaryReportsToPositionId: "ceo",
      }),
    ];
    const options = scopeReportsToOptions(
      positions,
      DEPARTMENT_ID,
      "",
      new Map([[FAMILY_ID, "Software Engineering"]])
    );
    expect(options[0]?.description).toBe("Software Engineering");
    expect(options[0]?.description).not.toContain("Level");
    expect(options[0]?.description).not.toContain("POS-");
  });

  it("shows no secondary line when a position has no family", () => {
    const positions = [
      makePosition({
        id: "eng1",
        title: "CTO",
        positionCode: "POS-ENG",
        departmentId: DEPARTMENT_ID,
        organizationalLevel: 2,
        jobFamilyId: null,
        primaryReportsToPositionId: "ceo",
      }),
    ];
    const options = scopeReportsToOptions(positions, DEPARTMENT_ID, "", new Map());
    expect(options[0]?.description).toBeUndefined();
  });
});
