import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
}));

// next/link renders a plain anchor in tests.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { CareerFrameworkView } from "./career-framework-view";
import {
  addManagerLadderAction,
  getCareerFrameworkAction,
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
    expect(screen.getByText(/no sub-divisions yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add sub-division/i })).toBeInTheDocument();
  });

  it("lists titles under IC and Manager columns for a dual-ladder family", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Software Engineering" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /individual contributor/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^manager$/i })).toBeInTheDocument();
    expect(screen.getByText("Principal Software Engineer")).toBeInTheDocument();
    expect(screen.getByText("Tech Lead")).toBeInTheDocument();
  });

  it("does not show levels anywhere on this page (levels moved to Settings)", () => {
    renderView();
    // No level code on the page, no Levels-management panel/picker.
    expect(screen.queryByText("L7")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Levels$/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/add a level/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove level/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /set up standard levels/i })
    ).not.toBeInTheDocument();
  });

  it("shows IC and Manager titles with no reporting control on the career screen", () => {
    renderView();
    expect(screen.getByText("Principal Software Engineer")).toBeInTheDocument();
    expect(screen.getByText("Tech Lead")).toBeInTheDocument();
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

  it("single-ladder family: one neutral 'Titles' column, no IC/Manager framing", () => {
    renderView({
      initialCareerTracks: [IC],
      initialLevelMappingEntries: [entry("e-ic", IC.id, L7.id, "Principal Software Engineer")],
    });
    expect(screen.getByRole("heading", { name: /^titles$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /individual contributor/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^manager$/i })).not.toBeInTheDocument();
    expect(screen.getByText("Principal Software Engineer")).toBeInTheDocument();
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
      },
    });
    renderView({ initialCareerTracks: [IC], initialLevelMappingEntries: [] });

    await user.click(screen.getByRole("button", { name: /add manager ladder/i }));
    expect(addManagerLadderAction).toHaveBeenCalledWith({ jobFamilyId: FAMILY.id });
  });

  it("dual-ladder family: no 'add manager ladder' button; the manager ladder is removable", () => {
    renderView(); // default has IC + MGR
    expect(screen.queryByRole("button", { name: /add manager ladder/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove manager ladder/i })).toBeInTheDocument();
  });

  it("points to Settings and disables Add-title when no levels exist yet", () => {
    renderView({ jobGrades: [], initialLevelMappingEntries: [] });
    expect(screen.getByText(/titles are recorded at a level/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: /add title/i })).toBeDisabled();
  });
});
