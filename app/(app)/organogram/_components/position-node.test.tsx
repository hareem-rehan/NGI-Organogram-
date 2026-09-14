import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";

import { PositionNode, type PositionNodeData } from "./position-node";
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
    jobGradeId: null,
    jobGradeName: null,
    jobGradeCode: null,
    jobGradeLevel: null,
    organizationalLevel: 2,
    positionStatus: "ACTIVE",
    occupancyStatus: "vacant",
    occupantDisplayName: null,
    occupantEmployeeId: null,
    directReportCount: 0,
    primaryReportsToPositionId: "root",
    hasChildren: false,
    isPlanned: false,
    isActive: true,
    ...overrides,
  };
}

function renderNode(data: Partial<PositionNodeData> = {}) {
  const fullData: PositionNodeData = {
    node: makeNode(),
    isCollapsed: false,
    hiddenDescendantCount: 0,
    isSelected: false,
    onToggleCollapse: vi.fn(),
    onSelect: vi.fn(),
    ...data,
  };
  const props = {
    id: fullData.node.positionId,
    data: fullData,
    type: "positionNode",
    selected: false,
    dragging: false,
    isConnectable: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    draggable: false,
    selectable: false,
    deletable: false,
  } as unknown as NodeProps & { data: PositionNodeData };

  render(
    <ReactFlowProvider>
      <PositionNode {...props} />
    </ReactFlowProvider>
  );
  return fullData;
}

describe("PositionNode", () => {
  // Rewritten for the Demo 1 compact card. The previous version asserted
  // the department name, organizational level and position code were all
  // ON the card — exactly what the stakeholder asked to remove — so it is
  // replaced by its opposite rather than deleted, and the removals are
  // asserted so they cannot creep back.
  it("shows the occupant, role title and grade level", () => {
    renderNode({
      node: makeNode({
        occupancyStatus: "occupied",
        occupantDisplayName: "John Doe",
        title: "Tech Lead",
        jobGradeCode: "L7",
        jobGradeLevel: 7,
      }),
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Tech Lead")).toBeInTheDocument();
    expect(screen.getByText("L7")).toBeInTheDocument();
  });

  it("no longer shows the position code, department name, or organizational level", () => {
    renderNode({
      node: makeNode({
        occupancyStatus: "occupied",
        occupantDisplayName: "John Doe",
        jobGradeCode: "L7",
        jobGradeLevel: 7,
      }),
    });
    // Internal identifier — of no use to a chart reader.
    expect(screen.queryByText("POS-1")).not.toBeInTheDocument();
    // The card sits under its own department heading, so repeating the
    // name on every card was duplication.
    expect(screen.queryByText(/Engineering · Level/)).not.toBeInTheDocument();
  });

  it("omits the grade row entirely when the position has no grade", () => {
    renderNode({
      node: makeNode({
        occupancyStatus: "occupied",
        occupantDisplayName: "John Doe",
        jobGradeCode: null,
        jobGradeLevel: null,
      }),
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.queryByText(/^L\d+$/)).not.toBeInTheDocument();
  });

  it("shows Vacant for an unoccupied position", () => {
    renderNode({ node: makeNode({ occupancyStatus: "vacant", occupantDisplayName: null }) });
    expect(screen.getByText("Vacant")).toBeInTheDocument();
  });

  it("shows the occupant's display name for an occupied position, never a raw employee id", () => {
    renderNode({
      node: makeNode({
        occupancyStatus: "occupied",
        occupantDisplayName: "Amara Chen",
        occupantEmployeeId: "employee-42",
      }),
    });
    expect(screen.getByText("Amara Chen")).toBeInTheDocument();
    expect(screen.queryByText("employee-42")).not.toBeInTheDocument();
  });

  it("shows a Planned badge for a planned position and an Inactive badge for an inactive one", () => {
    const { rerender } = render(
      <ReactFlowProvider>
        <PositionNode
          {...({
            id: "p",
            data: {
              node: makeNode({ positionStatus: "PLANNED" }),
              isCollapsed: false,
              hiddenDescendantCount: 0,
              isSelected: false,
              onToggleCollapse: vi.fn(),
              onSelect: vi.fn(),
            },
          } as unknown as NodeProps & { data: PositionNodeData })}
        />
      </ReactFlowProvider>
    );
    expect(screen.getByText("Planned")).toBeInTheDocument();

    rerender(
      <ReactFlowProvider>
        <PositionNode
          {...({
            id: "p",
            data: {
              node: makeNode({ positionStatus: "INACTIVE" }),
              isCollapsed: false,
              hiddenDescendantCount: 0,
              isSelected: false,
              onToggleCollapse: vi.fn(),
              onSelect: vi.fn(),
            },
          } as unknown as NodeProps & { data: PositionNodeData })}
        />
      </ReactFlowProvider>
    );
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows no status badge for an Active position", () => {
    renderNode({ node: makeNode({ positionStatus: "ACTIVE" }) });
    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
    expect(screen.queryByText("Inactive")).not.toBeInTheDocument();
  });

  it('shows "No direct reports" and no toggle for a leaf position', () => {
    renderNode({ node: makeNode({ hasChildren: false, directReportCount: 0 }) });
    expect(screen.getByText("No direct reports")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Expand/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Collapse/ })).not.toBeInTheDocument();
  });

  it("shows an Expand toggle with the hidden count when collapsed and has children", () => {
    renderNode({
      node: makeNode({ hasChildren: true, directReportCount: 2, title: "Root" }),
      isCollapsed: true,
      hiddenDescendantCount: 3,
    });
    expect(
      screen.getByRole("button", { name: /^Expand Root, 3 hidden positions/ })
    ).toBeInTheDocument();
  });

  it("shows a Collapse toggle when expanded and has children", () => {
    renderNode({
      node: makeNode({ hasChildren: true, directReportCount: 2, title: "Root" }),
      isCollapsed: false,
    });
    expect(screen.getByRole("button", { name: /^Collapse Root/ })).toBeInTheDocument();
  });

  it("clicking the card calls onSelect with the position id", async () => {
    const user = userEvent.setup();
    const data = renderNode({ node: makeNode({ positionId: "pos-99" }) });
    await user.click(screen.getByRole("button", { name: /VP Engineering/ }));
    expect(data.onSelect).toHaveBeenCalledWith("pos-99");
  });

  it("clicking the toggle calls onToggleCollapse and does NOT also call onSelect (sibling buttons, not nested)", async () => {
    const user = userEvent.setup();
    const data = renderNode({
      node: makeNode({ positionId: "pos-99", hasChildren: true, title: "Root" }),
    });
    await user.click(screen.getByRole("button", { name: /^Collapse Root/ }));
    expect(data.onToggleCollapse).toHaveBeenCalledWith("pos-99");
    expect(data.onSelect).not.toHaveBeenCalled();
  });

  it("pressing Enter on the focused card calls onSelect (keyboard activation)", async () => {
    const user = userEvent.setup();
    const data = renderNode({ node: makeNode({ positionId: "pos-99" }) });
    const card = screen.getByRole("button", { name: /VP Engineering/ });
    card.focus();
    await user.keyboard("{Enter}");
    expect(data.onSelect).toHaveBeenCalledWith("pos-99");
  });
});
