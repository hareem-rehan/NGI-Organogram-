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
  addManagerLadderAction: vi.fn(),
  deleteCareerTrackAction: vi.fn(),
  deleteJobFamilyAction: vi.fn(),
  deleteLevelMappingEntryAction: vi.fn(),
  createJobFamilyAction: vi.fn(),
  updateJobFamilyAction: vi.fn(),
  createLevelMappingEntryAction: vi.fn(),
  provisionStandardLevelsAction: vi.fn(),
  addLevelAction: vi.fn(),
  deleteLevelAction: vi.fn(),
  removeUnusedLevelsAction: vi.fn(),
}));

import { CareerFrameworkView } from "./career-framework-view";
import {
  addLevelAction,
  addManagerLadderAction,
  deleteLevelAction,
  getCareerFrameworkAction,
  provisionStandardLevelsAction,
  removeUnusedLevelsAction,
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
      initialLevelUsageByCode={{ L7: { positionCount: 0, titleCount: 2 } }}
      {...overrides}
    />
  );
}

describe("CareerFrameworkView", () => {
  it("shows an empty state and an Add button when there are no families", () => {
    renderView({ initialJobFamilies: [], initialCareerTracks: [], initialLevelMappingEntries: [] });
    expect(screen.getByText(/no sub-divisions yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add sub-division/i })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /add sub-division/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete software engineering/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add title/i })).not.toBeInTheDocument();
    // The titles are still readable.
    expect(screen.getByText("Principal Software Engineer")).toBeInTheDocument();
  });

  it("single-ladder family: one neutral Title column, no IC/Manager framing", () => {
    renderView({
      initialCareerTracks: [IC],
      initialLevelMappingEntries: [entry("e-ic", IC.id, L7.id, "Principal Software Engineer")],
    });
    // A single, neutrally-labelled column — no "Individual Contributor" or
    // "Manager" column headers forced on the user.
    expect(screen.getByRole("columnheader", { name: /^title$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /individual contributor/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^manager$/i })).not.toBeInTheDocument();
    expect(screen.getByText("Principal Software Engineer")).toBeInTheDocument();
    // Offers the optional escalation to a parallel manager ladder.
    expect(screen.getByRole("button", { name: /add manager ladder/i })).toBeInTheDocument();
  });

  it("adding a manager ladder calls the action", async () => {
    const user = userEvent.setup();
    vi.mocked(addManagerLadderAction).mockResolvedValue({
      ok: true,
      data: { id: "t-new" } as never,
    });
    vi.mocked(getCareerFrameworkAction).mockResolvedValue({
      ok: true,
      data: {
        jobFamilies: [FAMILY],
        careerTracks: [IC, MGR],
        levelMappingEntries: [],
        jobGrades: [L7],
        levelUsageByCode: { L7: { positionCount: 0, titleCount: 0 } },
      },
    });
    renderView({ initialCareerTracks: [IC], initialLevelMappingEntries: [] });

    await user.click(screen.getByRole("button", { name: /add manager ladder/i }));
    expect(addManagerLadderAction).toHaveBeenCalledWith({ jobFamilyId: FAMILY.id });
  });

  it("dual-ladder family: no 'add manager ladder' button; the manager column is removable", () => {
    renderView(); // default has IC + MGR
    expect(screen.queryByRole("button", { name: /add manager ladder/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove manager ladder/i })).toBeInTheDocument();
  });

  it("offers a one-click 'set up standard levels' action when no levels exist yet", () => {
    renderView({ jobGrades: [] });
    expect(screen.getByText(/no levels set up yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set up standard levels/i })).toBeInTheDocument();
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
        levelUsageByCode: { L7: { positionCount: 0, titleCount: 0 } },
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

describe("CareerFrameworkView — Levels panel (usage-aware curation)", () => {
  const L9 = grade("g-l9", "L9", 9);

  it("lists each level with its usage, marking an unused one and disabling its removal guard only when used", () => {
    renderView({
      jobGrades: [L7, L9],
      // L7 is used by 2 titles; L9 is used by nothing.
      initialLevelUsageByCode: { L7: { positionCount: 0, titleCount: 2 } },
    });

    // Used level: shows the count, no "Unused" badge, Remove disabled.
    const l7Remove = screen.getByRole("button", { name: /remove level l7/i });
    expect(l7Remove).toBeDisabled();
    expect(screen.getByText(/2 titles/i)).toBeInTheDocument();

    // Unused level: shows an "Unused" badge, Remove enabled.
    expect(screen.getByText("Unused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove level l9/i })).toBeEnabled();
  });

  it("removes a single unused level by code", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteLevelAction).mockResolvedValue({ ok: true, data: { deletedCount: 1 } });
    vi.mocked(getCareerFrameworkAction).mockResolvedValue({
      ok: true,
      data: {
        jobFamilies: [FAMILY],
        careerTracks: [IC, MGR],
        levelMappingEntries: [],
        jobGrades: [L7],
        levelUsageByCode: { L7: { positionCount: 0, titleCount: 2 } },
      },
    });
    renderView({
      jobGrades: [L7, L9],
      initialLevelUsageByCode: { L7: { positionCount: 0, titleCount: 2 } },
    });

    await user.click(screen.getByRole("button", { name: /remove level l9/i }));
    expect(deleteLevelAction).toHaveBeenCalledWith({ code: "L9" });
  });

  it("offers a one-click 'Remove N unused levels' and calls the bulk action", async () => {
    const user = userEvent.setup();
    vi.mocked(removeUnusedLevelsAction).mockResolvedValue({
      ok: true,
      data: { removedCodes: ["L9"] },
    });
    vi.mocked(getCareerFrameworkAction).mockResolvedValue({
      ok: true,
      data: {
        jobFamilies: [FAMILY],
        careerTracks: [IC, MGR],
        levelMappingEntries: [],
        jobGrades: [L7],
        levelUsageByCode: { L7: { positionCount: 0, titleCount: 2 } },
      },
    });
    renderView({
      jobGrades: [L7, L9],
      initialLevelUsageByCode: { L7: { positionCount: 0, titleCount: 2 } },
    });

    await user.click(screen.getByRole("button", { name: /remove 1 unused level/i }));
    expect(removeUnusedLevelsAction).toHaveBeenCalledTimes(1);
  });

  it("adds a standard level from the 'Add a level' picker", async () => {
    const user = userEvent.setup();
    vi.mocked(addLevelAction).mockResolvedValue({ ok: true, data: { code: "L10" } });
    vi.mocked(getCareerFrameworkAction).mockResolvedValue({
      ok: true,
      data: {
        jobFamilies: [FAMILY],
        careerTracks: [IC, MGR],
        levelMappingEntries: [],
        jobGrades: [L7],
        levelUsageByCode: { L7: { positionCount: 0, titleCount: 2 } },
      },
    });
    renderView();

    await user.selectOptions(screen.getByLabelText(/add a level/i), "L10");
    expect(addLevelAction).toHaveBeenCalledWith({ code: "L10" });
  });

  it("hides all Levels-panel controls in read-only mode but still shows usage", () => {
    renderView({
      canManage: false,
      jobGrades: [L7, L9],
      initialLevelUsageByCode: { L7: { positionCount: 0, titleCount: 2 } },
    });
    expect(screen.queryByRole("button", { name: /remove level/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/add a level/i)).not.toBeInTheDocument();
    expect(screen.getByText("Unused")).toBeInTheDocument();
  });
});
