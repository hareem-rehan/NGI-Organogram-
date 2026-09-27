import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Department, DepartmentLevelTitle } from "@prisma/client";

vi.mock("@/app/(app)/levels-mapping/actions", () => ({
  getLevelsMappingAction: vi.fn(),
  createDepartmentLevelTitleAction: vi.fn(),
  updateDepartmentLevelTitleAction: vi.fn(),
  deleteDepartmentLevelTitleAction: vi.fn(),
}));

import { LevelsMappingView } from "./levels-mapping-view";

const ENG: Department = {
  id: "dept-eng",
  companyId: "c1",
  name: "Engineering",
  code: "ENG",
  description: null,
  color: "#16a34a",
  parentDepartmentId: null,
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

const SEEDED = [
  title("t-l3-ic", "IC", "L3", "Software Engineer"),
  title("t-l6-mgr", "MANAGER", "L6", "Associate Tech Lead"),
];

function renderView(overrides: Partial<Parameters<typeof LevelsMappingView>[0]> = {}) {
  return render(
    <LevelsMappingView canManage departments={[ENG]} initialTitles={SEEDED} {...overrides} />
  );
}

describe("LevelsMappingView", () => {
  it("shows an empty state when there are no departments", () => {
    renderView({ departments: [], initialTitles: [] });
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
});
