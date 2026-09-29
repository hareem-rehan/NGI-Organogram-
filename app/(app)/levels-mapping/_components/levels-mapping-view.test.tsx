import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  Department,
  DepartmentLevelTitle,
  JobFamily,
  JobFamilyLevelTitle,
} from "@prisma/client";

vi.mock("@/app/(app)/levels-mapping/actions", () => ({
  getLevelsMappingAction: vi.fn(),
  createDepartmentLevelTitleAction: vi.fn(),
  updateDepartmentLevelTitleAction: vi.fn(),
  deleteDepartmentLevelTitleAction: vi.fn(),
  createJobFamilyLevelTitleAction: vi.fn(),
  updateJobFamilyLevelTitleAction: vi.fn(),
  deleteJobFamilyLevelTitleAction: vi.fn(),
  setLevelsMappingColumnAction: vi.fn(),
}));

import { setLevelsMappingColumnAction } from "@/app/(app)/levels-mapping/actions";
import { LevelsMappingView } from "./levels-mapping-view";

const setColumnMock = vi.mocked(setLevelsMappingColumnAction);

const ENG: Department = {
  id: "dept-eng",
  companyId: "c1",
  name: "Engineering",
  code: "ENG",
  description: null,
  color: "#16a34a",
  parentDepartmentId: null,
  hasIcLadder: true,
  hasManagerLadder: true,
  showInLevelsMapping: true,
  status: "ACTIVE",
  displayOrder: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function title(
  id: string,
  kind: "IC" | "MANAGER",
  jobGradeCode: string,
  titleText: string,
  departmentId = "dept-eng"
): DepartmentLevelTitle {
  return {
    id,
    companyId: "c1",
    departmentId,
    jobGradeCode,
    kind,
    title: titleText,
    displayOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const SEEDED = {
  departmentTitles: [
    title("t-l3-ic", "IC", "L3", "Software Engineer"),
    title("t-l6-mgr", "MANAGER", "L6", "Associate Tech Lead"),
  ],
  subDivisionTitles: [] as JobFamilyLevelTitle[],
};
const NO_TITLES = { departmentTitles: [], subDivisionTitles: [] };

const QA: JobFamily = {
  id: "fam-qa",
  companyId: "c1",
  departmentId: "dept-eng",
  name: "Quality Assurance",
  code: "QA",
  description: null,
  displayOrder: null,
  status: "ACTIVE",
  showInLevelsMapping: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function renderView(overrides: Partial<Parameters<typeof LevelsMappingView>[0]> = {}) {
  return render(
    <LevelsMappingView canManage departments={[ENG]} initialTitles={SEEDED} {...overrides} />
  );
}

describe("LevelsMappingView", () => {
  it("shows an empty state when there are no departments", () => {
    renderView({ departments: [], initialTitles: NO_TITLES });
    expect(screen.getByText(/no departments yet/i)).toBeInTheDocument();
  });

  it("renders each department as a column header with IC and Manager sub-columns", () => {
    renderView();
    // Department appears both as a column header and in the legend.
    expect(screen.getAllByText("Engineering").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("columnheader", { name: "IC" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Manager" })).toBeInTheDocument();
  });

  it("renders the full L2–L18 scale as row headers", () => {
    renderView();
    expect(screen.getByRole("rowheader", { name: /L2/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /L18/ })).toBeInTheDocument();
  });

  it("shows the seeded level names in their cells", () => {
    renderView();
    expect(screen.getByText("Software Engineer")).toBeInTheDocument();
    expect(screen.getByText("Associate Tech Lead")).toBeInTheDocument();
  });

  it("offers add / edit / remove controls when manageable", () => {
    renderView();
    expect(screen.getByRole("button", { name: /edit software engineer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove software engineer/i })).toBeInTheDocument();
    // An add affordance exists for an empty cell (e.g. IC at L2 in Engineering).
    expect(
      screen.getByRole("button", { name: /add ic l2 level name in engineering/i })
    ).toBeInTheDocument();
  });

  it("is read-only for viewers — no add / edit / remove controls, but names are visible", () => {
    renderView({ canManage: false });
    expect(
      screen.queryByRole("button", { name: /edit software engineer/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove software engineer/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add .* level name/i })).not.toBeInTheDocument();
    // The names still render.
    expect(screen.getByText("Software Engineer")).toBeInTheDocument();
  });

  it("hides a department whose columns are turned off, and offers it under Add column", () => {
    const founder: Department = {
      ...ENG,
      id: "dept-founder",
      name: "Founder",
      code: "FOUNDER",
      hasIcLadder: false,
      hasManagerLadder: false,
      showInLevelsMapping: false,
    };
    renderView({ departments: [ENG, founder], initialTitles: NO_TITLES });
    expect(screen.getAllByText("Engineering").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("columnheader", { name: /founder/i })).not.toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: /add column/i });
    expect(
      within(picker).getByRole("option", { name: "Founder (department)" })
    ).toBeInTheDocument();
  });

  it("adds a hidden department's columns — both ladders when it runs neither", async () => {
    const founder: Department = {
      ...ENG,
      id: "dept-founder",
      name: "Founder",
      code: "FOUNDER",
      hasIcLadder: false,
      hasManagerLadder: false,
      showInLevelsMapping: false,
    };
    setColumnMock.mockResolvedValueOnce({
      ok: true,
      data: { ...founder, showInLevelsMapping: true },
    });
    renderView({ departments: [founder], initialTitles: NO_TITLES });
    expect(screen.getByText(/no columns are shown yet/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: /add column/i }), {
      target: { value: "DEPARTMENT:dept-founder" },
    });

    await waitFor(() =>
      expect(screen.getByRole("columnheader", { name: /founder/i })).toBeInTheDocument()
    );
    expect(setColumnMock).toHaveBeenCalledWith({
      target: "DEPARTMENT",
      id: "dept-founder",
      visible: true,
    });
    expect(screen.getByRole("columnheader", { name: "IC" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Manager" })).toBeInTheDocument();
  });

  it("shows a sub-division's own columns with its own level names", () => {
    renderView({
      subDivisions: [{ ...QA, showInLevelsMapping: true }],
      initialTitles: {
        departmentTitles: [],
        subDivisionTitles: [
          {
            id: "fam-t1",
            companyId: "c1",
            jobFamilyId: "fam-qa",
            jobGradeCode: "L3",
            kind: "IC",
            title: "QA Engineer",
            displayOrder: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    });
    expect(screen.getByRole("columnheader", { name: /quality assurance/i })).toBeInTheDocument();
    expect(screen.getByText("QA Engineer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add ic l2 level name in quality assurance/i })
    ).toBeInTheDocument();
  });

  it("offers a hidden sub-division under its department in Add column", () => {
    renderView({ subDivisions: [QA] });
    const picker = screen.getByRole("combobox", { name: /add column/i });
    expect(
      within(picker).getByRole("option", { name: "Quality Assurance (sub-division)" })
    ).toBeInTheDocument();
    // Engineering is already shown, so it is not offered again.
    expect(within(picker).queryByRole("option", { name: /engineering/i })).not.toBeInTheDocument();
  });

  it("removes a column group without deleting its level names", async () => {
    setColumnMock.mockResolvedValueOnce({ ok: true, data: { ...ENG, showInLevelsMapping: false } });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /remove engineering columns/i }));
    await waitFor(() => expect(screen.queryByText("Software Engineer")).not.toBeInTheDocument());
    expect(setColumnMock).toHaveBeenCalledWith({
      target: "DEPARTMENT",
      id: "dept-eng",
      visible: false,
    });
    expect(screen.getByRole("option", { name: "Engineering (department)" })).toBeInTheDocument();
  });

  it("shows a server refusal when a column change fails", async () => {
    setColumnMock.mockResolvedValueOnce({
      ok: false,
      error: "You do not have permission.",
    } as never);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /remove engineering columns/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/permission/i);
    expect(screen.getByText("Software Engineer")).toBeInTheDocument();
  });

  it("gives viewers no Add column picker and no remove buttons", () => {
    renderView({ canManage: false, subDivisions: [QA] });
    expect(screen.queryByRole("combobox", { name: /add column/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove engineering columns/i })
    ).not.toBeInTheDocument();
  });

  it("shows only the Manager column for a Manager-only department", () => {
    const project: Department = {
      ...ENG,
      id: "dept-project",
      name: "Project",
      code: "PROJECT",
      hasIcLadder: false,
      hasManagerLadder: true,
    };
    renderView({ departments: [project], initialTitles: NO_TITLES });
    expect(screen.getByRole("columnheader", { name: "Manager" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "IC" })).not.toBeInTheDocument();
    // Only Manager add-cells exist for Project.
    expect(
      screen.getByRole("button", { name: /add manager l2 level name in project/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add ic l2 level name in project/i })
    ).not.toBeInTheDocument();
  });
});
