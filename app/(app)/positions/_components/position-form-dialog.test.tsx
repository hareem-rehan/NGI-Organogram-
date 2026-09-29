import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CareerTrack, Department, JobFamily, JobGrade, Position } from "@prisma/client";

const {
  createPositionActionMock,
  updatePositionActionMock,
  listEmployeeOptionsActionMock,
  getPositionOccupantActionMock,
  setPositionOccupantActionMock,
} = vi.hoisted(() => ({
  createPositionActionMock: vi.fn(),
  updatePositionActionMock: vi.fn(),
  listEmployeeOptionsActionMock: vi.fn(),
  getPositionOccupantActionMock: vi.fn(),
  setPositionOccupantActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/positions/actions", () => ({
  createPositionAction: createPositionActionMock,
  updatePositionAction: updatePositionActionMock,
  listEmployeeOptionsAction: listEmployeeOptionsActionMock,
  getPositionOccupantAction: getPositionOccupantActionMock,
  setPositionOccupantAction: setPositionOccupantActionMock,
}));

// The shared Combobox's Radix Popover hangs in jsdom once opened (a known,
// already-investigated limitation — see organogram-search-box.test.tsx; the
// real popover is covered by e2e). Stand it in with a native <select> so the
// form's own picker logic can be driven here.
vi.mock("@/components/ui/combobox", () => ({
  Combobox: (props: {
    id?: string;
    value: string | null;
    onChange: (value: string) => void;
    options: readonly { value: string; label: string }[];
    "aria-label"?: string;
  }) => (
    <select
      id={props.id}
      aria-label={props["aria-label"]}
      value={props.value ?? ""}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
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
  hasIcLadder: true,
  hasManagerLadder: true,
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
    ladderKind: null,
    description: null,
    location: null,
    status: "ACTIVE",
    primaryReportsToPositionId: null,
    coReportsToPositionId: null,
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
    allPositions: [],
    onSaved: () => {},
    ...overrides,
  };
  return render(<PositionFormDialog {...props} />);
}

const EMPLOYEE_A_ID = "88888888-8888-4888-8888-888888888888";
const EMPLOYEE_B_ID = "99999999-9999-4999-8999-999999999999";
const EMPLOYEES = [
  {
    id: EMPLOYEE_A_ID,
    firstName: "Ayesha",
    lastName: "Khan",
    preferredName: null,
    employeeCode: "EMP-001",
  },
  {
    id: EMPLOYEE_B_ID,
    firstName: "Bilal",
    lastName: "Ahmed",
    preferredName: null,
    employeeCode: "EMP-002",
  },
];

describe("PositionFormDialog", () => {
  beforeEach(() => {
    listEmployeeOptionsActionMock.mockResolvedValue({ ok: true, data: EMPLOYEES });
    getPositionOccupantActionMock.mockResolvedValue({ ok: true, data: { employeeId: null } });
    setPositionOccupantActionMock.mockResolvedValue({ ok: true, data: null });
  });
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

  it("always shows the IC/Manager/None career-track picker (even without a sub-division)", () => {
    renderForm({ jobGrades: [L7_GRADE] });
    const trackSelect = screen.getByLabelText(/career track/i);
    expect(
      within(trackSelect).getByRole("option", { name: /individual contributor/i })
    ).toBeInTheDocument();
    expect(within(trackSelect).getByRole("option", { name: /^manager$/i })).toBeInTheDocument();
    expect(within(trackSelect).getByRole("option", { name: /^none$/i })).toBeInTheDocument();
  });

  it("submits the chosen IC/Manager as careerTrackKind even with no sub-division", async () => {
    createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition() });
    const user = userEvent.setup();
    renderForm({ jobGrades: [L7_GRADE] });

    await user.selectOptions(screen.getByLabelText(/career track/i), "MANAGER");
    await user.type(screen.getByLabelText(/title/i), "Engineering Manager");
    await user.click(screen.getByRole("button", { name: /create position/i }));

    await waitFor(() => expect(createPositionActionMock).toHaveBeenCalled());
    expect(createPositionActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ careerTrackKind: "MANAGER", jobFamilyId: null })
    );
  });

  it("offers a plain IC/Manager choice once a sub-division is chosen, and submits it as careerTrackKind", async () => {
    createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition() });
    const user = userEvent.setup();
    renderForm({
      jobGrades: [L7_GRADE],
      jobFamilies: [SWE_FAMILY],
      careerTracks: [], // no tracks configured yet — the choice still works
    });

    await user.selectOptions(screen.getByLabelText(/sub-division/i), FAMILY_ID);
    // The picker offers a plain, framework-independent choice.
    const trackSelect = screen.getByLabelText(/career track/i);
    expect(
      within(trackSelect).getByRole("option", { name: /individual contributor/i })
    ).toBeInTheDocument();
    expect(within(trackSelect).getByRole("option", { name: /^manager$/i })).toBeInTheDocument();

    await user.selectOptions(trackSelect, "MANAGER");
    // The Level picker works in level codes (the full standard scale).
    await user.selectOptions(screen.getByLabelText(/^level$/i), "L7");

    await user.type(screen.getByLabelText(/title/i), "Engineering Manager");
    await user.click(screen.getByRole("button", { name: /create position/i }));

    await waitFor(() => expect(createPositionActionMock).toHaveBeenCalled());
    expect(createPositionActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Engineering Manager",
        departmentId: DEPARTMENT_ID,
        jobFamilyId: FAMILY_ID,
        careerTrackKind: "MANAGER",
        jobGradeCode: "L7",
      })
    );
  });

  it("offers the full standard scale (L2–L18) even when no levels are set up", () => {
    renderForm({ jobGrades: [] });
    const levelSelect = screen.getByLabelText(/^level$/i);
    // Every standard level is selectable, not just the ones that exist.
    expect(within(levelSelect).getByRole("option", { name: /^L2\b/ })).toBeInTheDocument();
    expect(
      within(levelSelect).getByRole("option", { name: /L18\s*—\s*C Suite/ })
    ).toBeInTheDocument();
    // "No level" plus the 17 scale levels.
    expect(within(levelSelect).getAllByRole("option")).toHaveLength(18);
  });

  it("does not auto-fill the Title (Title stays whatever the user typed)", async () => {
    const user = userEvent.setup();
    renderForm({ jobGrades: [L7_GRADE] });
    await user.selectOptions(screen.getByLabelText(/^level$/i), "L7");
    // No "Level name" picker exists any more, and Title is untouched.
    expect(screen.queryByLabelText(/level name/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue("");
  });

  it("prefills the Career-track choice from the position's stored ladder when editing", () => {
    const position = makePosition({ jobFamilyId: FAMILY_ID, careerTrackId: MGR_TRACK_ID });
    renderForm({
      position,
      jobFamilies: [SWE_FAMILY],
      careerTracks: [IC_TRACK, MGR_TRACK],
      allPositions: [position],
    });
    expect(screen.getByLabelText(/career track/i)).toHaveValue("MANAGER");
  });

  it("scopes sub-divisions to the selected department", () => {
    const otherFamily: JobFamily = { ...SWE_FAMILY, id: "other", departmentId: "other-dept" };
    renderForm({ jobFamilies: [SWE_FAMILY, otherFamily] });
    const familySelect = screen.getByLabelText(/sub-division/i);
    expect(
      within(familySelect).getByRole("option", { name: "Software Engineering" })
    ).toBeInTheDocument();
    // The family from another department is not offered.
    expect(within(familySelect).getAllByRole("option")).toHaveLength(2); // "None" + SWE only
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

  describe("Second Reports-To (D27)", () => {
    const HEAD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const HEAD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const root = makePosition({ id: POSITION_ID, title: "CEO", positionCode: "POS-CEO" });
    const headA = makePosition({
      id: HEAD_A,
      title: "Sr. Software Engineer II",
      positionCode: "POS-A",
      primaryReportsToPositionId: POSITION_ID,
    });
    const headB = makePosition({
      id: HEAD_B,
      title: "Associate Tech Lead",
      positionCode: "POS-B",
      primaryReportsToPositionId: POSITION_ID,
    });
    const secondPicker = () => screen.queryByRole("combobox", { name: /second reports-to/i });

    it("only appears once a first head is chosen, and never offers that head again", async () => {
      const user = userEvent.setup();
      renderForm({ allPositions: [root, headA, headB] });

      expect(secondPicker()).not.toBeInTheDocument();
      await user.selectOptions(screen.getByRole("combobox", { name: /^reports to$/i }), HEAD_A);

      const labels = within(secondPicker()!)
        .getAllByRole("option")
        .map((o) => o.textContent);
      expect(labels).toContain("Associate Tech Lead");
      expect(labels).not.toContain("Sr. Software Engineer II");
    });

    it("submits both heads on create", async () => {
      createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition() });
      const user = userEvent.setup();
      renderForm({ allPositions: [root, headA, headB] });

      await user.type(screen.getByLabelText(/title/i), "Sr. Software Engineer");
      await user.selectOptions(screen.getByRole("combobox", { name: /^reports to$/i }), HEAD_A);
      await user.selectOptions(secondPicker()!, HEAD_B);
      await user.click(screen.getByRole("button", { name: /create position/i }));

      await waitFor(() =>
        expect(createPositionActionMock).toHaveBeenCalledWith(
          expect.objectContaining({
            primaryReportsToPositionId: HEAD_A,
            coReportsToPositionId: HEAD_B,
          })
        )
      );
    });

    it("sends no second head when left as None", async () => {
      createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition() });
      const user = userEvent.setup();
      renderForm({ allPositions: [root, headA, headB] });

      await user.type(screen.getByLabelText(/title/i), "Software Engineer");
      await user.selectOptions(screen.getByRole("combobox", { name: /^reports to$/i }), HEAD_A);
      await user.click(screen.getByRole("button", { name: /create position/i }));

      await waitFor(() =>
        expect(createPositionActionMock).toHaveBeenCalledWith(
          expect.objectContaining({ coReportsToPositionId: null })
        )
      );
    });

    it("is not offered when editing (reporting lines change through Change Reports-To)", () => {
      renderForm({ position: headA, allPositions: [root, headA, headB] });
      expect(secondPicker()).not.toBeInTheDocument();
    });
  });

  describe("Level names follow the department (D32)", () => {
    it("shows the department's own Levels-Mapping names, and defaults elsewhere", async () => {
      const user = userEvent.setup();
      const OTHER = {
        ...DEPARTMENT,
        id: "99999999-0000-4000-8000-000000000001",
        name: "Finance",
        code: "FIN",
      };
      renderForm({
        departments: [DEPARTMENT, OTHER],
        levelTitles: [
          {
            departmentId: DEPARTMENT_ID,
            jobGradeCode: "L7",
            kind: "IC",
            title: "Principal Engineer",
          },
        ],
      });

      const level = screen.getByLabelText(/^level$/i);
      expect(
        within(level).getByRole("option", { name: /L7\s*—\s*Principal Engineer/ })
      ).toBeInTheDocument();

      await user.selectOptions(screen.getByRole("combobox", { name: "Department" }), OTHER.id);
      expect(
        within(screen.getByLabelText(/^level$/i)).getByRole("option", {
          name: /L7\s*—\s*Lead \/ Principal/,
        })
      ).toBeInTheDocument();
    });
  });

  describe("Assigned employee", () => {
    const picker = () => screen.getByRole("combobox", { name: /assigned employee/i });

    async function pickEmployee(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
      await waitFor(() => expect(within(picker()).getByRole("option", { name })).toBeTruthy());
      await user.selectOptions(picker(), within(picker()).getByRole("option", { name }));
    }

    it("prefills the picker with the position's current occupant when editing", async () => {
      getPositionOccupantActionMock.mockResolvedValue({
        ok: true,
        data: { employeeId: EMPLOYEE_A_ID },
      });
      const position = makePosition();
      renderForm({ position, allPositions: [position] });

      await waitFor(() => expect(picker()).toHaveDisplayValue("Ayesha Khan"));
      expect(getPositionOccupantActionMock).toHaveBeenCalledWith(POSITION_ID);
    });

    it("does not touch assignments when the occupant is unchanged", async () => {
      getPositionOccupantActionMock.mockResolvedValue({
        ok: true,
        data: { employeeId: EMPLOYEE_A_ID },
      });
      const position = makePosition();
      updatePositionActionMock.mockResolvedValue({ ok: true, data: position });
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      renderForm({ position, allPositions: [position], onOpenChange });
      await waitFor(() => expect(picker()).toHaveDisplayValue("Ayesha Khan"));

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(setPositionOccupantActionMock).not.toHaveBeenCalled();
    });

    it("vacates the position when 'Vacant' is chosen on edit", async () => {
      getPositionOccupantActionMock.mockResolvedValue({
        ok: true,
        data: { employeeId: EMPLOYEE_A_ID },
      });
      const position = makePosition();
      updatePositionActionMock.mockResolvedValue({ ok: true, data: position });
      const user = userEvent.setup();
      renderForm({ position, allPositions: [position] });
      await waitFor(() => expect(picker()).toHaveDisplayValue("Ayesha Khan"));

      await pickEmployee(user, /vacant/i);
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() =>
        expect(setPositionOccupantActionMock).toHaveBeenCalledWith({
          positionId: POSITION_ID,
          employeeId: null,
        })
      );
    });

    it("assigns the chosen employee to a newly created position", async () => {
      const NEW_ID = "44444444-4444-4444-8444-444444444444";
      createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition({ id: NEW_ID }) });
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      renderForm({ onOpenChange });

      await user.type(screen.getByLabelText(/title/i), "Engineering Manager");
      await pickEmployee(user, /bilal ahmed/i);
      await user.click(screen.getByRole("button", { name: /create position/i }));

      await waitFor(() =>
        expect(setPositionOccupantActionMock).toHaveBeenCalledWith({
          positionId: NEW_ID,
          employeeId: EMPLOYEE_B_ID,
        })
      );
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });

    it("keeps the dialog open on an assignment conflict, and a retry updates instead of re-creating", async () => {
      const NEW_ID = "44444444-4444-4444-8444-444444444444";
      createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition({ id: NEW_ID }) });
      updatePositionActionMock.mockResolvedValue({ ok: true, data: makePosition({ id: NEW_ID }) });
      setPositionOccupantActionMock.mockResolvedValueOnce({
        ok: false,
        error: "This employee already holds another position.",
      });
      const onOpenChange = vi.fn();
      const onSaved = vi.fn();
      const user = userEvent.setup();
      renderForm({ onOpenChange, onSaved });

      await user.type(screen.getByLabelText(/title/i), "Engineering Manager");
      await pickEmployee(user, /bilal ahmed/i);
      await user.click(screen.getByRole("button", { name: /create position/i }));

      expect(await screen.findByText(/already holds another position/i)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(onSaved).toHaveBeenCalled();

      // The first save's transition must finish before the retry: until then
      // the button reads "Saving…" (and is disabled), so wait for it to read
      // "Create position" and be enabled again.
      const createButton = await screen.findByRole(
        "button",
        { name: /create position/i },
        { timeout: 3000 }
      );
      await waitFor(() => expect(createButton).toBeEnabled());
      await user.click(createButton);

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), { timeout: 3000 });
      expect(createPositionActionMock).toHaveBeenCalledTimes(1);
      expect(updatePositionActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ positionId: NEW_ID })
      );
      expect(setPositionOccupantActionMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe("scopeReportsToOptions", () => {
  const ceo = makePosition({
    id: "ceo",
    title: "CEO",
    positionCode: "POS-CEO",
    ladderKind: null,
    departmentId: "exec-dept",
    primaryReportsToPositionId: null,
  });
  const engManager = makePosition({
    id: "eng1",
    title: "CTO",
    positionCode: "POS-ENG",
    ladderKind: null,
    departmentId: DEPARTMENT_ID,
    primaryReportsToPositionId: "ceo",
  });
  const hrManager = makePosition({
    id: "hr1",
    title: "VP HR",
    positionCode: "POS-HR",
    ladderKind: null,
    departmentId: "hr-dept",
    primaryReportsToPositionId: "ceo",
  });
  const all = [ceo, engManager, hrManager];

  it("offers same-department positions plus the company root, hiding other departments", () => {
    const ids = scopeReportsToOptions(all, DEPARTMENT_ID, "").map((o) => o.value);
    expect(ids).toContain("eng1"); // same department
    expect(ids).toContain("ceo"); // the company root, always allowed
    expect(ids).not.toContain("hr1"); // a different department's position is hidden
  });

  it("offers only the company root for a department that has no positions of its own", () => {
    expect(scopeReportsToOptions(all, "client-delivery-dept", "").map((o) => o.value)).toEqual([
      "ceo",
    ]);
  });

  it("applies no department scope when none is selected", () => {
    const ids = scopeReportsToOptions(all, "", "").map((o) => o.value);
    expect(ids).toEqual(["ceo", "eng1", "hr1"]);
  });

  it("filters the scoped set by title or code query", () => {
    expect(scopeReportsToOptions(all, DEPARTMENT_ID, "cto").map((o) => o.value)).toEqual(["eng1"]);
    // The company root stays reachable by name/code even under a department scope.
    expect(scopeReportsToOptions(all, DEPARTMENT_ID, "POS-CEO").map((o) => o.value)).toEqual([
      "ceo",
    ]);
    expect(scopeReportsToOptions(all, DEPARTMENT_ID, "zzz")).toHaveLength(0);
  });

  it("describes each option by sub-division only — never the level or position code", () => {
    const positions = [
      makePosition({
        id: "eng1",
        title: "CTO",
        positionCode: "POS-ENG",
        ladderKind: null,
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
        ladderKind: null,
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
