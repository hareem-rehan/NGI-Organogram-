import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Department, JobFamily } from "@prisma/client";

vi.mock("@/app/(app)/career-framework/actions", () => ({
  getCareerFrameworkAction: vi.fn(),
  deleteJobFamilyAction: vi.fn(),
  createJobFamilyAction: vi.fn(),
  updateJobFamilyAction: vi.fn(),
}));

// next/link renders a plain anchor in tests.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { CareerFrameworkView } from "./career-framework-view";

const DEPT: Department = {
  id: "dept-1",
  companyId: "c1",
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

function renderView(overrides: Partial<Parameters<typeof CareerFrameworkView>[0]> = {}) {
  return render(
    <CareerFrameworkView
      canManage
      initialJobFamilies={[FAMILY]}
      departments={[DEPT]}
      {...overrides}
    />
  );
}

describe("CareerFrameworkView", () => {
  it("shows an empty state and an Add button when there are no sub-divisions", () => {
    renderView({ initialJobFamilies: [] });
    expect(screen.getByText(/no sub-divisions yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add sub-division/i })).toBeInTheDocument();
  });

  it("lists each sub-division with its department and code", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Software Engineering" })).toBeInTheDocument();
    expect(screen.getByText(/Engineering · SWE/)).toBeInTheDocument();
  });

  it("points level names to the Levels Mapping page", () => {
    renderView();
    expect(screen.getByRole("link", { name: /levels mapping/i })).toHaveAttribute(
      "href",
      "/levels-mapping"
    );
  });

  it("no longer shows titles, tracks or levels on this page", () => {
    renderView();
    // The career-framework page is now sub-division CRUD only.
    expect(screen.queryByText("L7")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add title/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add manager ladder/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /individual contributor/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reports to/i)).not.toBeInTheDocument();
  });

  it("shows edit and delete controls per sub-division when manageable", () => {
    renderView();
    expect(screen.getByRole("button", { name: /edit software engineering/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete software engineering/i })
    ).toBeInTheDocument();
  });

  it("hides all management controls in read-only mode", () => {
    renderView({ canManage: false });
    expect(screen.queryByRole("button", { name: /add sub-division/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete software engineering/i })
    ).not.toBeInTheDocument();
    // The sub-division is still readable.
    expect(screen.getByRole("heading", { name: "Software Engineering" })).toBeInTheDocument();
  });
});
