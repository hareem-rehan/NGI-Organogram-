import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrganogramDetailsPanel } from "./organogram-details-panel";
import type { OrganogramNode } from "@/lib/domain/organogram";

function makeNode(overrides: Partial<OrganogramNode> = {}): OrganogramNode {
  return {
    positionId: "pos-1",
    positionCode: "POS-1",
    title: "VP Engineering",
    departmentId: "dept-1",
    departmentName: "Engineering",
    departmentCode: "ENG",
    departmentColor: "#16a34a",
    jobGradeId: "grade-1",
    jobGradeName: "Director",
    organizationalLevel: 2,
    positionStatus: "ACTIVE",
    occupancyStatus: "vacant",
    occupantDisplayName: null,
    occupantEmployeeId: null,
    directReportCount: 3,
    primaryReportsToPositionId: "root",
    hasChildren: true,
    isPlanned: false,
    isActive: true,
    ...overrides,
  };
}

describe("OrganogramDetailsPanel", () => {
  it("shows every documented field", () => {
    render(
      <OrganogramDetailsPanel
        node={makeNode()}
        canViewEmployeeDetails={true}
        onClose={vi.fn()}
        onFocusPosition={vi.fn()}
        onFocusDepartment={vi.fn()}
      />
    );
    expect(screen.getByRole("heading", { name: "VP Engineering" })).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("Vacant")).toBeInTheDocument();
    expect(screen.getByText(/Engineering \(ENG\)/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Director")).toBeInTheDocument();
    expect(screen.getByText("POS-1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("links to the occupant's employee page when occupied and the caller can view employee details", () => {
    render(
      <OrganogramDetailsPanel
        node={makeNode({
          occupancyStatus: "occupied",
          occupantDisplayName: "Amara Chen",
          occupantEmployeeId: "employee-42",
        })}
        canViewEmployeeDetails={true}
        onClose={vi.fn()}
        onFocusPosition={vi.fn()}
        onFocusDepartment={vi.fn()}
      />
    );
    const link = screen.getByRole("link", { name: "Amara Chen" });
    expect(link).toHaveAttribute("href", "/employees/employee-42");
  });

  it("shows the occupant's name as plain text (no link) when the caller cannot view employee details", () => {
    render(
      <OrganogramDetailsPanel
        node={makeNode({
          occupancyStatus: "occupied",
          occupantDisplayName: "Amara Chen",
          occupantEmployeeId: "employee-42",
        })}
        canViewEmployeeDetails={false}
        onClose={vi.fn()}
        onFocusPosition={vi.fn()}
        onFocusDepartment={vi.fn()}
      />
    );
    expect(screen.getByText("Amara Chen")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Amara Chen" })).not.toBeInTheDocument();
  });

  it("shows a dash for a missing job grade", () => {
    render(
      <OrganogramDetailsPanel
        node={makeNode({ jobGradeName: null })}
        canViewEmployeeDetails={true}
        onClose={vi.fn()}
        onFocusPosition={vi.fn()}
        onFocusDepartment={vi.fn()}
      />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("links to the filtered Positions list using the position code", () => {
    render(
      <OrganogramDetailsPanel
        node={makeNode()}
        canViewEmployeeDetails={true}
        onClose={vi.fn()}
        onFocusPosition={vi.fn()}
        onFocusDepartment={vi.fn()}
      />
    );
    const link = screen.getByRole("link", { name: /view position record/i });
    expect(link).toHaveAttribute("href", "/positions?search=POS-1");
  });

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <OrganogramDetailsPanel
        node={makeNode()}
        canViewEmployeeDetails={true}
        onClose={onClose}
        onFocusPosition={vi.fn()}
        onFocusDepartment={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /close position details/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <OrganogramDetailsPanel
        node={makeNode()}
        canViewEmployeeDetails={true}
        onClose={onClose}
        onFocusPosition={vi.fn()}
        onFocusDepartment={vi.fn()}
      />
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("moves focus to the heading when a different node is shown (announces the change to screen readers)", () => {
    render(
      <OrganogramDetailsPanel
        node={makeNode()}
        canViewEmployeeDetails={true}
        onClose={vi.fn()}
        onFocusPosition={vi.fn()}
        onFocusDepartment={vi.fn()}
      />
    );
    expect(screen.getByRole("heading", { name: "VP Engineering" })).toHaveFocus();
  });

  it('calls onFocusPosition with the position id when "Focus on this position" is clicked', async () => {
    const user = userEvent.setup();
    const onFocusPosition = vi.fn();
    render(
      <OrganogramDetailsPanel
        node={makeNode({ positionId: "pos-99" })}
        canViewEmployeeDetails={true}
        onClose={vi.fn()}
        onFocusPosition={onFocusPosition}
        onFocusDepartment={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /focus on this position/i }));
    expect(onFocusPosition).toHaveBeenCalledWith("pos-99");
  });

  it('calls onFocusDepartment with the department id when "Focus on this department" is clicked', async () => {
    const user = userEvent.setup();
    const onFocusDepartment = vi.fn();
    render(
      <OrganogramDetailsPanel
        node={makeNode({ departmentId: "dept-42" })}
        canViewEmployeeDetails={true}
        onClose={vi.fn()}
        onFocusPosition={vi.fn()}
        onFocusDepartment={onFocusDepartment}
      />
    );
    await user.click(screen.getByRole("button", { name: /focus on this department/i }));
    expect(onFocusDepartment).toHaveBeenCalledWith("dept-42");
  });
});
