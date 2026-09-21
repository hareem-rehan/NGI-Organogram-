import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  CareerTrack,
  Department,
  JobFamily,
  JobGrade,
  LevelMappingEntry,
} from "@prisma/client";

vi.mock("@/app/(app)/career-framework/actions", () => ({
  getCareerFrameworkAction: vi.fn(),
  createCareerTrackAction: vi.fn(),
  deleteCareerTrackAction: vi.fn(),
  deleteJobFamilyAction: vi.fn(),
  deleteLevelMappingEntryAction: vi.fn(),
  createJobFamilyAction: vi.fn(),
  updateJobFamilyAction: vi.fn(),
  createLevelMappingEntryAction: vi.fn(),
  provisionStandardLevelsAction: vi.fn(),
}));

import { CareerFrameworkView } from "./career-framework-view";
import {
  getCareerFrameworkAction,
  provisionStandardLevelsAction,
} from "@/app/(app)/career-framework/actions";

const DEPT: Department = {
  id: "dept-1",
  companyId: "c1",
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

function grade(id: string, code: string, displayOrder: number): JobGrade {
  return {
    id,
    companyId: "c1",
    departmentId: null,
    name: code,
    code,
    description: null,
    displayOrder,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const FAMILY: JobFamily = {
  id: "fam-1",
  companyId: "c1",
  departmentId: "dept-1",
  name: "Software Engineering",
  code: "SWE",
  description: null,
  displayOrder: null,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function track(id: string, kind: "IC" | "MANAGER", name: string): CareerTrack {
  return {
    id,
    companyId: "c1",
    jobFamilyId: "fam-1",
    kind,
    name,
    displayOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function entry(
  id: string,
  careerTrackId: string,
  jobGradeId: string,
  title: string
): LevelMappingEntry {
  return {
    id,
    companyId: "c1",
    jobFamilyId: "fam-1",
    careerTrackId,
    jobGradeId,
    title,
    displayOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const L7 = grade("g-l7", "L7", 7);
const IC = track("t-ic", "IC", "Individual Contributor");
const MGR = track("t-mgr", "MANAGER", "Manager");

function renderView(overrides: Partial<Parameters<typeof CareerFrameworkView>[0]> = {}) {
  return render(
    <CareerFrameworkView
      canManage
      initialJobFamilies={[FAMILY]}
      initialCareerTracks={[IC, MGR]}
      initialLevelMappingEntries={[
        entry("e-ic", IC.id, L7.id, "Principal Software Engineer"),
        entry("e-mgr", MGR.id, L7.id, "Tech Lead"),
      ]}
      departments={[DEPT]}
      jobGrades={[L7]}
      {...overrides}
    />
  );
}

describe("CareerFrameworkView", () => {
  it("shows an empty state and an Add button when there are no families", () => {
    renderView({ initialJobFamilies: [], initialCareerTracks: [], initialLevelMappingEntries: [] });
    expect(screen.getByText(/no job families yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add job family/i })).toBeInTheDocument();
  });

  it("renders the matrix with IC and Manager columns and the mapped titles", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Software Engineering" })).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /individual contributor/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /manager/i })).toBeInTheDocument();
    expect(screen.getByText("Principal Software Engineer")).toBeInTheDocument();
    expect(screen.getByText("Tech Lead")).toBeInTheDocument();
  });

  it("shows the level as a bare code (L7), never a combined label", () => {
    renderView();
    const row = screen.getByRole("cell", { name: "L7" }).closest("tr")!;
    expect(within(row).getByText("Principal Software Engineer")).toBeInTheDocument();
    // No descriptive suffix like "L7 - Principal" anywhere.
    expect(screen.queryByText(/L7\s*[-—]\s*\w/)).not.toBeInTheDocument();
  });

  it("lets an IC-L7 and a Manager-L7 title coexist with no reporting relationship implied", () => {
    renderView();
    // Both live on the same L7 row, in different track columns. The
    // component renders no reporting affordance at all.
    const row = screen.getByRole("cell", { name: "L7" }).closest("tr")!;
    expect(within(row).getByText("Principal Software Engineer")).toBeInTheDocument();
    expect(within(row).getByText("Tech Lead")).toBeInTheDocument();
    // The matrix offers no reporting control at all — no Reports-To field
    // or combobox is rendered anywhere on this career screen.
    expect(screen.queryByLabelText(/reports to/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /reports to/i })).not.toBeInTheDocument();
  });

  it("hides all management controls in read-only mode", () => {
    renderView({ canManage: false });
    expect(screen.queryByRole("button", { name: /add job family/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete software engineering/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add mapping/i })).not.toBeInTheDocument();
    // The titles are still readable.
    expect(screen.getByText("Principal Software Engineer")).toBeInTheDocument();
  });

  it("offers a one-click 'set up standard levels' action when no levels exist yet", () => {
    renderView({ jobGrades: [] });
    expect(screen.getByText(/no levels set up yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /set up standard levels/i })
    ).toBeInTheDocument();
  });

  it("does not show the levels setup prompt once levels exist", () => {
    renderView({ jobGrades: [L7] });
    expect(screen.queryByText(/no levels set up yet/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /set up standard levels/i })
    ).not.toBeInTheDocument();
  });

  it("hides the levels setup action in read-only mode even with no levels", () => {
    renderView({ jobGrades: [], canManage: false });
    // The explanatory prompt still shows, but a viewer gets no action.
    expect(screen.getByText(/no levels set up yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /set up standard levels/i })
    ).not.toBeInTheDocument();
  });

  it("provisions the scale and refreshes the levels from the server on click", async () => {
    const user = userEvent.setup();
    vi.mocked(provisionStandardLevelsAction).mockResolvedValue({ ok: true, data: { created: 17 } });
    vi.mocked(getCareerFrameworkAction).mockResolvedValue({
      ok: true,
      data: {
        jobFamilies: [FAMILY],
        careerTracks: [IC, MGR],
        levelMappingEntries: [],
        jobGrades: [L7],
      },
    });

    renderView({ jobGrades: [], initialLevelMappingEntries: [] });
    await user.click(screen.getByRole("button", { name: /set up standard levels/i }));

    expect(provisionStandardLevelsAction).toHaveBeenCalledTimes(1);
    // After the refetch the prompt is gone, because the server now reports levels.
    await waitFor(() =>
      expect(screen.queryByText(/no levels set up yet/i)).not.toBeInTheDocument()
    );
  });
});
